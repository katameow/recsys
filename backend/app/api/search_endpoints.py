# app/api/search_endpoints.py
import asyncio
import json
import time
from datetime import datetime
from typing import Any, AsyncGenerator, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from backend.app import config
from backend.app.core.search_service import SearchService
from backend.app.dependencies import get_cache_dep, get_search_service_dep
from backend.app.schemas.search import (
    SearchAcceptedResponse,
    SearchInitRequest,
    SearchInitResponse,
    SearchRequest,
    SearchResponse,
    SearchResultEnvelope,
)
from backend.app.utils import cache_utils
from backend.app.utils import search_jobs
from backend.app.utils.timeline import ReadOptions, read_timeline_events, clear_timeline
from backend.app.cache import BaseCacheAdapter, InMemoryCacheAdapter
import logging
from backend.app.auth.dependencies import AuthContext, require_authenticated_user
from backend.app.auth.rate_limiting import limiter, search_rate_limit

router = APIRouter()
logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_SECONDS = 15.0
POLL_INTERVAL_SECONDS = 0.5
TIMELINE_BATCH_SIZE = 100
TIMELINE_BLOCK_MS = 5000


async def _timeline_event_generator(
    request: Request,
    cache_adapter: BaseCacheAdapter,
    *,
    query_hash: str,
    last_event_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    last_id = last_event_id
    last_heartbeat = time.monotonic()

    try:
        while True:
            if await request.is_disconnected():
                logger.debug("Timeline client disconnected for %s", query_hash)
                break

            events = await read_timeline_events(
                cache_adapter,
                query_hash=query_hash,
                last_id=last_id,
                options=ReadOptions(count=TIMELINE_BATCH_SIZE, block_ms=TIMELINE_BLOCK_MS),
            )

            if events:
                for event in events:
                    last_id = event.get("stream_id") or last_id
                    payload = json.dumps(event, separators=(",", ":"), ensure_ascii=False)
                    lines = []
                    if last_id:
                        lines.append(f"id: {last_id}")
                    step = event.get("step")
                    if step:
                        lines.append(f"event: {step}")
                    lines.append(f"data: {payload}")
                    yield "\n".join(lines) + "\n\n"
                last_heartbeat = time.monotonic()
                continue

            now = time.monotonic()
            if now - last_heartbeat >= HEARTBEAT_INTERVAL_SECONDS:
                yield ": heartbeat\n\n"
                last_heartbeat = now

            await asyncio.sleep(POLL_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        logger.debug("Timeline stream cancelled for %s", query_hash)
        raise


def _parse_iso_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _load_cached_response(
    cache_adapter: Optional[BaseCacheAdapter],
    *,
    query: str,
    metadata: Dict[str, Any],
) -> Optional[SearchResponse]:
    if not cache_adapter or not query:
        return None

    products_k = int(metadata.get("products_k") or 3)
    reviews_per_product = int(metadata.get("reviews_per_product") or 3)
    fingerprint_extra = dict(metadata)
    fingerprint_extra.pop("products_k", None)
    fingerprint_extra.pop("reviews_per_product", None)

    cache_key = cache_utils.build_response_cache_key(
        schema_version=max(config.CACHE_SCHEMA_VERSION, 1),
        query=query,
        products_k=products_k,
        reviews_per_product=reviews_per_product,
        extra=fingerprint_extra or None,
    )

    try:
        blob = await cache_adapter.get(cache_key)
    except Exception as exc:  # pragma: no cover - defensive path
        logger.warning("Failed to fetch cached response %s: %s", cache_key, exc)
        return None

    if not blob:
        return None

    try:
        data = cache_utils.deserialize_payload(blob)
        return SearchResponse(**data)
    except Exception as exc:  # pragma: no cover - defensive path
        logger.warning("Failed to decode cached response %s: %s", cache_key, exc)
        return None


@router.post("/search/init", response_model=SearchInitResponse)
@limiter.limit(search_rate_limit)
async def initialize_search(
    request: Request,
    payload: SearchInitRequest,
    auth_context: AuthContext = Depends(require_authenticated_user),
):
    logger.info("Initializing search fingerprint")
    is_guest = auth_context.role.lower() == "guest"

    if is_guest and not config.ENABLE_GUEST_HASHED_QUERIES:
        logger.info("Guest attempted search init while hashed queries disabled")
        raise HTTPException(status_code=403, detail="Guest queries must use precomputed catalogue")

    fingerprint_extra: dict[str, object] = {"guest": is_guest}
    subject = getattr(auth_context, "subject", None)
    if subject:
        fingerprint_extra["subject"] = subject

    query_hash = cache_utils.build_query_hash(
        query=payload.query,
        products_k=payload.products_k,
        reviews_per_product=payload.reviews_per_product,
        extra=fingerprint_extra,
    )
    canonical_query = cache_utils.canonicalize_query(payload.query)

    response_payload = SearchInitResponse(
        query_hash=query_hash,
        canonical_query=canonical_query,
        products_k=payload.products_k,
        reviews_per_product=payload.reviews_per_product,
    )

    return JSONResponse(status_code=200, content=jsonable_encoder(response_payload))

@router.post("/search", status_code=202, response_model=SearchAcceptedResponse)
@limiter.limit(search_rate_limit)
async def submit_search(
    request: Request,
    payload: SearchRequest,
    background_tasks: BackgroundTasks,
    search_service: SearchService = Depends(get_search_service_dep),
    cache_adapter: Optional[BaseCacheAdapter] = Depends(get_cache_dep),
    auth_context: AuthContext = Depends(require_authenticated_user),
):
    logger.info("Submitting asynchronous search request")
    is_guest = auth_context.role.lower() == "guest"

    if is_guest and not config.ENABLE_GUEST_HASHED_QUERIES:
        logger.info("Guest query rejected: hashed queries disabled")
        raise HTTPException(status_code=403, detail="Guest queries must use precomputed catalogue")

    fingerprint_extra: Dict[str, Any] = {"guest": is_guest}
    subject = getattr(auth_context, "subject", None)
    if subject:
        fingerprint_extra["subject"] = subject

    computed_hash = cache_utils.build_query_hash(
        query=payload.query,
        products_k=payload.products_k,
        reviews_per_product=payload.reviews_per_product,
        extra=fingerprint_extra,
    )

    if payload.query_hash and payload.query_hash != computed_hash:
        logger.info("Provided query hash mismatch for subject %s", subject)
        raise HTTPException(status_code=400, detail="query_hash does not match canonical fingerprint")

    query_hash = payload.query_hash or computed_hash
    cache_scope = "guest" if is_guest else "response"
    cache_ttl = config.GUEST_CACHE_TTL if is_guest else config.CACHE_TTL_DEFAULT

    await search_jobs.mark_pending(
        query_hash,
        query=payload.query,
        metadata={
            "products_k": payload.products_k,
            "reviews_per_product": payload.reviews_per_product,
            "guest": is_guest,
            "subject": subject,
        },
    )

    # Clear timeline BEFORE starting background task to ensure fresh state
    # This must happen synchronously before the SSE connection is established
    adapter = cache_adapter or InMemoryCacheAdapter()
    await clear_timeline(adapter, query_hash)

    background_tasks.add_task(
        _execute_search_job,
        search_service,
        query=payload.query,
        query_hash=query_hash,
        products_k=payload.products_k,
        reviews_per_product=payload.reviews_per_product,
        cache_ttl=cache_ttl,
        cache_scope=cache_scope,
        fingerprint_extra=fingerprint_extra,
        bypass_cache=payload.bypass_cache,
    )

    base_url = str(request.base_url).rstrip("/")
    accepted = SearchAcceptedResponse(
        query_hash=query_hash,
        result_url=f"{base_url}/search/result/{query_hash}",
        timeline_url=f"{base_url}/timeline/{query_hash}",
    )
    return JSONResponse(status_code=202, content=jsonable_encoder(accepted))


@router.get("/timeline/{query_hash}", response_class=StreamingResponse)
@limiter.limit(search_rate_limit)
async def stream_timeline_events(
    request: Request,
    query_hash: str,
    last_event_id: Optional[str] = None,
    cache_adapter: Optional[BaseCacheAdapter] = Depends(get_cache_dep),
    auth_context: AuthContext = Depends(require_authenticated_user),
):
    _ = auth_context  # auth enforced via dependency

    adapter = cache_adapter or InMemoryCacheAdapter()
    start_id = last_event_id or request.headers.get("last-event-id")
    stream = _timeline_event_generator(
        request,
        adapter,
        query_hash=query_hash,
        last_event_id=start_id,
    )
    # Ensure proxies and CDNs do not buffer or transform the stream.
    # X-Accel-Buffering: no for nginx, Cache-Control: no-cache,no-transform to avoid intermediate buffering
    # Connection: keep-alive to encourage proxies to keep the TCP connection open
    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return StreamingResponse(stream, media_type="text/event-stream", headers=headers)


@router.get("/search/result/{query_hash}", response_model=SearchResultEnvelope)
@limiter.limit(search_rate_limit)
async def get_search_result(
    request: Request,
    query_hash: str,
    cache_adapter: Optional[BaseCacheAdapter] = Depends(get_cache_dep),
    auth_context: AuthContext = Depends(require_authenticated_user),
):
    _ = request  # required for rate limiting decorator
    _ = auth_context  # auth enforced via dependency

    job = await search_jobs.get_job(query_hash)
    if not job:
        raise HTTPException(status_code=404, detail="query_hash not found")

    status = job.get("status", "pending")
    updated_at = _parse_iso_timestamp(job.get("updated_at"))

    if status == "pending":
        envelope = SearchResultEnvelope(
            query_hash=query_hash,
            status="pending",
            updated_at=updated_at,
        )
        return JSONResponse(status_code=202, content=jsonable_encoder(envelope))

    if status == "failed":
        envelope = SearchResultEnvelope(
            query_hash=query_hash,
            status="failed",
            error=job.get("error"),
            updated_at=updated_at,
        )
        return JSONResponse(status_code=200, content=jsonable_encoder(envelope))

    result_payload = job.get("result") or {}
    response_model: Optional[SearchResponse] = None
    if result_payload:
        try:
            response_model = SearchResponse(**result_payload)
        except Exception as exc:  # pragma: no cover - defensive path
            logger.warning("Invalid job result payload for %s: %s", query_hash, exc)

    if response_model is None:
        metadata = job.get("metadata") or {}
        response_model = await _load_cached_response(
            cache_adapter,
            query=job.get("query", ""),
            metadata=metadata,
        )

    if response_model is None:
        envelope = SearchResultEnvelope(
            query_hash=query_hash,
            status="failed",
            error="Result unavailable",
            updated_at=updated_at,
        )
        return JSONResponse(status_code=500, content=jsonable_encoder(envelope))

    envelope = SearchResultEnvelope(
        query_hash=query_hash,
        status="completed",
        result=response_model,
        updated_at=updated_at,
    )
    return JSONResponse(status_code=200, content=jsonable_encoder(envelope))


async def _execute_search_job(
    search_service: SearchService,
    *,
    query: str,
    query_hash: str,
    products_k: int,
    reviews_per_product: int,
    cache_ttl: int,
    cache_scope: str,
    fingerprint_extra: Dict[str, Any],
    bypass_cache: bool,
) -> None:
    try:
        precomputed = await search_service.get_precomputed_response(query)
        if precomputed is not None and not bypass_cache:
            # Emit timeline events for precomputed response so frontend receives updates
            await search_service._emit_timeline_event(
                query_hash,
                "response.cached",
                {
                    "source": "precomputed",
                    "query": query,
                    "products_k": products_k,
                    "reviews_per_product": reviews_per_product,
                },
            )
            result_payload = SearchService._dump_response(precomputed)
            await search_jobs.mark_completed(query_hash, result=result_payload)
            cache_key = cache_utils.build_response_cache_key(
                schema_version=search_service.schema_version,
                query=query,
                products_k=products_k,
                reviews_per_product=reviews_per_product,
                extra=fingerprint_extra or None,
            )
            summary = search_service._summarize_response(
                precomputed,
                source="precomputed",
                cache_scope=cache_scope,
                cache_key=cache_key,
            )
            await search_service._emit_timeline_event(
                query_hash,
                "response.completed",
                summary,
            )
            logger.info("Completed search via precomputed response for hash %s", query_hash)
            return

        async def finalize(result: SearchResponse, _: Dict[str, Any]) -> None:
            payload = SearchService._dump_response(result)
            await search_jobs.mark_completed(query_hash, result=payload)

        await search_service.search_products(
            query,
            query_hash=query_hash,
            products_k=products_k,
            reviews_per_product=reviews_per_product,
            cache_ttl=cache_ttl,
            fingerprint_extra=fingerprint_extra,
            cache_scope=cache_scope,
            bypass_cache=bypass_cache,
            on_before_response_completed=finalize,
        )
        logger.info("Completed search job for hash %s", query_hash)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("Search job failed for hash %s: %s", query_hash, exc)
        await search_jobs.mark_failed(query_hash, error=str(exc))