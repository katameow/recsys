from __future__ import annotations

import pytest

import json
from unittest.mock import AsyncMock, MagicMock

from backend.app.cache.adapters import InMemoryCacheAdapter, RedisCacheAdapter
from backend.app.utils.payload_scrubber import DEFAULT_TIMELINE_SCRUBBER, scrub_payload
from backend.app.utils.timeline import (
    ReadOptions,
    clear_in_memory_timelines,
    publish_timeline_event,
    read_timeline_events,
)


def test_scrub_payload_respects_redaction_and_truncation() -> None:
    payload = {
        "email": "user@example.com",
        "prompt": "Lorem ipsum " * 80,
        "details": {"refresh_token": "super-secret-token"},
        "query": "smart speaker",
    }

    scrubbed = scrub_payload(payload, DEFAULT_TIMELINE_SCRUBBER)
    assert scrubbed["email"].startswith("[hash:")
    assert scrubbed["prompt"].startswith("[hash:")
    assert scrubbed["details"]["refresh_token"].startswith("[hash:")
    assert scrubbed["query"] == "smart speaker"

    debug_scrubbed = scrub_payload(payload, DEFAULT_TIMELINE_SCRUBBER, debug_truncation_override=True)
    assert debug_scrubbed["prompt"].endswith("…")
    assert len(debug_scrubbed["prompt"]) <= DEFAULT_TIMELINE_SCRUBBER.max_truncate_length + 1


@pytest.mark.asyncio
async def test_publish_and_read_timeline_in_memory() -> None:
    adapter = InMemoryCacheAdapter()
    await clear_in_memory_timelines("qhash")

    event_one = await publish_timeline_event(
        adapter,
        query_hash="qhash",
        step="search.requested",
        payload={"query": "smart speaker", "email": "user@example.com"},
    )

    assert event_one["payload"]["email"].startswith("[hash:")
    assert "stream_id" in event_one
    assert event_one["sequence"] == 1

    event_two = await publish_timeline_event(
        adapter,
        query_hash="qhash",
        step="response.completed",
        payload={"query": "smart speaker", "finish_reason": "done"},
    )

    assert event_two["sequence"] == 2

    events = await read_timeline_events(adapter, query_hash="qhash")
    assert [e["event_id"] for e in events] == [event_one["event_id"], event_two["event_id"]]

    newer_events = await read_timeline_events(
        adapter,
        query_hash="qhash",
        last_id=event_one["stream_id"],
        options=ReadOptions(count=5),
    )
    assert len(newer_events) == 1
    assert newer_events[0]["event_id"] == event_two["event_id"]


@pytest.mark.asyncio
async def test_read_timeline_events_handles_redis_structures() -> None:
    payload_one = json.dumps(
        {
            "event_id": "e1",
            "query_hash": "qhash",
            "step": "search.cache.miss",
            "payload": {"source": "redis"},
        }
    )
    payload_two = json.dumps(
        {
            "event_id": "e2",
            "query_hash": "qhash",
            "step": "search.engine.started",
            "payload": {"source": "redis", "reviews": 3},
        }
    )
    payload_three = json.dumps(
        {
            "event_id": "e3",
            "query_hash": "qhash",
            "step": "search.bq.started",
            "payload": {"source": "redis", "k": 12},
        }
    )

    fake_client = MagicMock()
    fake_client.xread = AsyncMock(
        return_value=[
            (
                "timeline:qhash",
                [
                    ("1759456209589-0", {b"data": payload_one.encode("utf-8")}),
                    ("1759456209698-0", [(b"data", payload_two.encode("utf-8"))]),
                    ("1759456210888-0", [b"data", payload_three.encode("utf-8")]),
                    ("1759456217006-0", {b"data": memoryview(payload_one.encode("utf-8"))}),
                ],
            )
        ]
    )

    adapter = RedisCacheAdapter.__new__(RedisCacheAdapter)
    adapter._client = fake_client

    events = await read_timeline_events(
        adapter,
        query_hash="qhash",
        last_id=None,
        options=ReadOptions(count=10, block_ms=0),
    )

    assert [event["event_id"] for event in events] == ["e1", "e2", "e3", "e1"]
    assert all(event["query_hash"] == "qhash" for event in events)
    assert events[0]["step"] == "search.cache.miss"
    assert events[1]["step"] == "search.engine.started"
    assert events[2]["payload"]["k"] == 12
    fake_client.xread.assert_awaited()
