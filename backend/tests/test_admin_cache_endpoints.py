from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest  # type: ignore[import]
from fastapi.testclient import TestClient

from backend.app import config
from backend.app.auth.dependencies import require_admin_user
from backend.app.auth.schemas import AuthContext
from backend.app.cache import InMemoryCacheAdapter
from backend.app.core.search_service import SearchService
from backend.app.dependencies import get_search_service_dep
from backend.app.main import app
from backend.app.schemas.search import ProductSearchResult, SearchResponse
from backend.app.utils import cache_utils


class _StubSearchEngine:
    async def hybrid_search(
        self, query: str, products_k: int = 3, reviews_per_product: int = 3
    ) -> list[dict[str, Any]]:
        return []


def _sample_response() -> dict[str, Any]:
    result = ProductSearchResult(
        asin="ASIN-123",
        product_title="Sample Product",
        cleaned_item_description="Sample description",
        product_categories="Sample",
    )
    response = SearchResponse(query="Smart Speaker", count=1, results=[result])
    return response.model_dump()


@pytest.fixture()
def admin_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(config, "ENABLE_CACHE", True)
    service = SearchService(
        search_engine=_StubSearchEngine(),
        rag_pipeline=None,
        cache=InMemoryCacheAdapter(),
    )

    admin_context = AuthContext(
        subject="admin-1",
        role="admin",
        email="admin@example.com",
        refresh_hash=None,
        session_id="session",
        issued_at=None,
        expires_at=None,
        raw_token="",
        claims={"role": "admin"},
    )

    app.dependency_overrides[get_search_service_dep] = lambda: service
    app.dependency_overrides[require_admin_user] = lambda: admin_context

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.pop(get_search_service_dep, None)
    app.dependency_overrides.pop(require_admin_user, None)


def test_list_precomputed_cache_empty(admin_client: TestClient) -> None:
    response = admin_client.get("/admin/cache/precomputed")
    assert response.status_code == 200
    assert response.json() == {"items": []}


def test_upsert_and_list_precomputed_cache(admin_client: TestClient) -> None:
    payload = {
        "slug": "demo-slug",
        "query": "Smart Speaker",
        "response": _sample_response(),
        "ttl_seconds": 600,
    }

    put_response = admin_client.put("/admin/cache/precomputed", json=payload)
    assert put_response.status_code == 204

    list_response = admin_client.get("/admin/cache/precomputed")
    assert list_response.status_code == 200
    items = list_response.json()["items"]
    assert len(items) == 1
    item = items[0]
    canonical_query = cache_utils.canonicalize_query(payload["query"])
    assert item["slug"] == payload["slug"]
    assert item["query"] == canonical_query
    assert item["hash"] == cache_utils.build_canonical_query_key(canonical_query)


def test_delete_precomputed_cache(admin_client: TestClient) -> None:
    payload = {
        "slug": "delete-slug",
        "query": "Wireless Router",
        "response": _sample_response(),
    }
    assert admin_client.put("/admin/cache/precomputed", json=payload).status_code == 204

    delete_response = admin_client.delete(f"/admin/cache/precomputed/{payload['slug']}")
    assert delete_response.status_code == 200
    body = delete_response.json()
    assert body["slug"] == payload["slug"]
    assert body["removed"] is True
    assert body["query"] == cache_utils.canonicalize_query(payload["query"])


def test_admin_cache_disabled_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "ENABLE_CACHE", False)

    service = SearchService(
        search_engine=_StubSearchEngine(),
        rag_pipeline=None,
        cache=None,
    )
    service.cache_enabled = False

    admin_context = AuthContext(
        subject="admin-2",
        role="admin",
        email=None,
        refresh_hash=None,
        session_id=None,
        issued_at=None,
        expires_at=None,
        raw_token="",
        claims={"role": "admin"},
    )

    app.dependency_overrides[get_search_service_dep] = lambda: service
    app.dependency_overrides[require_admin_user] = lambda: admin_context

    with TestClient(app) as client:
        response = client.get("/admin/cache/precomputed")
        assert response.status_code == 503

    app.dependency_overrides.pop(get_search_service_dep, None)
    app.dependency_overrides.pop(require_admin_user, None)