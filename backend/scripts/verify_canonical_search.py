from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv  # type: ignore
except ImportError:  # pragma: no cover
    load_dotenv = None

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

os.environ.setdefault("ENABLE_CACHE", "true")

from backend.app.dependencies import get_cache_dep  # noqa: E402
from backend.app.core.search_service import SearchService  # noqa: E402


class _NullSearchEngine:
    async def hybrid_search(self, *args, **kwargs):  # pragma: no cover - defensive
        raise RuntimeError("hybrid_search should not be invoked by verification script")


async def main() -> None:
    if load_dotenv is not None:
        for candidate in (
            REPO_ROOT / "backend" / ".env",
            REPO_ROOT / "backend" / ".env.local",
            REPO_ROOT / ".env",
        ):
            if candidate.exists():
                load_dotenv(dotenv_path=candidate, override=False)

    cache = get_cache_dep()
    if cache is None:
        raise RuntimeError("Cache adapter unavailable; ensure ENABLE_CACHE=true and Redis credentials are set")

    service = SearchService(search_engine=_NullSearchEngine(), rag_pipeline=None, cache=cache)
    query = "What are the best noise-canceling headphones?"
    response = await service.get_precomputed_response(query)
    if response is None:
        raise RuntimeError("Canonical response not found in cache")

    print({"query": query, "result_count": response.count})
    if response.results:
        print("First result ASIN:", response.results[0].asin)
        print("First result title:", response.results[0].product_title)


if __name__ == "__main__":
    asyncio.run(main())
