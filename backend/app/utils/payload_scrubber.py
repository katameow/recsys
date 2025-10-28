from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

__all__ = [
    "ScrubberSettings",
    "DEFAULT_TIMELINE_SCRUBBER",
    "scrub_payload",
    "truncate_text",
]


@dataclass(frozen=True)
class ScrubberSettings:
    """Settings controlling how sensitive payload fields are sanitized."""

    redact_fields: set[str] = field(default_factory=set)
    truncate_fields: set[str] = field(default_factory=set)
    passthrough_fields: set[str] = field(default_factory=set)
    max_truncate_length: int = 256
    mask: str = "[redacted]"
    hash_mask: bool = True
    debug_truncation_enabled: bool = False

    def normalized(self) -> "ScrubberSettings":
        """Return a copy with all field sets lower-cased for case-insensitive matching."""

        return ScrubberSettings(
            redact_fields={field.lower() for field in self.redact_fields},
            truncate_fields={field.lower() for field in self.truncate_fields},
            passthrough_fields={field.lower() for field in self.passthrough_fields},
            max_truncate_length=self.max_truncate_length,
            mask=self.mask,
            hash_mask=self.hash_mask,
            debug_truncation_enabled=self.debug_truncation_enabled,
        )


def truncate_text(text: str, max_length: int) -> str:
    """Truncate *text* to *max_length* characters, appending an ellipsis if needed."""

    if max_length <= 0:
        return ""
    if len(text) <= max_length:
        return text
    return text[:max_length] + "\u2026"


def _hash_value(value: Any) -> str:
    """Return a deterministic hash representation for logging without leaking payloads."""

    stringified = repr(value)
    digest = hashlib.sha256(stringified.encode("utf-8")).hexdigest()
    return f"[hash:{digest[:16]}]"


def scrub_payload(
    payload: Any,
    settings: ScrubberSettings,
    *,
    debug_truncation_override: bool | None = None,
) -> Any:
    """Return a sanitized copy of *payload* based on *settings*.

    Args:
        payload: Arbitrary JSON-serialisable structure.
        settings: Scrubber configuration describing which keys to redact or truncate.
        debug_truncation_override: Enable truncated output even for sensitive keys. When
            ``None`` (default) the value from the settings is used. When ``False`` it
            forces full redaction. When ``True`` truncated values are emitted for
            configured keys (still capped by ``max_truncate_length``).
    """

    normalised = settings.normalized()
    allow_truncation = (
        normalised.debug_truncation_enabled
        if debug_truncation_override is None
        else debug_truncation_override
    )

    def _scrub(value: Any, *, parent_key: str | None = None) -> Any:
        if isinstance(value, Mapping):
            result: dict[str, Any] = {}
            for key, child in value.items():
                lower_key = key.lower()
                if lower_key in normalised.passthrough_fields:
                    result[key] = _scrub(child, parent_key=lower_key)
                    continue

                if lower_key in normalised.redact_fields:
                    masking = normalised.mask
                    if normalised.hash_mask:
                        masking = _hash_value(child)
                    result[key] = masking
                    continue

                if lower_key in normalised.truncate_fields:
                    if allow_truncation and isinstance(child, str):
                        result[key] = truncate_text(child, normalised.max_truncate_length)
                    else:
                        if normalised.hash_mask:
                            result[key] = _hash_value(child)
                        else:
                            result[key] = normalised.mask
                    continue

                result[key] = _scrub(child, parent_key=lower_key)
            return result

        if isinstance(value, (list, tuple, set, frozenset)):
            sequence: Sequence[Any] = value if isinstance(value, Sequence) else list(value)
            cleaned = [_scrub(item, parent_key=parent_key) for item in sequence]
            return type(value)(cleaned) if not isinstance(value, list) else cleaned

        if isinstance(value, bytes):
            return truncate_text(value.decode("utf-8", errors="replace"), normalised.max_truncate_length)

        return value

    return _scrub(payload)


DEFAULT_TIMELINE_SCRUBBER = ScrubberSettings(
    redact_fields={"email", "user_id", "access_token", "refresh_token"},
    truncate_fields={"prompt", "response_fragment", "llm_input", "llm_output"},
    passthrough_fields={"query", "asin", "product_id", "score", "step"},
    max_truncate_length=512,
    mask="[scrubbed]",
    hash_mask=True,
    debug_truncation_enabled=False,
)
