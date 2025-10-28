from __future__ import annotations

import os
import sys
from pathlib import Path

import redis

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from backend.app.utils import cache_utils  # noqa: E402

try:
    from dotenv import load_dotenv  # type: ignore
except ImportError:  # pragma: no cover
    load_dotenv = None


def _prime_environment() -> None:
    if load_dotenv is None:
        return
    for candidate in (
        REPO_ROOT / "backend" / ".env",
        REPO_ROOT / "backend" / ".env.local",
        REPO_ROOT / ".env",
    ):
        if candidate.exists():
            load_dotenv(dotenv_path=candidate, override=False)


def main() -> None:
    _prime_environment()

    canonical_slug = "what-are-the-best-noise-canceling-headphones"
    canonical_query = "What are the best noise-canceling headphones?"

    url = os.environ.get("REDIS_URL") or os.environ.get("CACHE_REDIS_URL") or os.environ.get("UPSTASH_REDIS_URL")
    if not url:
        raise SystemExit("No Redis URL configured in environment variables")

    client = redis.Redis.from_url(url.strip('"'))
    payload_key = cache_utils.build_canonical_payload_key(canonical_slug)
    query_key = cache_utils.build_canonical_query_key(cache_utils.canonicalize_query(canonical_query))

    ttl_payload = client.ttl(payload_key)
    ttl_slug = client.ttl(query_key)

    print({"payload_key": payload_key, "ttl": ttl_payload})
    print({"query_key": query_key, "ttl": ttl_slug})


if __name__ == "__main__":
    main()
