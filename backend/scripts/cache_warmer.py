"""CLI tool to warm the precomputed search-response cache via admin endpoints.

Usage example:
    python cache_warmer.py --input precomputed.json --token <admin-jwt>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import httpx

logger = logging.getLogger("cache_warmer")


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(message)s")


def _load_entries(path: Path) -> List[Dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive input handling
        raise RuntimeError(f"Failed to load JSON from {path}: {exc}") from exc

    if isinstance(raw, dict):
        candidates: Iterable[Any] = raw.get("entries") or raw.get("items") or raw.get("data") or []
    elif isinstance(raw, list):
        candidates = raw
    else:  # pragma: no cover - defensive input handling
        raise RuntimeError("Cache warmer input must be a JSON array or object with an 'entries' list")

    entries: List[Dict[str, Any]] = []
    for item in candidates:
        if not isinstance(item, dict):
            logger.debug("Skipping non-dict entry in payload: %r", item)
            continue
        if "slug" not in item or "query" not in item:
            logger.debug("Skipping entry missing required fields: %r", item)
            continue
        if "response" not in item and "response_path" not in item and "response_file" not in item:
            raise RuntimeError(
                "Each entry must include either 'response' or 'response_path'/'response_file'"
            )
        entries.append(item)

    if not entries:
        raise RuntimeError("Cache warmer input did not contain any valid entries")
    return entries


def _resolve_response_payload(entry: Dict[str, Any], base_dir: Path) -> Dict[str, Any]:
    if "response" in entry:
        response = entry["response"]
        if not isinstance(response, dict):
            raise RuntimeError("Field 'response' must be an object matching SearchResponse schema")
        return response

    file_key = entry.get("response_path") or entry.get("response_file")
    if not file_key:
        raise RuntimeError("Entry missing 'response' payload and response file reference")

    payload_path = (base_dir / file_key) if not Path(file_key).is_absolute() else Path(file_key)
    try:
        return json.loads(payload_path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive input handling
        raise RuntimeError(f"Failed to load response payload for slug {entry.get('slug')}: {exc}") from exc


def _build_headers(token: Optional[str]) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def _warm_cache(
    *,
    entries: List[Dict[str, Any]],
    base_url: str,
    headers: Dict[str, str],
    ttl_override: Optional[int],
    concurrency: int,
    dry_run: bool,
    base_dir: Path,
) -> None:
    sem = asyncio.Semaphore(max(1, concurrency))

    async with httpx.AsyncClient(base_url=base_url, timeout=15.0) as client:
        async def _process(entry: Dict[str, Any]) -> None:
            async with sem:
                slug = entry["slug"]
                query = entry["query"]
                ttl = entry.get("ttl_seconds") if isinstance(entry.get("ttl_seconds"), int) else ttl_override
                payload = {
                    "slug": slug,
                    "query": query,
                    "response": _resolve_response_payload(entry, base_dir),
                }
                if ttl:
                    payload["ttl_seconds"] = ttl

                logger.debug("Prepared payload for slug %s", slug)

                if dry_run:
                    logger.info("[dry-run] Would warm slug='%s' query='%s'", slug, query)
                    return

                try:
                    response = await client.put("/admin/cache/precomputed", json=payload, headers=headers)
                    if response.status_code not in (200, 204):
                        raise RuntimeError(f"Unexpected status {response.status_code}: {response.text}")
                except Exception as exc:
                    logger.error("Failed to warm slug %s: %s", slug, exc)
                    raise
                else:
                    logger.info("Warmed cache for slug='%s' query='%s'", slug, query)

        await asyncio.gather(*(_process(entry) for entry in entries))


def _parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Warm precomputed cache entries via admin API")
    parser.add_argument("--input", required=True, type=Path, help="Path to JSON file containing entries")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL for the backend service (default: http://localhost:8000)",
    )
    parser.add_argument("--token", help="Admin bearer token to authorize requests")
    parser.add_argument("--ttl", type=int, help="Override TTL seconds for all entries")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Number of concurrent requests to send (default: 4)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Log actions without performing HTTP requests")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    _configure_logging(args.verbose)
    input_path: Path = args.input
    entries = _load_entries(input_path)
    headers = _build_headers(args.token)
    base_dir = input_path.parent

    try:
        asyncio.run(
            _warm_cache(
                entries=entries,
                base_url=args.base_url,
                headers=headers,
                ttl_override=args.ttl,
                concurrency=args.concurrency,
                dry_run=args.dry_run,
                base_dir=base_dir,
            )
        )
    except Exception as exc:
        logger.error("Cache warming failed: %s", exc)
        return 1

    logger.info("Cache warming completed successfully (%d entries)", len(entries))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
