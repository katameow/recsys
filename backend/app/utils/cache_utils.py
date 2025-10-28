from __future__ import annotations

import gzip
import json
import re
from hashlib import sha256
from typing import Any, Dict, Optional

_WHITESPACE_RE = re.compile(r"\s+")


def canonicalize_query(query: str) -> str:
    normalized = _WHITESPACE_RE.sub(" ", (query or "").strip())
    return normalized.lower()


def build_query_fingerprint(
    *,
    query: str,
    products_k: int,
    reviews_per_product: int,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    payload: Dict[str, Any] = {
        "query": canonicalize_query(query),
        "productsK": int(products_k),
        "reviewsPerProduct": int(reviews_per_product),
    }
    if extra:
        payload.update(extra)
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def build_response_cache_key(
    *,
    schema_version: int,
    query: str,
    products_k: int,
    reviews_per_product: int,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    fingerprint = build_query_fingerprint(
        query=query,
        products_k=products_k,
        reviews_per_product=reviews_per_product,
        extra=extra,
    )
    digest = sha256(fingerprint.encode("utf-8")).hexdigest()
    return f"cache:response:v{schema_version}:{digest}"


def build_precomputed_query_key(query: str) -> str:
    digest = sha256(canonicalize_query(query).encode("utf-8")).hexdigest()
    return f"guest:precomputed:query:{digest}"


def build_precomputed_payload_key(slug: str) -> str:
    return f"guest:precomputed:{slug}"


def build_precomputed_index_key() -> str:
    return "guest:precomputed:index"


def build_canonical_query_key(query: str) -> str:
    digest = sha256(canonicalize_query(query).encode("utf-8")).hexdigest()
    return f"guest:canonical:query:{digest}"


def build_canonical_payload_key(slug: str) -> str:
    return f"guest:canonical:{slug}"


def build_canonical_index_key() -> str:
    return "guest:canonical:index"


def serialize_payload(payload: Dict[str, Any]) -> bytes:
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return gzip.compress(data)


def deserialize_payload(blob: bytes) -> Dict[str, Any]:
    data = gzip.decompress(blob)
    return json.loads(data.decode("utf-8"))


def build_query_hash(
    *,
    query: str,
    products_k: int,
    reviews_per_product: int,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    """Return a deterministic hash representing the search fingerprint."""

    fingerprint = build_query_fingerprint(
        query=query,
        products_k=products_k,
        reviews_per_product=reviews_per_product,
        extra=extra,
    )
    return sha256(fingerprint.encode("utf-8")).hexdigest()
