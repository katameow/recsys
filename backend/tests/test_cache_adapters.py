from __future__ import annotations

import asyncio
import base64
from typing import Any

import pytest

from backend.app.cache import (
    BaseCacheAdapter,
    InMemoryCacheAdapter,
    VercelKVCacheAdapter,
)
from backend.app.cache.adapters import CacheError
from backend.app.utils import cache_utils


class _StubKVClient:
    def __init__(self) -> None:
        self.commands: list[tuple[list[Any], dict[str, Any]]] = []

    async def post(self, url: str, json: list[Any], headers: dict[str, str]) -> "_StubResponse":
        self.commands.append((json, headers))
        command = json[0]
        key = json[1]
        if command == "GET":
            value = base64.b64encode(f"payload:{key}".encode()).decode()
            return _StubResponse({"result": value})
        if command == "SET":
            return _StubResponse({"result": "OK"})
        if command == "DEL":
            return _StubResponse({"result": 1})
        if command == "EXISTS":
            return _StubResponse({"result": 1})
        return _StubResponse({"result": None})

    async def aclose(self) -> None:
        return


class _StubResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict[str, Any]:
        return self._payload

    @property
    def text(self) -> str:
        return str(self._payload)


@pytest.mark.asyncio
async def test_inmemory_cache_adapter_roundtrip() -> None:
    adapter = InMemoryCacheAdapter()

    await adapter.set("demo", b"value", 10)
    assert await adapter.exists("demo") is True
    assert await adapter.get("demo") == b"value"

    await adapter.delete("demo")
    assert await adapter.get("demo") is None


@pytest.mark.asyncio
async def test_vercel_kv_adapter_success(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _StubKVClient()
    adapter = VercelKVCacheAdapter(
        rest_url="https://example.com",
        rest_token="token",
        namespace="ns",
        client=client,
    )

    await adapter.set("key", b"value", 60)
    cached = await adapter.get("key")
    assert cached == b"payload:ns:key"
    assert await adapter.exists("key") is True
    await adapter.delete("key")


@pytest.mark.asyncio
async def test_vercel_kv_adapter_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    class _ErrorResponse(_StubResponse):
        def __init__(self) -> None:
            super().__init__({"error": "boom"})
            self.status_code = 400

    class _FailClient(_StubKVClient):
        async def post(self, url: str, json: list[Any], headers: dict[str, str]) -> _StubResponse:
            return _ErrorResponse()

    client = _FailClient()
    adapter = VercelKVCacheAdapter(
        rest_url="https://example.com",
        rest_token="token",
        client=client,
    )

    with pytest.raises(CacheError):
        await adapter.get("missing")


@pytest.mark.asyncio
async def test_cache_adapter_contract(adapter: BaseCacheAdapter) -> None:
    await adapter.set("contract", b"data", 1)
    assert await adapter.exists("contract") is True
    value = await adapter.get("contract")
    assert value == b"data"
    await adapter.delete("contract")
    assert await adapter.get("contract") is None


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    if "adapter" in metafunc.fixturenames:
        adapters = [InMemoryCacheAdapter()]
        metafunc.parametrize("adapter", adapters, ids=["memory"])


def test_response_cache_key_hashes_query() -> None:
    key = cache_utils.build_response_cache_key(
        schema_version=1,
        query="Smart Speaker",
        products_k=3,
        reviews_per_product=3,
        extra={"guest": True},
    )
    assert "Smart" not in key and "Speaker" not in key
    assert key.startswith("cache:response:v1:")
