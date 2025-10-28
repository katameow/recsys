"""Utility script to persist canonical search responses in the configured cache.

This helper ingests a JSON payload matching the ``SearchResponse`` schema and
stores it via :meth:`SearchService.store_canonical_response`, ensuring
precomputed catalogue lookups serve the provided response.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Optional

_dotenv_module = importlib.util.find_spec("dotenv")
if _dotenv_module is not None:  # pragma: no cover - import side-effect
    load_dotenv = importlib.import_module("dotenv").load_dotenv  # type: ignore[attr-defined]
else:  # pragma: no cover - optional dependency
    load_dotenv = None

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

# Ensure environment variables from .env files are loaded before config imports.
def _prime_environment() -> None:
    env_candidates = [
        REPO_ROOT / "backend" / ".env",
        REPO_ROOT / "backend" / ".env.local",
        REPO_ROOT / ".env",
    ]
    for candidate in env_candidates:
        if candidate.exists() and load_dotenv is not None:
            load_dotenv(dotenv_path=candidate, override=False)


_prime_environment()

# Ensure caching is enabled before importing application modules.
os.environ.setdefault("ENABLE_CACHE", "true")

from backend.app import config  # type: ignore[import]
from backend.app.cache import CacheError  # type: ignore[import]
from backend.app.core.search_service import SearchService  # type: ignore[import]
from backend.app.dependencies import get_cache_dep  # type: ignore[import]
from backend.app.schemas.search import SearchResponse  # type: ignore[import]
from backend.app.utils import cache_utils  # type: ignore[import]


class _NullSearchEngine:
    """Placeholder search engine; never invoked by this script."""

    async def hybrid_search(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover - defensive
        raise RuntimeError("hybrid_search should not be called by store_canonical_response script")


def _slugify(value: str) -> str:
    fallback = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return fallback or "canonical-entry"


def _load_payload(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive path
        raise RuntimeError(f"Failed to load SearchResponse payload from {path}: {exc}") from exc


async def _store_canonical(*, slug: str, query: str, response: SearchResponse, store_ttl: Optional[int]) -> None:
    cache = get_cache_dep()
    if cache is None:
        raise RuntimeError("Cache adapter is not configured; set ENABLE_CACHE=true and provide Redis/Vercel KV credentials")

    service = SearchService(search_engine=_NullSearchEngine(), rag_pipeline=None, cache=cache)

    if store_ttl is not None and store_ttl > 0:
        await service.store_precomputed_response(slug=slug, query=query, response=response, ttl_seconds=store_ttl)

    await service.store_canonical_response(slug=slug, query=query, response=response)

    retrieved = await service.get_precomputed_response(query)
    if retrieved is None:
        raise RuntimeError("Verification failed: canonical response could not be retrieved after storage")

    print(f"Stored canonical response for slug='{slug}' query='{query}' (results={retrieved.count})")


def _parse_args(argv: Optional[list[str]]) -> argparse.Namespace:
    default_payload = REPO_ROOT / "backend" / "output.json"
    parser = argparse.ArgumentParser(description="Persist a canonical SearchResponse payload in the cache store")
    parser.add_argument("--response-file", type=Path, default=default_payload, help="Path to JSON file with SearchResponse data")
    parser.add_argument("--slug", help="Slug identifier for the canonical entry (default: derived from the query)")
    parser.add_argument("--query", help="Override the canonical query string (default: query value from payload)")
    parser.add_argument(
        "--ttl",
        type=int,
        default=None,
        help="Optional TTL seconds for the precomputed (non-persistent) cache entry; if omitted, only the canonical store is updated",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv or sys.argv[1:])

    payload = _load_payload(args.response_file)
    
    # If the payload contains a nested "result" field, extract it
    if "result" in payload and isinstance(payload["result"], dict):
        payload = payload["result"]
    
    try:
        response = SearchResponse(**payload)
    except Exception as exc:  # pragma: no cover - defensive path
        raise RuntimeError(f"Payload does not conform to SearchResponse schema: {exc}") from exc

    query = args.query or response.query
    if not query:
        raise RuntimeError("A non-empty query is required to store canonical responses")

    canonical_query = cache_utils.canonicalize_query(query)
    slug = args.slug or _slugify(canonical_query)

    ttl_seconds: Optional[int]
    if args.ttl is None:
        ttl_seconds = None
    elif args.ttl <= 0:
        ttl_seconds = None
    else:
        ttl_seconds = args.ttl

    try:
        asyncio.run(_store_canonical(slug=slug, query=query, response=response, store_ttl=ttl_seconds))
    except CacheError as exc:
        raise RuntimeError(f"Cache interaction failed: {exc}") from exc

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
