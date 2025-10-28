"""
Test suite for protected documentation endpoints.
Ensures that /docs, /redoc, and /openapi.json are only accessible to admin users.
"""
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
import jwt

# Ensure the backend package is importable when tests are executed from the backend directory
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

# Configure environment before importing application modules
os.environ.setdefault("APP_JWT_SECRET", "test-secret-for-docs-protection")
os.environ.setdefault("APP_JWT_AUDIENCE", "rag-llm-api")
os.environ.setdefault("APP_JWT_ISSUER", "rag-llm-backend")

from backend.app.main import app
from backend.app import config


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app)


def create_test_token(role: str = "user", subject: str = "test_user") -> str:
    """Helper to create a JWT token for testing."""
    payload = {
        "sub": subject,
        "role": role,
        "email": f"{subject}@example.com",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=1),
        "aud": config.APP_JWT_AUDIENCE,
        "iss": config.APP_JWT_ISSUER,
    }
    return jwt.encode(payload, config.APP_JWT_SECRET, algorithm=config.APP_JWT_ALGORITHM)


class TestProtectedDocumentation:
    """Test suite for documentation endpoint protection."""

    def test_docs_without_auth_returns_401(self, client):
        """Test that /docs endpoint returns 401 without authentication."""
        response = client.get("/docs")
        assert response.status_code == 401
        assert "detail" in response.json()

    def test_redoc_without_auth_returns_401(self, client):
        """Test that /redoc endpoint returns 401 without authentication."""
        response = client.get("/redoc")
        assert response.status_code == 401
        assert "detail" in response.json()

    def test_openapi_without_auth_returns_401(self, client):
        """Test that /openapi.json endpoint returns 401 without authentication."""
        response = client.get("/openapi.json")
        assert response.status_code == 401
        assert "detail" in response.json()

    def test_docs_with_user_role_returns_403(self, client):
        """Test that /docs endpoint returns 403 for non-admin users."""
        token = create_test_token(role="user")
        response = client.get("/docs", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin privileges required"

    def test_redoc_with_user_role_returns_403(self, client):
        """Test that /redoc endpoint returns 403 for non-admin users."""
        token = create_test_token(role="user")
        response = client.get("/redoc", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin privileges required"

    def test_openapi_with_user_role_returns_403(self, client):
        """Test that /openapi.json endpoint returns 403 for non-admin users."""
        token = create_test_token(role="user")
        response = client.get("/openapi.json", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin privileges required"

    def test_docs_with_guest_role_returns_403(self, client):
        """Test that /docs endpoint returns 403 for guest users."""
        token = create_test_token(role="guest")
        response = client.get("/docs", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin privileges required"

    def test_redoc_with_guest_role_returns_403(self, client):
        """Test that /redoc endpoint returns 403 for guest users."""
        token = create_test_token(role="guest")
        response = client.get("/redoc", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin privileges required"

    def test_openapi_with_guest_role_returns_403(self, client):
        """Test that /openapi.json endpoint returns 403 for guest users."""
        token = create_test_token(role="guest")
        response = client.get("/openapi.json", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin privileges required"

    def test_docs_with_admin_role_returns_200(self, client):
        """Test that /docs endpoint returns 200 for admin users."""
        token = create_test_token(role="admin", subject="admin_user")
        response = client.get("/docs", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_redoc_with_admin_role_returns_200(self, client):
        """Test that /redoc endpoint returns 200 for admin users."""
        token = create_test_token(role="admin", subject="admin_user")
        response = client.get("/redoc", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_openapi_with_admin_role_returns_200(self, client):
        """Test that /openapi.json endpoint returns 200 for admin users."""
        token = create_test_token(role="admin", subject="admin_user")
        response = client.get("/openapi.json", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        # Verify it's valid OpenAPI JSON
        openapi_data = response.json()
        assert "openapi" in openapi_data
        assert "paths" in openapi_data
        assert "info" in openapi_data

    def test_docs_with_admin_role_case_insensitive(self, client):
        """Test that admin role check is case-insensitive."""
        token = create_test_token(role="Admin", subject="admin_user")
        response = client.get("/docs", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200

        token = create_test_token(role="ADMIN", subject="admin_user")
        response = client.get("/docs", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200

    def test_invalid_token_returns_401(self, client):
        """Test that invalid tokens are rejected."""
        response = client.get("/docs", headers={"Authorization": "Bearer invalid_token"})
        assert response.status_code == 401

    def test_malformed_auth_header_returns_401(self, client):
        """Test that malformed authorization headers are rejected."""
        token = create_test_token(role="admin")
        response = client.get("/docs", headers={"Authorization": f"InvalidScheme {token}"})
        assert response.status_code == 401
