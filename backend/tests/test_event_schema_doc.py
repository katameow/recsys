from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

import pytest

DOC_PATH = Path(__file__).resolve().parents[2] / ".github" / "instructions" / "event_schema.md"

CODE_BLOCK_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)
REQUIRED_FIELDS = {"event_id", "query_hash", "step", "timestamp", "sequence", "stream_id", "payload"}

EXAMPLES = CODE_BLOCK_RE.findall(DOC_PATH.read_text())

if not EXAMPLES:  # pragma: no cover - guard rails for documentation regressions
    raise AssertionError("event_schema.md must contain at least one JSON example")


@pytest.mark.parametrize("example", EXAMPLES)
def test_schema_examples_are_valid(example: str) -> None:
    event = json.loads(example)

    missing = REQUIRED_FIELDS - event.keys()
    assert not missing, f"Missing required keys: {missing}"

    # Validate types and value formats
    uuid.UUID(event["event_id"])
    assert isinstance(event["query_hash"], str) and event["query_hash"], "query_hash must be a non-empty string"
    assert isinstance(event["step"], str)
    datetime.fromisoformat(event["timestamp"])
    assert isinstance(event["sequence"], int)
    assert isinstance(event["stream_id"], str)
    assert isinstance(event["payload"], dict)

    stream_ts = event.get("stream_timestamp")
    if stream_ts is not None:
        assert isinstance(stream_ts, int)
