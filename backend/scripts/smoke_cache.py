"""Smoke test for the search response cache layer.

This script runs in-process with FastAPI's TestClient and overrides
dependencies to avoid any external services. It validates that:
- First /search call executes the pipeline
- Second /search call uses the cached response (no extra engine/pipeline calls)

Run with:
  python backend/scripts/smoke_cache.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Dict, List

from fastapi.testclient import TestClient

# Ensure repository root is on sys.path so `import backend.*` works when running this file directly
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

# Ensure cache is enabled before importing the app/config
os.environ.setdefault("ENABLE_CACHE", "true")
# Provide a default signing secret to satisfy any auth dependencies if accessed
os.environ.setdefault("APP_JWT_SECRET", "smoke-secret")

from backend.app.core.search_service import SearchService
from backend.app.schemas.llm_outputs import ProductAnalysis, ReviewHighlightItem, ReviewHighlights
from backend.app.schemas.search import ProductSearchResult, SearchResponse
from backend.app.cache import InMemoryCacheAdapter
from backend.app.main import app
from backend.app.dependencies import get_search_service_dep
from backend.app.auth.dependencies import require_authenticated_user, AuthContext


class _StubSearchEngine:
    def __init__(self) -> None:
        self.calls: int = 0

    async def hybrid_search(self, query: str, *, products_k: int = 3, reviews_per_product: int = 3) -> List[Dict[str, Any]]:
        self.calls += 1
        return [
            {
                "asin": "ASIN-1",
                "product_title": "Sample",
                "cleaned_item_description": "Sample description",
                "product_categories": "Category",
                "reviews": [],
            }
        ]


class _StubRAGPipeline:
    def __init__(self) -> None:
        self.calls: int = 0

    async def generate_batch_explanations(self, query: str, results: List[Dict[str, Any]]) -> List[ProductAnalysis]:
        self.calls += 1
        return [
            ProductAnalysis(
                asin="ASIN-1",
                main_selling_points=["Great battery"],
                best_for="Testing",
                review_highlights=ReviewHighlights(
                    overall_sentiment="positive",
                    positive=[ReviewHighlightItem(summary="long lasting")],
                    negative=[],
                ),
            )
        ]


def _build_service() -> tuple[SearchService, _StubSearchEngine, _StubRAGPipeline]:
    engine = _StubSearchEngine()
    pipeline = _StubRAGPipeline()
    cache = InMemoryCacheAdapter()
    service = SearchService(search_engine=engine, rag_pipeline=pipeline, cache=cache)
    return service, engine, pipeline


def main() -> int:
    service, engine, pipeline = _build_service()

    # Bypass JWT by providing a fixed authenticated context
    user_context = AuthContext(
        subject="user-1",
        role="user",
        email="user@example.com",
        refresh_hash=None,
        session_id="session",
        issued_at=None,
        expires_at=None,
        raw_token="",
        claims={"role": "user"},
    )

    app.dependency_overrides[get_search_service_dep] = lambda: service
    app.dependency_overrides[require_authenticated_user] = lambda: user_context

    try:
        with TestClient(app) as client:
            r1 = client.get("/search", params={"query": "Smart Speaker"})
            print("First /search status:", r1.status_code)
            assert r1.status_code == 200, r1.text

            r2 = client.get("/search", params={"query": "Smart Speaker"})
            print("Second /search status:", r2.status_code)
            assert r2.status_code == 200, r2.text

            print("Engine calls:", engine.calls)
            print("Pipeline calls:", pipeline.calls)
            if engine.calls == 1 and pipeline.calls == 1:
                print("OK: Second call came from cache (no extra engine/pipeline work)")
            else:
                print("WARN: Cache may not be enabled; expected 1 call each")
                return 1
    finally:
        app.dependency_overrides.pop(get_search_service_dep, None)
        app.dependency_overrides.pop(require_authenticated_user, None)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
