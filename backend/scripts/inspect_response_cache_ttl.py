from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None

if load_dotenv is not None:
    for candidate in (
        REPO_ROOT / "backend" / ".env",
        REPO_ROOT / "backend" / ".env.local",
        REPO_ROOT / ".env",
    ):
        if candidate.exists():
            load_dotenv(dotenv_path=candidate, override=False)

from backend.app.utils import cache_utils  # noqa: E402
from backend.app.dependencies import get_cache_dep  # noqa: E402


def main() -> None:
    query = "Find me a gift for a coffee lover"
    products_k = 3
    reviews_per_product = 3
    extra = {"guest": False}

    cache_key = cache_utils.build_response_cache_key(
        schema_version=1,
        query=query,
        products_k=products_k,
        reviews_per_product=reviews_per_product,
        extra=extra,
    )

    print("Computed response cache key:", cache_key)

    cache = get_cache_dep()
    if cache is None:
        print("No cache configured")
        return

    # Try Redis-specific inspection if adapter exposes _client
    client = getattr(cache, "_client", None)
    if client is None:
        print("Cache adapter does not expose raw client; cannot inspect TTL")
        return

    # Redis sync client helper (redis-py may be used for sync TTL check)
    try:
        import redis as redis_sync  # type: ignore
    except Exception:
        redis_sync = None

    if redis_sync is not None and isinstance(client, redis_sync.Redis):
        ttl = client.ttl(cache_key)
        print("TTL (sync client):", ttl)
    else:
        # Else attempt to call `.ttl` on async client (redis.asyncio.Redis)
        try:
            import asyncio

            async def _get_ttl():
                return await client.ttl(cache_key)

            ttl = asyncio.run(_get_ttl())
            print("TTL (async client):", ttl)
        except Exception as exc:
            print("Failed to obtain TTL via client:", exc)


if __name__ == "__main__":
    main()
