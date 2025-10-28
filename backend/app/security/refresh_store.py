from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.app.utils.observability import record_refresh_revocation

try:
    import redis.asyncio as redis  # type: ignore
except ImportError:  # pragma: no cover - redis is optional for tests
    redis = None

try:
    import httpx  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - httpx is required for Vercel KV adapter
    httpx = None

logger = logging.getLogger("auth.refresh_store")


REFRESH_SESSION_PREFIX = "auth:refresh:session:"
REFRESH_BLACKLIST_PREFIX = "auth:refresh:blacklist:"


def _parse_positive_ttl(env_var: str, default_seconds: int) -> int:
    raw_value = os.getenv(env_var)
    if raw_value is None:
        return default_seconds
    try:
        parsed = int(raw_value)
    except ValueError:
        logger.warning("Invalid integer for %s=%s; falling back to default %s", env_var, raw_value, default_seconds)
        return default_seconds
    if parsed <= 0:
        logger.warning("Non-positive TTL for %s=%s; using default %s", env_var, raw_value, default_seconds)
        return default_seconds
    return parsed


DEFAULT_REFRESH_TTL_SECONDS = _parse_positive_ttl("REFRESH_SESSION_TTL", 60 * 60 * 24 * 7)
DEFAULT_BLACKLIST_TTL_SECONDS = _parse_positive_ttl("REFRESH_BLACKLIST_TTL", 60 * 60 * 24 * 2)


@dataclass(frozen=True)
class RefreshSessionRecord:
    user_id: str
    role: str
    session_id: str
    issued_at: int
    expires_at: int
    version: int

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "RefreshSessionRecord":
        return cls(
            user_id=str(payload["userId"]),
            role=str(payload["role"]),
            session_id=str(payload["sessionId"]),
            issued_at=int(payload["issuedAt"]),
            expires_at=int(payload["expiresAt"]),
            version=int(payload["version"]),
        )

    def to_payload(self) -> Dict[str, Any]:
        return {
            "userId": self.user_id,
            "role": self.role,
            "sessionId": self.session_id,
            "issuedAt": self.issued_at,
            "expiresAt": self.expires_at,
            "version": self.version,
        }


class RefreshStorageAdapter:
    async def persist(self, hash_: str, record: RefreshSessionRecord, ttl_seconds: int) -> None:
        raise NotImplementedError

    async def revoke(self, hash_: str, ttl_seconds: int) -> None:
        raise NotImplementedError

    async def get(self, hash_: str) -> Optional[RefreshSessionRecord]:
        raise NotImplementedError

    async def is_revoked(self, hash_: str) -> bool:
        raise NotImplementedError


class VercelKVAdapter(RefreshStorageAdapter):
    def __init__(
        self,
        *,
        rest_url: str,
        rest_token: str,
        namespace: Optional[str] = None,
        timeout: float = 5.0,
        client: Optional[Any] = None,
    ) -> None:
        if client is None and httpx is None:
            raise RuntimeError("httpx is not installed; cannot use VercelKVAdapter")
        self._rest_url = rest_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {rest_token}"}
        self._timeout = timeout
        self._client = client
        self._namespace = namespace.strip() if namespace else None

    def _qualify(self, key: str) -> str:
        if self._namespace:
            return f"{self._namespace}:{key}"
        return key

    async def _execute(self, command: list[Any]) -> Any:
        client = self._client
        owns_client = False
        if client is None:
            if httpx is None:  # pragma: no cover - guarded in __init__
                raise RuntimeError("httpx client unavailable for VercelKVAdapter")
            client = httpx.AsyncClient(base_url=self._rest_url, timeout=self._timeout)
            owns_client = True
        try:
            response = await client.post("/", json=command, headers=self._headers)
        except Exception as exc:  # pragma: no cover - network failure path
            raise RuntimeError(f"Vercel KV request failed: {exc}") from exc
        finally:
            if owns_client:
                await client.aclose()

        if response.status_code >= 400:
            raise RuntimeError(f"Vercel KV responded with HTTP {response.status_code}: {response.text}")

        try:
            payload = response.json()
        except json.JSONDecodeError as exc:  # pragma: no cover - unexpected response
            raise RuntimeError("Failed to decode Vercel KV response") from exc

        if "error" in payload:
            raise RuntimeError(f"Vercel KV command error: {payload['error']}")

        return payload.get("result")

    async def persist(self, hash_: str, record: RefreshSessionRecord, ttl_seconds: int) -> None:
        key = self._qualify(f"{REFRESH_SESSION_PREFIX}{hash_}")
        payload = json.dumps(record.to_payload(), separators=(",", ":"))
        await self._execute(["SET", key, payload, "EX", str(ttl_seconds)])

    async def revoke(self, hash_: str, ttl_seconds: int) -> None:
        key = self._qualify(f"{REFRESH_BLACKLIST_PREFIX}{hash_}")
        await self._execute(["SET", key, "1", "EX", str(ttl_seconds)])

    async def get(self, hash_: str) -> Optional[RefreshSessionRecord]:
        key = self._qualify(f"{REFRESH_SESSION_PREFIX}{hash_}")
        data = await self._execute(["GET", key])
        if data is None:
            return None
        try:
            payload = json.loads(data)
        except (TypeError, json.JSONDecodeError):
            return None
        return RefreshSessionRecord.from_payload(payload)

    async def is_revoked(self, hash_: str) -> bool:
        key = self._qualify(f"{REFRESH_BLACKLIST_PREFIX}{hash_}")
        result = await self._execute(["EXISTS", key])
        return bool(result)


class RedisAdapter(RefreshStorageAdapter):
    def __init__(self, url: str, *, client: Optional[Any] = None):
        if redis is None:
            raise RuntimeError("redis library is not installed; cannot use RedisAdapter")
        self._client = client or redis.from_url(url, decode_responses=True)

    async def persist(self, hash_: str, record: RefreshSessionRecord, ttl_seconds: int) -> None:
        key = f"{REFRESH_SESSION_PREFIX}{hash_}"
        await self._client.set(key, json.dumps(record.to_payload()), ex=ttl_seconds)

    async def revoke(self, hash_: str, ttl_seconds: int) -> None:
        key = f"{REFRESH_BLACKLIST_PREFIX}{hash_}"
        await self._client.set(key, "1", ex=ttl_seconds)

    async def get(self, hash_: str) -> Optional[RefreshSessionRecord]:
        key = f"{REFRESH_SESSION_PREFIX}{hash_}"
        data = await self._client.get(key)
        if data is None:
            return None
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            return None
        return RefreshSessionRecord.from_payload(payload)

    async def is_revoked(self, hash_: str) -> bool:
        key = f"{REFRESH_BLACKLIST_PREFIX}{hash_}"
        value = await self._client.get(key)
        return value is not None


class InMemoryAdapter(RefreshStorageAdapter):
    def __init__(self) -> None:
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._blacklist: Dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def persist(self, hash_: str, record: RefreshSessionRecord, ttl_seconds: int) -> None:
        async with self._lock:
            expires_at = time.time() + ttl_seconds
            self._sessions[hash_] = {"record": record, "expiresAt": expires_at}

    async def revoke(self, hash_: str, ttl_seconds: int) -> None:
        async with self._lock:
            self._blacklist[hash_] = time.time() + ttl_seconds

    async def get(self, hash_: str) -> Optional[RefreshSessionRecord]:
        async with self._lock:
            entry = self._sessions.get(hash_)
            if not entry:
                return None
            if time.time() > entry["expiresAt"]:
                self._sessions.pop(hash_, None)
                return None
            return entry["record"]

    async def is_revoked(self, hash_: str) -> bool:
        async with self._lock:
            expiry = self._blacklist.get(hash_)
            if expiry is None:
                return False
            if time.time() > expiry:
                self._blacklist.pop(hash_, None)
                return False
            return True


class RefreshStore:
    def __init__(
        self,
        *,
        adapter: Optional[RefreshStorageAdapter] = None,
        redis_url: Optional[str] = None,
        refresh_ttl_seconds: Optional[int] = None,
        blacklist_ttl_seconds: Optional[int] = None,
    ) -> None:
        self._adapter = adapter or self._select_adapter(redis_url=redis_url)
        self._refresh_ttl_default = self._resolve_ttl(refresh_ttl_seconds, DEFAULT_REFRESH_TTL_SECONDS)
        self._blacklist_ttl_default = self._resolve_ttl(blacklist_ttl_seconds, DEFAULT_BLACKLIST_TTL_SECONDS)

    def _select_adapter(self, *, redis_url: Optional[str]) -> RefreshStorageAdapter:
        rest_url = (
            os.getenv("KV_REST_API_URL")
            or os.getenv("VERCEL_KV_REST_API_URL")
            or os.getenv("UPSTASH_REDIS_REST_URL")
        )
        rest_token = (
            os.getenv("KV_REST_API_TOKEN")
            or os.getenv("VERCEL_KV_REST_API_TOKEN")
            or os.getenv("UPSTASH_REDIS_REST_TOKEN")
        )
        namespace = os.getenv("VERCEL_KV_NAMESPACE")
        if rest_url and rest_token:
            try:
                return VercelKVAdapter(rest_url=rest_url, rest_token=rest_token, namespace=namespace)
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning("Falling back to in-memory refresh store after Vercel KV init failure: %s", exc)

        resolved_url = redis_url or os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
        if resolved_url:
            try:
                return RedisAdapter(resolved_url)
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning("Falling back to in-memory refresh store after Redis initialization failure: %s", exc)
        return InMemoryAdapter()

    def configure_adapter(self, adapter: RefreshStorageAdapter) -> None:
        self._adapter = adapter

    @property
    def adapter(self) -> RefreshStorageAdapter:
        return self._adapter

    async def register_refresh_session(
        self,
        *,
        refresh_hash: str,
        record: RefreshSessionRecord,
        previous_hash: Optional[str] = None,
        ttl_seconds: Optional[int] = None,
    ) -> None:
        ttl = self._resolve_ttl(ttl_seconds, self._refresh_ttl_default)
        await self._adapter.persist(refresh_hash, record, ttl)
        if previous_hash:
            await self._adapter.revoke(previous_hash, self._blacklist_ttl_default)
            record_refresh_revocation("rotation")

    async def revoke_refresh_hash(self, refresh_hash: str, ttl_seconds: Optional[int] = None) -> None:
        ttl = self._resolve_ttl(ttl_seconds, self._blacklist_ttl_default)
        await self._adapter.revoke(refresh_hash, ttl)
        record_refresh_revocation("explicit")

    async def is_refresh_hash_revoked(self, refresh_hash: str) -> bool:
        return await self._adapter.is_revoked(refresh_hash)

    async def get_refresh_session(self, refresh_hash: str) -> Optional[RefreshSessionRecord]:
        return await self._adapter.get(refresh_hash)

    @staticmethod
    def _resolve_ttl(ttl_seconds: Optional[int], default_seconds: int) -> int:
        if ttl_seconds is None:
            return default_seconds
        if ttl_seconds <= 0:
            logger.warning("Received non-positive TTL override (%s); using default %s", ttl_seconds, default_seconds)
            return default_seconds
        return ttl_seconds


_refresh_store = RefreshStore()


def get_refresh_store() -> RefreshStore:
    return _refresh_store


def configure_refresh_store(
    *,
    adapter: Optional[RefreshStorageAdapter] = None,
    redis_url: Optional[str] = None,
    refresh_ttl_seconds: Optional[int] = None,
    blacklist_ttl_seconds: Optional[int] = None,
) -> RefreshStore:
    global _refresh_store
    _refresh_store = RefreshStore(
        adapter=adapter,
        redis_url=redis_url,
        refresh_ttl_seconds=refresh_ttl_seconds,
        blacklist_ttl_seconds=blacklist_ttl_seconds,
    )
    return _refresh_store


def hash_refresh_id(refresh_id: str) -> str:
    return hashlib.sha256(refresh_id.encode("utf-8")).hexdigest()
