from __future__ import annotations

import asyncio
import base64
import logging
import time
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger("cache.adapters")

try:  # pragma: no cover - optional dependencies
    import httpx  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependencies
    httpx = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependencies
    import redis.asyncio as redis  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependencies
    redis = None  # type: ignore[assignment]


class CacheError(RuntimeError):
    """Raised when the cache backend encounters an unrecoverable error."""


@dataclass(frozen=True)
class CacheValue:
    payload: bytes
    expires_at: float


def _encode_value(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _decode_value(value: str) -> bytes:
    return base64.b64decode(value.encode("ascii"))


class BaseCacheAdapter:
    async def get(self, key: str) -> Optional[bytes]:
        raise NotImplementedError

    async def set(self, key: str, value: bytes, ttl_seconds: int) -> None:
        raise NotImplementedError

    async def set_persistent(self, key: str, value: bytes) -> None:
        raise NotImplementedError

    async def delete(self, key: str) -> None:
        raise NotImplementedError

    async def exists(self, key: str) -> bool:
        raise NotImplementedError


class VercelKVCacheAdapter(BaseCacheAdapter):
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
            raise CacheError("httpx is required for VercelKVCacheAdapter but is not installed")
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
                raise CacheError("httpx client unavailable")
            client = httpx.AsyncClient(base_url=self._rest_url, timeout=self._timeout)
            owns_client = True

        try:
            response = await client.post("/", json=command, headers=self._headers)
        except Exception as exc:  # pragma: no cover - network failure path
            raise CacheError(f"Vercel KV request failed: {exc}") from exc
        finally:
            if owns_client:
                await client.aclose()

        if response.status_code >= 400:
            raise CacheError(f"Vercel KV responded with HTTP {response.status_code}: {response.text}")

        try:
            payload = response.json()
        except ValueError as exc:  # pragma: no cover - unexpected response
            raise CacheError("Failed to decode Vercel KV response") from exc

        if "error" in payload:
            raise CacheError(f"Vercel KV command error: {payload['error']}")

        return payload.get("result")

    async def get(self, key: str) -> Optional[bytes]:
        qualified = self._qualify(key)
        result = await self._execute(["GET", qualified])
        if result is None:
            return None
        if not isinstance(result, str):
            logger.warning("Unexpected payload from Vercel KV for key %s", qualified)
            return None
        try:
            return _decode_value(result)
        except Exception as exc:  # pragma: no cover - defensive path
            logger.warning("Failed to decode cache value for %s: %s", qualified, exc)
            return None

    async def set(self, key: str, value: bytes, ttl_seconds: int) -> None:
        qualified = self._qualify(key)
        encoded = _encode_value(value)
        await self._execute(["SET", qualified, encoded, "EX", str(max(ttl_seconds, 1))])

    async def set_persistent(self, key: str, value: bytes) -> None:
        qualified = self._qualify(key)
        encoded = _encode_value(value)
        await self._execute(["SET", qualified, encoded])

    async def delete(self, key: str) -> None:
        qualified = self._qualify(key)
        await self._execute(["DEL", qualified])

    async def exists(self, key: str) -> bool:
        qualified = self._qualify(key)
        result = await self._execute(["EXISTS", qualified])
        return bool(result)


class RedisCacheAdapter(BaseCacheAdapter):
    def __init__(self, url: str, *, client: Optional[Any] = None) -> None:
        if redis is None:
            raise CacheError("redis library is required for RedisCacheAdapter")
        self._client = client or redis.from_url(url, decode_responses=False)

    async def get(self, key: str) -> Optional[bytes]:
        result = await self._client.get(key)
        if result is None:
            return None
        if isinstance(result, bytes):
            return result
        if isinstance(result, str):
            return result.encode("utf-8")
        logger.warning("Unexpected Redis payload type for key %s: %s", key, type(result))
        return None

    async def set(self, key: str, value: bytes, ttl_seconds: int) -> None:
        await self._client.set(key, value, ex=max(ttl_seconds, 1))

    async def set_persistent(self, key: str, value: bytes) -> None:
        await self._client.set(key, value)

    async def delete(self, key: str) -> None:
        await self._client.delete(key)

    async def exists(self, key: str) -> bool:
        result = await self._client.exists(key)
        return bool(result)


class InMemoryCacheAdapter(BaseCacheAdapter):
    def __init__(self) -> None:
        self._data: dict[str, CacheValue] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[bytes]:
        async with self._lock:
            entry = self._data.get(key)
            if not entry:
                return None
            if time.time() >= entry.expires_at:
                self._data.pop(key, None)
                return None
            return entry.payload

    async def set(self, key: str, value: bytes, ttl_seconds: int) -> None:
        expires_at = time.time() + max(ttl_seconds, 1)
        async with self._lock:
            self._data[key] = CacheValue(payload=value, expires_at=expires_at)

    async def set_persistent(self, key: str, value: bytes) -> None:
        async with self._lock:
            self._data[key] = CacheValue(payload=value, expires_at=float("inf"))

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._data.pop(key, None)

    async def exists(self, key: str) -> bool:
        async with self._lock:
            entry = self._data.get(key)
            if not entry:
                return False
            if time.time() >= entry.expires_at:
                self._data.pop(key, None)
                return False
            return True
