import asyncio
import json
import time
from typing import Any, Dict, Optional

import httpx  # type: ignore[import-not-found]
import pytest  # type: ignore[import]

import backend.app.security.refresh_store as refresh_store
from backend.app.security.refresh_store import (
    InMemoryAdapter,
    RedisAdapter,
    RefreshSessionRecord,
    RefreshStore,
)


@pytest.mark.asyncio
async def test_inmemory_register_rotation_blacklists_previous_hash() -> None:
    store = RefreshStore(adapter=InMemoryAdapter(), refresh_ttl_seconds=30, blacklist_ttl_seconds=30)
    current_record = RefreshSessionRecord(
        user_id="user-1",
        role="user",
        session_id="session-current",
        issued_at=int(time.time()),
        expires_at=int(time.time()) + 30,
        version=1,
    )

    await store.register_refresh_session(
        refresh_hash="hash-current",
        record=current_record,
        previous_hash="hash-previous",
    )

    assert await store.get_refresh_session("hash-current") is not None
    assert await store.is_refresh_hash_revoked("hash-previous")


@pytest.mark.asyncio
async def test_inmemory_refresh_session_expires_after_ttl() -> None:
    store = RefreshStore(adapter=InMemoryAdapter(), refresh_ttl_seconds=1, blacklist_ttl_seconds=30)
    record = RefreshSessionRecord(
        user_id="user-2",
        role="user",
        session_id="session-ttl",
        issued_at=int(time.time()),
        expires_at=int(time.time()) + 1,
        version=1,
    )

    await store.register_refresh_session(refresh_hash="hash-ttl", record=record)
    assert await store.get_refresh_session("hash-ttl") is not None
    await asyncio.sleep(1.1)
    assert await store.get_refresh_session("hash-ttl") is None


@pytest.mark.asyncio
async def test_redis_adapter_blacklist_with_fakeredis() -> None:
    fakeredis_module = pytest.importorskip("fakeredis.aioredis")
    fake_client = fakeredis_module.FakeRedis(decode_responses=True)

    adapter = RedisAdapter("redis://localhost", client=fake_client)
    store = RefreshStore(adapter=adapter, refresh_ttl_seconds=30, blacklist_ttl_seconds=15)
    record = RefreshSessionRecord(
        user_id="user-redis",
        role="admin",
        session_id="session-redis",
        issued_at=int(time.time()),
        expires_at=int(time.time()) + 30,
        version=1,
    )

    await store.register_refresh_session(refresh_hash="hash-redis", record=record)
    assert await store.get_refresh_session("hash-redis") is not None

    await store.revoke_refresh_hash("hash-redis")
    assert await store.is_refresh_hash_revoked("hash-redis")

    await fake_client.aclose()


@pytest.mark.asyncio
async def test_vercel_kv_adapter_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    namespace = "kvns"
    kv_state: Dict[str, Dict[str, Any]] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("Authorization") == "Bearer token"
        try:
            command = json.loads(request.content.decode("utf-8"))
        except json.JSONDecodeError:  # pragma: no cover - defensive
            return httpx.Response(400, json={"error": "invalid-json"})

        cmd = str(command[0]).upper()

        def record_entry(key: str, value: Any, ttl: Optional[int]) -> httpx.Response:
            expires_at = time.time() + ttl if ttl else float("inf")
            kv_state[key] = {"value": value, "expires_at": expires_at}
            return httpx.Response(200, json={"result": "OK"})

        if cmd == "SET":
            key = command[1]
            value = command[2]
            ttl = None
            for idx in range(3, len(command), 2):
                token = str(command[idx]).upper()
                if token in {"EX", "PX"}:
                    ttl = int(command[idx + 1])
                    if token == "PX":
                        ttl = max(1, ttl // 1000)
                    break
            return record_entry(key, value, ttl)

        if cmd == "GET":
            key = command[1]
            entry = kv_state.get(key)
            if not entry or entry["expires_at"] <= time.time():
                kv_state.pop(key, None)
                return httpx.Response(200, json={"result": None})
            return httpx.Response(200, json={"result": entry["value"]})

        if cmd == "EXISTS":
            key = command[1]
            entry = kv_state.get(key)
            if entry and entry["expires_at"] > time.time():
                return httpx.Response(200, json={"result": 1})
            kv_state.pop(key, None)
            return httpx.Response(200, json={"result": 0})

        return httpx.Response(400, json={"error": f"unsupported {cmd}"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="https://kv.example") as client:
        adapter = refresh_store.VercelKVAdapter(
            rest_url="https://kv.example",
            rest_token="token",
            namespace=namespace,
            client=client,
        )
        store = RefreshStore(adapter=adapter, refresh_ttl_seconds=120, blacklist_ttl_seconds=45)
        record = RefreshSessionRecord(
            user_id="user-vercel",
            role="member",
            session_id="session-vercel",
            issued_at=int(time.time()),
            expires_at=int(time.time()) + 120,
            version=1,
        )

        await store.register_refresh_session(
            refresh_hash="hash-vercel",
            record=record,
            previous_hash="hash-old",
        )

        session_key = f"{namespace}:{refresh_store.REFRESH_SESSION_PREFIX}hash-vercel"
        blacklist_key = f"{namespace}:{refresh_store.REFRESH_BLACKLIST_PREFIX}hash-old"
        assert session_key in kv_state
        assert blacklist_key in kv_state

        fetched = await store.get_refresh_session("hash-vercel")
        assert fetched is not None
        assert fetched.user_id == "user-vercel"

        await store.revoke_refresh_hash("hash-vercel")
        assert await store.is_refresh_hash_revoked("hash-vercel")


def test_refresh_store_prefers_vercel_kv_when_env_present(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyAdapter(refresh_store.RefreshStorageAdapter):
        def __init__(
            self,
            *,
            rest_url: str,
            rest_token: str,
            namespace: Optional[str] = None,
            timeout: float = 5.0,
            client: Optional[Any] = None,
        ) -> None:
            self.rest_url = rest_url
            self.rest_token = rest_token
            self.namespace = namespace
            self.timeout = timeout
            self.client = client

        async def persist(self, hash_: str, record: RefreshSessionRecord, ttl_seconds: int) -> None:  # pragma: no cover
            raise NotImplementedError

        async def revoke(self, hash_: str, ttl_seconds: int) -> None:  # pragma: no cover
            raise NotImplementedError

        async def get(self, hash_: str) -> Optional[RefreshSessionRecord]:  # pragma: no cover
            raise NotImplementedError

        async def is_revoked(self, hash_: str) -> bool:  # pragma: no cover
            raise NotImplementedError

    monkeypatch.setenv("KV_REST_API_URL", "https://kv.example")
    monkeypatch.setenv("KV_REST_API_TOKEN", "kv-secret")
    monkeypatch.setenv("VERCEL_KV_NAMESPACE", "prod")
    monkeypatch.setenv("REDIS_URL", "redis://should-not-be-used")

    monkeypatch.setattr(refresh_store, "VercelKVAdapter", DummyAdapter)

    store = refresh_store.RefreshStore()

    assert isinstance(store.adapter, DummyAdapter)
    assert store.adapter.rest_url == "https://kv.example"
    assert store.adapter.rest_token == "kv-secret"
    assert store.adapter.namespace == "prod"