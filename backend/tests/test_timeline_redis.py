import pytest
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

from backend.app.cache.adapters import RedisCacheAdapter
from backend.app.utils.timeline import publish_timeline_event, clear_in_memory_timelines


@pytest.mark.asyncio
async def test_publish_uses_xadd_with_maxlen(monkeypatch):
    # Arrange: make a fake redis client with xadd spy
    fake_redis = MagicMock()
    fake_redis.xadd = AsyncMock(return_value="1234567890-1")

    adapter = RedisCacheAdapter.__new__(RedisCacheAdapter)
    adapter._client = fake_redis

    # Act
    await clear_in_memory_timelines("rtest")
    event = await publish_timeline_event(
        adapter,
        query_hash="rtest",
        step="search.bq.started",
        payload={"q": "test"},
        max_stream_length=42,
    )

    # Assert xadd was called with maxlen param and approximate trimming
    fake_redis.xadd.assert_awaited()
    called_args, called_kwargs = fake_redis.xadd.call_args
    # xadd signature: (stream_key, mapping, maxlen=..., approximate=True)
    assert called_kwargs.get("maxlen") == 42 or (len(called_args) >= 3 and called_args[2] == 42)
    assert event["stream_id"] == "1234567890-1"