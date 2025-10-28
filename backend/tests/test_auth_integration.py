import asyncio
import os
import sys
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any, Dict, List

import jwt  # type: ignore[import]
import pytest  # type: ignore[import]
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY  # type: ignore[import]

# Ensure the backend package is importable when tests are executed from the backend directory
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

# Configure environment before importing application modules
os.environ.setdefault("APP_JWT_SECRET", "test-secret")
os.environ.setdefault("APP_JWT_AUDIENCE", "rag-recommender")
os.environ.setdefault("APP_JWT_ISSUER", "rag-recommender")
os.environ.setdefault("GUEST_SESSION_RATE_LIMIT", "2/minute")

from backend.app import config  # noqa: E402
from backend.app.api.search_endpoints import logger as search_logger  # noqa: E402
from backend.app.dependencies import get_rag_pipeline_dep, get_search_service_dep  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.schemas.llm_outputs import (  # noqa: E402
    ProductAnalysis,
    ReviewHighlightItem,
    ReviewHighlights,
)
from backend.app.schemas.search import ProductSearchResult, SearchResponse  # noqa: E402
from backend.app.security.refresh_store import (  # noqa: E402
    InMemoryAdapter,
    RefreshSessionRecord,
    configure_refresh_store,
    get_refresh_store,
)
from backend.app.utils import search_jobs  # noqa: E402


@pytest.fixture(autouse=True)
def _stub_dependencies(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(config, "ENABLE_GUEST_HASHED_QUERIES", True)
    monkeypatch.setattr(config, "GUEST_SESSION_RATE_LIMIT", "2/minute")
    class StubSearchService:
        async def get_precomputed_response(self, query: str) -> SearchResponse | None:
            return None

        async def search_products(self, query: str, products_k: int = 3, **kwargs: Any) -> SearchResponse:
            response = SearchResponse(
                query=query,
                count=1,
                results=[
                    ProductSearchResult(
                        asin="ASIN-1",
                        product_title="Demo Product",
                        cleaned_item_description="A demonstration product.",
                        product_categories="demo",
                    )
                ],
            )
            callback = kwargs.get("on_before_response_completed")
            if callback:
                await callback(response, {"source": "stub"})
            return response

    class StubRagPipeline:
        async def generate_batch_explanations(self, query: str, search_results: List[Dict[str, Any]]):
            return [
                ProductAnalysis(
                    asin="ASIN-1",
                    main_selling_points=["value"],
                    best_for="testers",
                    review_highlights=ReviewHighlights(
                        overall_sentiment="positive",
                        positive=[ReviewHighlightItem(summary="great", explanation="test")],
                        negative=[],
                    ),
                    confidence=0.9,
                )
            ]

    app.dependency_overrides[get_search_service_dep] = lambda: StubSearchService()
    app.dependency_overrides[get_rag_pipeline_dep] = lambda: StubRagPipeline()
    search_logger.disabled = True
    search_jobs.reset_jobs_sync()
    yield
    app.dependency_overrides.clear()
    search_logger.disabled = False
    limiter = getattr(app.state, "limiter", None)
    if limiter and hasattr(limiter, "reset"):
        limiter.reset()
    search_jobs.reset_jobs_sync()


@pytest.fixture(autouse=True)
def _reset_refresh_store() -> Iterator[None]:
    configure_refresh_store(adapter=InMemoryAdapter())
    yield
    configure_refresh_store(adapter=InMemoryAdapter())


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def _create_token(*, role: str = "user", subject: str = "user-123", refresh_hash: str | None = None) -> str:
    now = int(time.time())
    payload = {
        "sub": subject,
        "role": role,
        "aud": config.APP_JWT_AUDIENCE,
        "iss": config.APP_JWT_ISSUER,
        "iat": now,
        "exp": now + 60,
        "sid": subject,
    }
    if refresh_hash:
        payload["rid"] = refresh_hash

    return jwt.encode(payload, config.APP_JWT_SECRET, algorithm=config.APP_JWT_ALGORITHM)


def _metric_value(metric_tail: str, labels: Dict[str, str]) -> float:
    metric_name = (
        f"{config.PROMETHEUS_METRICS_NAMESPACE}_"
        f"{config.PROMETHEUS_METRICS_SUBSYSTEM}_{metric_tail}"
    )
    value = REGISTRY.get_sample_value(metric_name, labels=labels)
    return float(value) if value is not None else 0.0


def test_search_requires_authorization(client: TestClient) -> None:
    response = client.post(
        "/search",
        json={"query": "demo"},
        headers={"X-Forwarded-For": "10.0.0.1"},
    )
    assert response.status_code == 401


def test_search_allows_authenticated_user(client: TestClient) -> None:
    token = _create_token(role="user", subject="user-200")
    response = client.post(
        "/search",
        json={"query": "demo"},
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.2",
        },
    )
    assert response.status_code == 202
    payload = response.json()
    assert "query_hash" in payload
    assert payload["status"] == "pending"
    assert payload["timeline_url"].endswith(payload["query_hash"])


def test_admin_endpoint_rejects_non_admin(client: TestClient) -> None:
    token = _create_token(role="user", subject="user-300")
    response = client.get(
        "/admin/status",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.3",
        },
    )
    assert response.status_code == 403


def test_admin_endpoint_allows_admin(client: TestClient) -> None:
    token = _create_token(role="admin", subject="admin-1")
    response = client.get(
        "/admin/status",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.4",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "admin"


def test_admin_endpoint_rejects_guest(client: TestClient) -> None:
    token = _create_token(role="guest", subject="guest-1")
    response = client.get(
        "/admin/status",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.8",
        },
    )
    assert response.status_code == 403


def test_revoked_refresh_hash_is_rejected(client: TestClient) -> None:
    refresh_hash = "revoked-hash"
    record = RefreshSessionRecord(
        user_id="user-999",
        role="user",
        session_id="session-1",
        issued_at=int(time.time()),
        expires_at=int(time.time()) + 100,
        version=1,
    )

    refresh_store = get_refresh_store()
    asyncio.run(refresh_store.register_refresh_session(refresh_hash=refresh_hash, record=record))
    explicit_before = _metric_value("refresh_tokens_revoked_total", {"reason": "explicit"})
    asyncio.run(refresh_store.revoke_refresh_hash(refresh_hash))
    explicit_after = _metric_value("refresh_tokens_revoked_total", {"reason": "explicit"})
    assert explicit_after == pytest.approx(explicit_before + 1.0)

    token = _create_token(role="user", subject="user-999", refresh_hash=refresh_hash)

    response = client.post(
        "/search",
        json={"query": "demo"},
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.5",
        },
    )
    assert response.status_code == 401


def test_search_allows_guest_access_token(client: TestClient) -> None:
    token = _create_token(role="guest", subject="guest-2")
    response = client.post(
        "/search",
        json={"query": "demo"},
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.9",
        },
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "pending"
    assert payload["timeline_url"].endswith(payload["query_hash"])


def test_guest_endpoint_returns_token(client: TestClient) -> None:
    response = client.post("/auth/guest", headers={"X-Forwarded-For": "10.0.0.6"})
    assert response.status_code == 200
    payload = response.json()
    assert "accessToken" in payload
    assert payload["user"]["role"] == "guest"


def test_guest_endpoint_rate_limit(client: TestClient) -> None:
    headers = {"X-Forwarded-For": "10.0.0.7"}
    first = client.post("/auth/guest", headers=headers)
    second = client.post("/auth/guest", headers=headers)
    third = client.post("/auth/guest", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429


def test_guest_token_metric_records_success(client: TestClient) -> None:
    before = _metric_value("guest_tokens_issued_total", {"status": "success"})
    response = client.post("/auth/guest", headers={"X-Forwarded-For": "10.0.0.120"})
    assert response.status_code == 200
    after = _metric_value("guest_tokens_issued_total", {"status": "success"})
    assert after == pytest.approx(before + 1.0)


def test_guest_token_metric_records_failure(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    before = _metric_value("guest_tokens_issued_total", {"status": "failure"})
    original_secret = config.APP_JWT_SECRET
    try:
        monkeypatch.setattr(config, "APP_JWT_SECRET", None)
        response = client.post("/auth/guest", headers={"X-Forwarded-For": "10.0.0.121"})
        assert response.status_code == 500
    finally:
        monkeypatch.setattr(config, "APP_JWT_SECRET", original_secret)

    after = _metric_value("guest_tokens_issued_total", {"status": "failure"})
    assert after == pytest.approx(before + 1.0)


def test_refresh_rotation_invalidates_previous_hash(client: TestClient) -> None:
    now = int(time.time())
    refresh_store = get_refresh_store()

    record_v1 = RefreshSessionRecord(
        user_id="user-rotation",
        role="user",
        session_id="session-1",
        issued_at=now,
        expires_at=now + 120,
        version=1,
    )

    record_v2 = RefreshSessionRecord(
        user_id="user-rotation",
        role="user",
        session_id="session-2",
        issued_at=now + 1,
        expires_at=now + 240,
        version=2,
    )

    asyncio.run(
        refresh_store.register_refresh_session(
            refresh_hash="hash-rotation-v1",
            record=record_v1,
        )
    )
    rotation_before = _metric_value("refresh_tokens_revoked_total", {"reason": "rotation"})
    asyncio.run(
        refresh_store.register_refresh_session(
            refresh_hash="hash-rotation-v2",
            record=record_v2,
            previous_hash="hash-rotation-v1",
        )
    )
    rotation_after = _metric_value("refresh_tokens_revoked_total", {"reason": "rotation"})
    assert rotation_after == pytest.approx(rotation_before + 1.0)

    old_token = _create_token(role="user", subject="user-rotation", refresh_hash="hash-rotation-v1")
    old_response = client.post(
        "/search",
        json={"query": "demo"},
        headers={
            "Authorization": f"Bearer {old_token}",
            "X-Forwarded-For": "10.0.0.10",
        },
    )
    assert old_response.status_code == 401

    new_token = _create_token(role="user", subject="user-rotation", refresh_hash="hash-rotation-v2")
    new_response = client.post(
        "/search",
        json={"query": "demo"},
        headers={
            "Authorization": f"Bearer {new_token}",
            "X-Forwarded-For": "10.0.0.11",
        },
    )
    assert new_response.status_code == 202
    payload = new_response.json()
    assert payload["status"] == "pending"


def test_revoked_refresh_hash_blocks_until_blacklist_ttl_expires(client: TestClient) -> None:
    configure_refresh_store(adapter=InMemoryAdapter(), refresh_ttl_seconds=60, blacklist_ttl_seconds=2)
    refresh_store = get_refresh_store()
    now = int(time.time())

    record = RefreshSessionRecord(
        user_id="user-blacklist",
        role="user",
        session_id="session-blacklist",
        issued_at=now,
        expires_at=now + 300,
        version=1,
    )

    asyncio.run(
        refresh_store.register_refresh_session(
            refresh_hash="hash-blacklist",
            record=record,
        )
    )
    asyncio.run(refresh_store.revoke_refresh_hash("hash-blacklist"))

    token = _create_token(role="user", subject="user-blacklist", refresh_hash="hash-blacklist")

    def _request() -> Any:
        return client.post(
            "/search",
            json={"query": "demo"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-Forwarded-For": "10.0.0.12",
            },
        )

    first_attempt = _request()
    assert first_attempt.status_code == 401

    time.sleep(1)
    second_attempt = _request()
    assert second_attempt.status_code == 401

    time.sleep(1.3)
    third_attempt = _request()
    assert third_attempt.status_code == 202
    payload = third_attempt.json()
    assert payload["status"] == "pending"
