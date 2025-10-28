"""
Quick smoke test script for protected documentation endpoints.
This script demonstrates how to access the protected docs endpoints with admin credentials.
"""
import os
import sys
from pathlib import Path

# Add backend to path
ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

import jwt
from datetime import datetime, timedelta
import requests

# Configuration - update these if needed
BASE_URL = "http://localhost:8000"
JWT_SECRET = os.getenv("APP_JWT_SECRET", "test-secret")
JWT_ALGORITHM = "HS256"
JWT_AUDIENCE = os.getenv("APP_JWT_AUDIENCE", "rag-llm-api")
JWT_ISSUER = os.getenv("APP_JWT_ISSUER", "rag-llm-backend")


def create_token(role: str, subject: str = "test_user") -> str:
    """Create a JWT token with the specified role."""
    payload = {
        "sub": subject,
        "role": role,
        "email": f"{subject}@example.com",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=1),
        "aud": JWT_AUDIENCE,
        "iss": JWT_ISSUER,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def test_endpoint(url: str, token: str = None, description: str = ""):
    """Test an endpoint with optional authentication."""
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        response = requests.get(url, headers=headers, timeout=5)
        status = "✅" if response.status_code == 200 else "❌"
        print(f"{status} {description}")
        print(f"   Status: {response.status_code}")
        if response.status_code != 200:
            try:
                print(f"   Response: {response.json()}")
            except:
                print(f"   Response: {response.text[:100]}")
        print()
        return response.status_code
    except requests.exceptions.RequestException as e:
        print(f"❌ {description}")
        print(f"   Error: {str(e)}")
        print()
        return None


def main():
    """Run smoke tests for documentation endpoints."""
    print("=" * 70)
    print("Protected Documentation Endpoints - Smoke Test")
    print("=" * 70)
    print()
    
    # Check if server is running
    try:
        requests.get(BASE_URL, timeout=2)
    except requests.exceptions.RequestException:
        print(f"❌ Server not running at {BASE_URL}")
        print("   Please start the backend server first:")
        print("   uvicorn backend.app.main:app --reload")
        return 1
    
    print(f"Server running at {BASE_URL}")
    print()
    
    # Test without authentication
    print("TEST 1: Accessing docs without authentication (should fail with 401)")
    print("-" * 70)
    test_endpoint(f"{BASE_URL}/docs", description="GET /docs (no auth)")
    test_endpoint(f"{BASE_URL}/redoc", description="GET /redoc (no auth)")
    test_endpoint(f"{BASE_URL}/openapi.json", description="GET /openapi.json (no auth)")
    
    # Test with user role
    print("TEST 2: Accessing docs with 'user' role (should fail with 403)")
    print("-" * 70)
    user_token = create_token("user", "regular_user")
    test_endpoint(f"{BASE_URL}/docs", user_token, "GET /docs (user role)")
    test_endpoint(f"{BASE_URL}/redoc", user_token, "GET /redoc (user role)")
    test_endpoint(f"{BASE_URL}/openapi.json", user_token, "GET /openapi.json (user role)")
    
    # Test with guest role
    print("TEST 3: Accessing docs with 'guest' role (should fail with 403)")
    print("-" * 70)
    guest_token = create_token("guest", "guest_user")
    test_endpoint(f"{BASE_URL}/docs", guest_token, "GET /docs (guest role)")
    test_endpoint(f"{BASE_URL}/redoc", guest_token, "GET /redoc (guest role)")
    test_endpoint(f"{BASE_URL}/openapi.json", guest_token, "GET /openapi.json (guest role)")
    
    # Test with admin role
    print("TEST 4: Accessing docs with 'admin' role (should succeed with 200)")
    print("-" * 70)
    admin_token = create_token("admin", "admin_user")
    docs_status = test_endpoint(f"{BASE_URL}/docs", admin_token, "GET /docs (admin role)")
    redoc_status = test_endpoint(f"{BASE_URL}/redoc", admin_token, "GET /redoc (admin role)")
    openapi_status = test_endpoint(f"{BASE_URL}/openapi.json", admin_token, "GET /openapi.json (admin role)")
    
    # Summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    all_protected = all([
        docs_status == 200,
        redoc_status == 200,
        openapi_status == 200
    ])
    
    if all_protected:
        print("✅ All documentation endpoints are properly protected!")
        print("   Only admin users can access /docs, /redoc, and /openapi.json")
        print()
        print("Admin Token (for manual testing):")
        print(admin_token)
        return 0
    else:
        print("❌ Some tests failed. Check the output above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
