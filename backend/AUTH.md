# Authentication & Refresh Token Guide

This document captures the server-side refresh token rotation workflow, storage adapters, and operational guidance for the Product Search backend.

See `backend/.env.example` for a curated list of environment variables (required and optional) to populate on your deployment platform or secrets store.

## Refresh Sessions & Blacklist Workflow

* Refresh tokens are never stored directly. Instead, the FastAPI backend hashes each refresh token ID with SHA-256 before persisting it.
* Each refresh rotation:
  1. Registers the new refresh hash and metadata in the refresh store.
  2. Blacklists the previous refresh hash so it cannot be replayed.
  3. Returns the rotated token to the client along with a double-submit CSRF secret.
* Any incoming request that carries a `rid` claim matching a blacklisted hash is rejected with `401`.

## Storage Adapters

| Adapter          | When to use                                     | Configuration |
|------------------|-------------------------------------------------|---------------|
| InMemoryAdapter  | Local development or fallback when an external KV/Redis service is unavailable. | No configuration required. |
| VercelKVAdapter  | Preferred production/staging adapter when deploying on Vercel; uses Vercel KV (Redis-compatible) for durable blacklist enforcement. | Provide `KV_REST_API_URL` and `KV_REST_API_TOKEN` (injected automatically on Vercel) and optionally `VERCEL_KV_NAMESPACE` to scope keys. |
| RedisAdapter     | Optional staging/production adapter when using a standard Redis provider (e.g., self-hosted Redis, Upstash). | Provide `REDIS_URL` (or `UPSTASH_REDIS_URL`). |

* The backend will prefer the Vercel KV adapter when `KV_REST_API_URL` / `KV_REST_API_TOKEN` configuration is detected (for example on Vercel deployments). `VERCEL_KV_NAMESPACE` can be used to isolate keys per environment.
* If Vercel KV is not available but `REDIS_URL` (or `UPSTASH_REDIS_URL`) is present and the `redis` package is installed, the Redis adapter may be selected.
* If any external adapter initialization fails, the store logs a warning and falls back to the in-memory adapter so authentication continues to function.
* You can override the adapter at runtime (for tests or tooling) via `configure_refresh_store(adapter=...)`.

## Time-To-Live (TTL) Settings

Environment variables allow you to tune rotation and blacklist persistence. Values must be positive integers; invalid or non-positive values fall back to the defaults shown.

| Variable                  | Default (seconds) | Purpose |
|---------------------------|-------------------|---------|
| `REFRESH_SESSION_TTL`     | `604800` (7 days) | Lifetime for stored refresh sessions. |
| `REFRESH_BLACKLIST_TTL`   | `172800` (2 days) | Duration a revoked hash stays blacklisted. |
| `GUEST_ACCESS_TOKEN_TTL_SECONDS` | `600` (10 minutes) | Guest access token lifetime; guest sessions do not receive refresh tokens. |

> Tip: When changing TTLs, document the decision in change management notes and update any staging/prod environment variables accordingly.

## Guest Session Policy

Guest users receive short-lived access tokens without refresh capability. The rotation endpoint skips guest principals entirely so guest browsing remains isolated and rate-limited. The `GUEST_ACCESS_TOKEN_TTL_SECONDS` setting governs how long a guest token is valid.

## Observability

* **Cloud Logging**: Set `ENABLE_CLOUD_LOGGING=true` (along with standard Google Cloud credentials) to stream structured auth events into Google Cloud Logging under the configurable `CLOUD_LOGGING_LOG_NAME`. Key auth flows (guest token issuance, secret misconfiguration) emit JSON payloads with `event`, `subject`, and `reason` metadata for filtering and alerting.
* **Prometheus metrics**: When `ENABLE_PROMETHEUS_METRICS=true`, the backend exposes `/metrics` with the default instrumentator plus two custom counters:
  * `rag_auth_guest_tokens_issued_total{status="success|failure"}` tracks guest token issuance outcomes.
  * `rag_auth_refresh_tokens_revoked_total{reason="explicit|rotation"}` tracks blacklist activity for manual revocations and rotation-induced revocations.
  Tune the namespace/subsystem prefixes via `PROMETHEUS_METRICS_NAMESPACE` / `PROMETHEUS_METRICS_SUBSYSTEM` and secure the endpoint behind network policies or service mesh ACLs in production.

## Local & CI Testing

* Install local dev/test dependencies with `pip install -r requirements-dev.txt`. This includes `pytest`, `pytest-asyncio`, and `fakeredis` (used for Redis protocol compatibility tests). The runtime-only set lives in `requirements.txt` for deployments that rely solely on Vercel KV.
* Unit tests default to the in-memory adapter for simplicity and speed. When `fakeredis` is available, the RedisAdapter compatibility test path is exercised automatically.
* Use the helpers exported from `backend.app.security.refresh_store`:
  * `RefreshStore` constructor accepts optional `adapter`, `refresh_ttl_seconds`, and `blacklist_ttl_seconds` overrides for focused tests.
  * `configure_refresh_store` swaps the process-wide instance, which is useful for integration tests.
* Test coverage includes:
  * In-memory rotation automatically blacklisting prior hashes.
  * TTL expiry in the in-memory adapter.
  * Redis-backed revocation using `fakeredis`.
  * Vercel KV REST adapter round-trips (mocked via `httpx`), ensuring namespaced keys and blacklist semantics.

## Operational Notes

* Monitor application logs for warnings mentioning "Falling back to in-memory refresh store". This indicates an external KV/Redis connectivity issue that should be investigated.
* When using Vercel KV ensure your Vercel project is configured with the KV namespace and the service is healthy; Vercel KV honors TTL semantics for key expiry in a Redis-compatible way.
* If using Redis (self-hosted or managed), ensure key expiration is enabled so blacklist TTLs are enforced.
* Prometheus counters for guest tokens and refresh revocations are now available; consider alerting on unexpected increases in `..._refresh_tokens_revoked_total{reason="explicit"}` to detect credential theft attempts.
