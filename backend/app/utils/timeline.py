from __future__ import annotations

import asyncio
import copy
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, List, Mapping, Optional, Sequence
from uuid import uuid4

from backend.app.cache.adapters import BaseCacheAdapter

from .payload_scrubber import DEFAULT_TIMELINE_SCRUBBER, ScrubberSettings, scrub_payload

try:  # pragma: no cover - optional dependency path
    from backend.app.cache.adapters import RedisCacheAdapter
except Exception:  # pragma: no cover - defensive import guard
    RedisCacheAdapter = None  # type: ignore[assignment]

logger = logging.getLogger("timeline")

STREAM_PREFIX = "timeline:"
DEFAULT_STREAM_MAXLEN = 1000

TimelineEvent = dict[str, Any]


@dataclass(frozen=True)
class ReadOptions:
    """Options controlling how timeline events are fetched."""

    count: int = 100
    block_ms: Optional[int] = None


_in_memory_timelines: dict[str, list[TimelineEvent]] = {}
_in_memory_lock: Optional[asyncio.Lock] = None


def _get_in_memory_lock() -> asyncio.Lock:
    """Get or create the in-memory lock for the current event loop."""
    global _in_memory_lock
    try:
        if _in_memory_lock is None or _in_memory_lock._loop != asyncio.get_running_loop():  # type: ignore
            _in_memory_lock = asyncio.Lock()
    except RuntimeError:
        # No running loop, create lock that will be bound to the next loop
        _in_memory_lock = asyncio.Lock()
    return _in_memory_lock


def _stream_key(query_hash: str) -> str:
    return f"{STREAM_PREFIX}{query_hash}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_stream_id(stream_id: str) -> tuple[int, int]:
    try:
        millis, sequence = stream_id.split("-", 1)
        return int(millis), int(sequence)
    except Exception:  # pragma: no cover - invalid ids should sort last
        return 0, 0


def _json_default(value: Any) -> Any:
    if isinstance(value, set):
        return list(value)
    if isinstance(value, (datetime,)):
        return value.isoformat()
    return repr(value)


def _normalize_field_key(key: Any) -> Optional[str]:
    if isinstance(key, str):
        return key
    if isinstance(key, bytes):
        try:
            return key.decode("utf-8")
        except UnicodeDecodeError:  # pragma: no cover - unexpected encoding
            return None
    return None


def _extract_message_field(fields: Any, key: str) -> Any:
    target_bytes = key.encode("utf-8")

    if isinstance(fields, Mapping):
        if key in fields:
            return fields[key]
        if target_bytes in fields:
            return fields[target_bytes]
        for candidate, value in fields.items():
            normalized = _normalize_field_key(candidate)
            if normalized == key:
                return value
        return None

    if isinstance(fields, Sequence):
        # Many Redis clients return sequences of (field, value) pairs
        for item in fields:
            if isinstance(item, Sequence) and not isinstance(item, (bytes, str)):
                if len(item) == 2:
                    candidate, value = item
                    normalized = _normalize_field_key(candidate)
                    if normalized == key:
                        return value

        # Some clients may return flattened sequences [field, value, field, value]
        it = iter(fields)
        for candidate in it:
            value = next(it, None)
            if value is None:
                break
            normalized = _normalize_field_key(candidate)
            if normalized == key:
                return value

    return None


def _coerce_message_payload(value: Any, query_hash: str) -> Optional[str]:
    if value is None:
        return None

    if isinstance(value, str):
        return value

    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            return bytes(value).decode("utf-8")
        except UnicodeDecodeError:  # pragma: no cover - unexpected encoding
            logger.warning("Failed to decode timeline event bytes for %s", query_hash)
            return None

    # Some Redis clients may return nested sequences like [b"{...}"]
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray, memoryview)):
        if len(value) == 1:
            return _coerce_message_payload(value[0], query_hash)

    logger.debug("Unsupported timeline payload type %s for %s", type(value), query_hash)
    return None


async def _write_in_memory(event: TimelineEvent) -> TimelineEvent:
    async with _get_in_memory_lock():
        events = _in_memory_timelines.setdefault(event["query_hash"], [])
        sequence = len(events) + 1
        stream_id = f"{int(datetime.now(timezone.utc).timestamp() * 1000)}-{sequence}"
        event_with_ids = copy.deepcopy(event)
        event_with_ids.setdefault("stream_id", stream_id)
        event_with_ids.setdefault("sequence", sequence)
        events.append(event_with_ids)
        return copy.deepcopy(event_with_ids)


def _is_redis_adapter(adapter: BaseCacheAdapter) -> bool:
    return RedisCacheAdapter is not None and isinstance(adapter, RedisCacheAdapter)


async def publish_timeline_event(
    cache_adapter: BaseCacheAdapter,
    *,
    query_hash: str,
    step: str,
    payload: Mapping[str, Any] | None,
    scrubber: ScrubberSettings | None = None,
    max_stream_length: int = DEFAULT_STREAM_MAXLEN,
    event_id: str | None = None,
    stream_ttl_seconds: int = 3600,  # 1 hour default TTL for timeline streams
) -> TimelineEvent:
    """Publish a timeline event and return the stored payload."""

    scrub_settings = scrubber or DEFAULT_TIMELINE_SCRUBBER
    safe_payload = scrub_payload(payload or {}, scrub_settings)
    base_event: TimelineEvent = {
        "event_id": event_id or str(uuid4()),
        "query_hash": query_hash,
        "step": step,
        "timestamp": _now_iso(),
        "payload": safe_payload,
    }

    if _is_redis_adapter(cache_adapter):
        try:
            redis_client = cache_adapter._client  # type: ignore[attr-defined]
            stream_key = _stream_key(query_hash)
            serialized = json.dumps(base_event, default=_json_default)
            entry_id = await redis_client.xadd(
                stream_key,
                {"data": serialized},
                maxlen=max_stream_length,
                approximate=True,
            )
            # Set TTL on the stream key to prevent indefinite accumulation
            await redis_client.expire(stream_key, stream_ttl_seconds)
            millis, seq = _parse_stream_id(entry_id)
            base_event["stream_id"] = entry_id
            base_event["sequence"] = seq
            base_event["stream_timestamp"] = millis
            return base_event
        except Exception as exc:  # pragma: no cover - network issues
            logger.warning("Redis timeline publishing failed, falling back to memory: %s", exc)

    stored_event = await _write_in_memory(base_event)
    return stored_event


async def read_timeline_events(
    cache_adapter: BaseCacheAdapter,
    *,
    query_hash: str,
    last_id: str | None = None,
    options: ReadOptions | None = None,
) -> List[TimelineEvent]:
    """Read timeline events newer than *last_id* for *query_hash*."""

    read_opts = options or ReadOptions()

    if _is_redis_adapter(cache_adapter):
        try:
            redis_client = cache_adapter._client  # type: ignore[attr-defined]
            stream_key = _stream_key(query_hash)
            start_id = last_id or "0-0"
            response = await redis_client.xread(
                {stream_key: start_id},
                count=read_opts.count,
                block=read_opts.block_ms,
            )
            events: list[TimelineEvent] = []
            if not response:
                return []

            for _, entries in response:
                for entry_id, fields in entries:
                    # Ensure entry_id is a string (Redis clients may return bytes)
                    if isinstance(entry_id, bytes):
                        entry_id = entry_id.decode("utf-8")
                    elif not isinstance(entry_id, str):
                        entry_id = str(entry_id)
                    
                    raw = _extract_message_field(fields, "data")
                    raw_text = _coerce_message_payload(raw, query_hash)
                    if raw_text is None:
                        continue
                    try:
                        event = json.loads(raw_text)
                    except json.JSONDecodeError:
                        logger.warning("Failed to decode timeline event for %s", query_hash)
                        continue
                    millis, seq = _parse_stream_id(entry_id)
                    event["stream_id"] = entry_id
                    event.setdefault("sequence", seq)
                    event.setdefault("stream_timestamp", millis)
                    events.append(event)
            return events
        except Exception as exc:  # pragma: no cover - redis path
            logger.warning("Redis timeline read failed, falling back to memory: %s", exc)

    async with _get_in_memory_lock():
        events = copy.deepcopy(_in_memory_timelines.get(query_hash, []))

    if not last_id:
        return events[-read_opts.count :]

    last_tuple = _parse_stream_id(last_id)
    filtered = [event for event in events if _parse_stream_id(event.get("stream_id", "0-0")) > last_tuple]
    return filtered[-read_opts.count :]


async def clear_in_memory_timelines(query_hash: Optional[str] = None) -> None:
    """Utility for tests to reset the in-memory store."""

    async with _get_in_memory_lock():
        if query_hash is None:
            _in_memory_timelines.clear()
        else:
            _in_memory_timelines.pop(query_hash, None)


async def clear_timeline(
    cache_adapter: BaseCacheAdapter,
    query_hash: str,
) -> None:
    """Clear timeline events for a specific query_hash from both Redis and in-memory storage.
    
    This is useful when starting a fresh search to prevent accumulation of events
    from previous runs with the same query_hash.
    """
    # Clear from Redis if using Redis adapter
    if _is_redis_adapter(cache_adapter):
        try:
            redis_client = cache_adapter._client  # type: ignore[attr-defined]
            stream_key = _stream_key(query_hash)
            await redis_client.delete(stream_key)
            logger.debug("Cleared Redis timeline stream for %s", query_hash)
        except Exception as exc:  # pragma: no cover - network issues
            logger.warning("Failed to clear Redis timeline for %s: %s", query_hash, exc)
    
    # Clear from in-memory storage
    await clear_in_memory_timelines(query_hash)


def clear_in_memory_timelines_sync(query_hash: Optional[str] = None) -> None:
    """Synchronous utility for tests to reset the in-memory store.
    
    WARNING: This bypasses the async lock and should only be used in test fixtures
    where no async operations are running.
    """
    if query_hash is None:
        _in_memory_timelines.clear()
    else:
        _in_memory_timelines.pop(query_hash, None)


def publish_timeline_event_sync(
    query_hash: str,
    step: str,
    payload: Mapping[str, Any] | None,
    event_id: str | None = None,
) -> TimelineEvent:
    """Synchronous utility for tests to publish timeline events to in-memory store.
    
    WARNING: This bypasses the async lock and Redis, writing directly to in-memory storage.
    Should only be used in test fixtures where no async operations are running.
    """
    scrub_settings = DEFAULT_TIMELINE_SCRUBBER
    safe_payload = scrub_payload(payload or {}, scrub_settings)
    base_event: TimelineEvent = {
        "event_id": event_id or str(uuid4()),
        "query_hash": query_hash,
        "step": step,
        "timestamp": _now_iso(),
        "payload": safe_payload,
    }
    
    events = _in_memory_timelines.setdefault(query_hash, [])
    sequence = len(events) + 1
    stream_id = f"{int(datetime.now(timezone.utc).timestamp() * 1000)}-{sequence}"
    base_event["stream_id"] = stream_id
    base_event["sequence"] = sequence
    events.append(base_event)
    return base_event

