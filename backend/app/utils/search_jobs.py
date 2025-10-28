from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class JobRecord:
    query: str
    status: str
    created_at: str
    updated_at: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


_jobs: Dict[str, JobRecord] = {}
_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    """Get or create the lock for the current event loop."""
    global _lock
    try:
        if _lock is None or _lock._loop != asyncio.get_running_loop():  # type: ignore
            _lock = asyncio.Lock()
    except RuntimeError:
        # No running loop, create lock that will be bound to the next loop
        _lock = asyncio.Lock()
    return _lock


async def mark_pending(
    query_hash: str,
    *,
    query: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    async with _get_lock():
        now = _now_iso()
        record = _jobs.get(query_hash)
        if record is None:
            record = JobRecord(
                query=query,
                status="pending",
                created_at=now,
                updated_at=now,
                metadata=metadata or {},
            )
        else:
            record.query = query or record.query
            record.status = "pending"
            record.updated_at = now
            record.result = None
            record.error = None
            if metadata:
                record.metadata.update(metadata)
        _jobs[query_hash] = record
        return record.to_dict()


async def mark_completed(query_hash: str, *, result: Dict[str, Any]) -> Dict[str, Any]:
    async with _get_lock():
        now = _now_iso()
        record = _jobs.get(query_hash)
        if record is None:
            record = JobRecord(
                query="",
                status="completed",
                created_at=now,
                updated_at=now,
            )
        record.status = "completed"
        record.result = result
        record.error = None
        record.updated_at = now
        _jobs[query_hash] = record
        return record.to_dict()


async def mark_failed(query_hash: str, *, error: str) -> Dict[str, Any]:
    async with _get_lock():
        now = _now_iso()
        record = _jobs.get(query_hash)
        if record is None:
            record = JobRecord(
                query="",
                status="failed",
                created_at=now,
                updated_at=now,
            )
        record.status = "failed"
        record.error = error
        record.updated_at = now
        _jobs[query_hash] = record
        return record.to_dict()


async def get_job(query_hash: str) -> Optional[Dict[str, Any]]:
    async with _get_lock():
        record = _jobs.get(query_hash)
        return record.to_dict() if record else None


async def clear_job(query_hash: str) -> None:
    async with _get_lock():
        _jobs.pop(query_hash, None)


async def reset_jobs() -> None:
    async with _get_lock():
        _jobs.clear()


def reset_jobs_sync() -> None:
    """Synchronous utility for tests to reset the jobs store.
    
    WARNING: This bypasses the async lock and should only be used in test fixtures
    where no async operations are running.
    """
    _jobs.clear()


def mark_pending_sync(
    query_hash: str,
    *,
    query: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Synchronous utility for tests to mark a job as pending.
    
    WARNING: This bypasses the async lock and should only be used in test fixtures
    where no async operations are running.
    """
    now = _now_iso()
    record = _jobs.get(query_hash)
    if record is None:
        record = JobRecord(
            query=query,
            status="pending",
            created_at=now,
            updated_at=now,
            metadata=metadata or {},
        )
    else:
        record.query = query or record.query
        record.status = "pending"
        record.updated_at = now
        record.result = None
        record.error = None
        if metadata:
            record.metadata.update(metadata)
    _jobs[query_hash] = record
    return record.to_dict()


def mark_completed_sync(query_hash: str, *, result: Dict[str, Any]) -> Dict[str, Any]:
    """Synchronous utility for tests to mark a job as completed.
    
    WARNING: This bypasses the async lock and should only be used in test fixtures
    where no async operations are running.
    """
    now = _now_iso()
    record = _jobs.get(query_hash)
    if record is None:
        record = JobRecord(
            query="",
            status="completed",
            created_at=now,
            updated_at=now,
        )
    record.status = "completed"
    record.result = result
    record.error = None
    record.updated_at = now
    _jobs[query_hash] = record
    return record.to_dict()
