import os
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import jwt  # type: ignore[import]
import pytest
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

os.environ.setdefault("APP_JWT_SECRET", "test-secret")
os.environ.setdefault("APP_JWT_AUDIENCE", "rag-recommender")
os.environ.setdefault("APP_JWT_ISSUER", "rag-recommender")

from backend.app import config  # noqa: E402
from backend.app.api.search_endpoints import logger as search_logger  # noqa: E402
from backend.app.dependencies import get_search_service_dep  # noqa: E402
from backend.app.main import app  # noqa: E402


class _StubSearchService:
    async def get_precomputed_response(self, query: str):
        return None

    async def search_products(self, query: str, *args, **kwargs):
        raise RuntimeError("search_products should not be called in init tests")


@pytest.fixture(autouse=True)
def _configure_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(config, "ENABLE_GUEST_HASHED_QUERIES", True)
    app.dependency_overrides[get_search_service_dep] = lambda: _StubSearchService()
    search_logger.disabled = True
    yield
    app.dependency_overrides.clear()
    search_logger.disabled = False
    limiter = getattr(app.state, "limiter", None)
    if limiter and hasattr(limiter, "reset"):
        limiter.reset()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def _create_token(*, role: str = "user", subject: str = "user-123") -> str:
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
    return jwt.encode(payload, config.APP_JWT_SECRET, algorithm=config.APP_JWT_ALGORITHM)


def test_search_init_requires_auth(client: TestClient) -> None:
    response = client.post(
        "/search/init",
        json={"query": "coffee maker"},
        headers={"X-Forwarded-For": "10.0.0.1"},
    )
    assert response.status_code == 401


def test_search_init_returns_hash_and_canonical_query(client: TestClient) -> None:
    token = _create_token(subject="user-200")
    response = client.post(
        "/search/init",
        json={"query": "  Coffee Maker  "},
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.2",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["canonical_query"] == "coffee maker"
    assert isinstance(payload["query_hash"], str)
    assert len(payload["query_hash"]) == 64


def test_search_init_hash_is_deterministic_for_user(client: TestClient) -> None:
    token = _create_token(subject="user-300")
    body = {"query": "premium headphones", "products_k": 4}
    first = client.post(
        "/search/init",
        json=body,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.3",
        },
    )
    second = client.post(
        "/search/init",
        json=body,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.4",
        },
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["query_hash"] == second.json()["query_hash"]


def test_search_init_differs_by_user_identity(client: TestClient) -> None:
    token_one = _create_token(subject="user-A")
    token_two = _create_token(subject="user-B")
    base_body = {"query": "wireless mouse", "products_k": 3}

    first = client.post(
        "/search/init",
        json=base_body,
        headers={
            "Authorization": f"Bearer {token_one}",
            "X-Forwarded-For": "10.0.0.5",
        },
    )
    second = client.post(
        "/search/init",
        json=base_body,
        headers={
            "Authorization": f"Bearer {token_two}",
            "X-Forwarded-For": "10.0.0.6",
        },
    )

    assert first.status_code == second.status_code == 200
    assert first.json()["query_hash"] != second.json()["query_hash"]


def test_search_init_rejects_guest_when_disabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "ENABLE_GUEST_HASHED_QUERIES", False)
    token = _create_token(role="guest", subject="guest-1")

    response = client.post(
        "/search/init",
        json={"query": "guest search"},
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-For": "10.0.0.7",
        },
    )

    assert response.status_code == 403