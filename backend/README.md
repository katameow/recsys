# Product Search and Recommendation API

## Overview

This API provides semantic product search and context-aware recommendations based on Amazon reviews data. 

## Project Structure

```
search_api_project/
├── app/
│   ├── api/          
│   ├── core/         
│   ├── llm/           
│   ├── db/            
│   ├── utils/         
│   ├── config.py     
│   ├── main.py       
│   └── __init__.py
├── tests/          
├── Dockerfile       
├── requirements.txt 
├── README.md        
└── .gitignore       
```

Refer to `cline_docs/productContext.md` for a detailed description of the project structure and components.

## Setup

1.  **Install Dependencies:**
    ```bash
    # Runtime / production footprint
    pip install -r requirements.txt

    # Local development & test tooling (pytest, fakeredis, etc.)
    pip install -r requirements-dev.txt
    ```
2.  **Configure Environment Variables:**
    *   Set the following environment variables:
        *   `PROJECT_ID`: Your Google Cloud Project ID
        *   `VERTEX_AI_REGION`:  Vertex AI region (e.g., "us-central1")
        *   `BIGQUERY_DATASET_ID`: BigQuery dataset ID
    *   Optionally, set:
        *   `BIGQUERY_PRODUCT_TABLE`: BigQuery table for products (default: "products")
        *   `BIGQUERY_REVIEW_TABLE`: BigQuery table for reviews (default: "reviews")
        *   `LLM_MODEL_NAME`: Vertex AI LLM model name (default: "gemini-pro")
        *   `SENTIMENT_MODEL_NAME`: Sentiment analysis model name (optional)
        *   `RAG_BATCHING_ENABLED`: Enable batched LLM calls (default: `true`)
        *   `RAG_BATCH_SIZE`: Number of products per LLM request when batching (default: `3`)
        *   `RAG_MAX_PROMPT_TOKENS`: Soft cap for prompt token estimation per batch (default: `5500`)
        *   `RAG_MAX_REVIEW_CHARS`: Maximum characters per review included in prompts (default: `600`)
        *   Authentication and blacklist settings (see `AUTH.md` for full guidance):
            *   `KV_REST_API_URL` and `KV_REST_API_TOKEN`: preferred Vercel KV configuration (auto-injected on Vercel deployments)
            *   `VERCEL_KV_NAMESPACE`: optional namespace prefix to isolate hashes per environment
            *   `REDIS_URL` or `UPSTASH_REDIS_URL`: enable the Redis-backed refresh session store when running outside Vercel KV
            *   `REFRESH_SESSION_TTL`: refresh session lifetime in seconds (default: `604800`; must be positive)
            *   `REFRESH_BLACKLIST_TTL`: revoked-hash lifetime in seconds (default: `172800`; must be positive)
            *   `GUEST_ACCESS_TOKEN_TTL_SECONDS`: guest access token lifetime (default: `600`)
        *   Observability controls:
            *   `LOG_LEVEL`: Root logger level (`INFO` by default)
            *   `ENABLE_CLOUD_LOGGING`: Set to `true` to stream structured logs to Google Cloud Logging
            *   `CLOUD_LOGGING_LOG_NAME`: Override the Cloud Logging log name (default: `rag-auth-service`)
            *   `CLOUD_LOGGING_EXCLUDED_LOGGERS`: Comma-separated logger names to keep out of Cloud Logging (default: `httpx`)
            *   `ENABLE_PROMETHEUS_METRICS`: Set to `true` to expose the `/metrics` endpoint (disabled by default)
            *   `PROMETHEUS_METRICS_NAMESPACE`: Metrics namespace prefix (default: `rag`)
            *   `PROMETHEUS_METRICS_SUBSYSTEM`: Metrics subsystem prefix (default: `auth`)
        *   Response caching & precomputed catalogue controls:
            *   `ENABLE_CACHE`: Toggle the cache-aside layer for `/search` responses (default: `false`).
            *   `CACHE_TTL_DEFAULT`: TTL (seconds) for cached authenticated responses (default: `3600`).
            *   `GUEST_CACHE_TTL`: TTL (seconds) for cached guest responses and precomputed payloads (default: `86400`).
            *   `ENABLE_GUEST_HASHED_QUERIES`: Allow guests to run arbitrary hashed queries when set to `true`; otherwise they are restricted to admin-provisioned precomputed results (default: `false`).
            *   `CACHE_FAIL_OPEN`: When `true`, cache adapter failures fall back to pipeline execution instead of surfacing errors (default: `true`).
            *   `CACHE_MAX_PAYLOAD_BYTES`: Maximum serialized payload size (bytes) allowed in the cache; larger payloads bypass storage (default: `1048576`).
            *   `CACHE_SCHEMA_VERSION`: Version stamp embedded in cache keys for compatibility; bump when the response schema changes (default: `1`).
            *   `CACHE_NAMESPACE`: Optional namespace prefix for cache keys (overrides Vercel KV namespace when present).
            *   `CACHE_REDIS_URL`: Explicit Redis connection string (overrides `REDIS_URL` / `UPSTASH_REDIS_URL`) when provisioning a dedicated cache instance.
            *   Vercel KV / Upstash credentials are shared with the refresh-store configuration: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `VERCEL_KV_NAMESPACE`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

Refer to [`AUTH.md`](./AUTH.md) for a dedicated authentication and session management playbook, including Redis rollout steps and guest refresh policy.

## Batched LLM summaries

The RAG pipeline now issues batched prompts to the LLM and validates responses with LangChain's `PydanticOutputParser`. Products are chunked according to the configured batch size and token budget. If the parser reports invalid JSON, the pipeline retries with stricter instructions before falling back to per-product generation. Structured analyses are attached to `/search` responses under the `analysis` field.

## Run Locally

```bash
& 'backend\.venv\Scripts\python.exe' -m uvicorn backend.app.main:app --reload
```

## Testing & CI

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest
```

The GitHub Actions workflow (`.github/workflows/backend-tests.yml`) mirrors the commands above. It runs the suite with the in-memory adapter by default and installs `fakeredis` when you want Redis protocol compatibility checks.

## Observability

* Cloud Logging: enable by setting `ENABLE_CLOUD_LOGGING=true` and providing Google Cloud credentials (`GOOGLE_APPLICATION_CREDENTIALS`, `PROJECT_ID`). Logs emit JSON payloads with contextual fields (e.g., guest token issuance events) and fall back to structured console output when Cloud Logging is unavailable.
* Prometheus metrics: install the optional runtime dependencies (`prometheus-fastapi-instrumentator`, `prometheus-client`) and set `ENABLE_PROMETHEUS_METRICS=true` to expose `/metrics`. Custom counters currently ship for guest token issuances (`rag_auth_guest_tokens_issued_total` with `status` labels) and refresh revocations (`rag_auth_refresh_tokens_revoked_total` with `reason` labels).

Remember to secure the `/metrics` route behind network policies or service mesh rules before exposing the backend publicly.

## Response cache & precomputed catalogue

* The search service implements a cache-aside strategy. Cache keys are hashed (`cache:response:v{schema}:{sha}`) so raw queries and user identifiers never appear in the backing store.
* Guest users are served from an admin-curated catalogue unless `ENABLE_GUEST_HASHED_QUERIES=true`. The query routing pipeline now prioritizes canonical catalogue matches before falling back to hashed cache lookups:
    1. Normalize the input and canonicalize whitespace/casing.
    2. Attempt a canonical query match using admin-provisioned keys (persistent, no TTL).
    3. If no canonical match exists, hash the normalized query and probe the TTL-bound response cache.
    4. On cache miss, execute the hybrid search + RAG pipeline and store the result with a TTL for subsequent lookups.
* Precomputed entries can be managed via the admin API (`/admin/cache/precomputed`). Admin upserts now persist both the canonical catalogue entry and the TTL-bound cache record, ensuring consistent guest responses. You can also warm entries programmatically with `python backend/scripts/cache_warmer.py --input seeds.json --token <admin-jwt>`.
* The cache adapter auto-detects Vercel KV, Redis, or in-memory implementations. Setting `CACHE_FAIL_OPEN=false` forces cache errors to bubble up instead of falling back to the RAG pipeline.
* Update `CACHE_SCHEMA_VERSION` whenever the serialized `SearchResponse` shape changes to avoid replaying stale payloads. Older entries remain isolated because the version stamp is embedded in the cache key.
* Monitor Prometheus counters exported by `backend.app.utils.observability` (`search_cache_hits_total`, `search_cache_misses_total`, `search_cache_errors_total`, `guest_precomputed_served_total`) to validate cache effectiveness and guest-serving behaviour.

## Deploy to Cloud Run

(Instructions for deploying to Google Cloud Run will be added later)