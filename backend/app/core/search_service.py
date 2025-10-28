# app/core/search_service.py
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional

import hashlib
import json
import logging

from backend.app import config
from backend.app.cache import BaseCacheAdapter, InMemoryCacheAdapter
from backend.app.core.rag_pipeline import RAGPipeline
from backend.app.core.search_engine import SearchEngine
from backend.app.schemas.llm_outputs import ProductAnalysis
from backend.app.schemas.search import ProductReview, ProductSearchResult, SearchResponse
from backend.app.utils import cache_utils
from backend.app.utils.observability import (
    record_cache_error,
    record_cache_hit,
    record_cache_miss,
    record_guest_precomputed_served,
)
from backend.app.utils.timeline import publish_timeline_event

logger = logging.getLogger(__name__)


class SearchService:
    def __init__(
        self,
        search_engine: SearchEngine,
        *,
        rag_pipeline: Optional[RAGPipeline] = None,
        cache: Optional[BaseCacheAdapter] = None,
    ) -> None:
        self.search_engine = search_engine
        self.rag_pipeline = rag_pipeline
        self.cache = cache if config.ENABLE_CACHE else None
        self.timeline_adapter: BaseCacheAdapter = cache or InMemoryCacheAdapter()
        self.cache_enabled = self.cache is not None
        self.default_ttl = max(config.CACHE_TTL_DEFAULT, 1)
        self.schema_version = max(config.CACHE_SCHEMA_VERSION, 1)
        self.max_payload_bytes = max(config.CACHE_MAX_PAYLOAD_BYTES, 1)
        self.fail_open = config.CACHE_FAIL_OPEN

    def configure_rag_pipeline(self, pipeline: RAGPipeline) -> None:
        self.rag_pipeline = pipeline

    async def search_products(
        self,
        query: str,
        *,
        query_hash: Optional[str] = None,
        products_k: int = 3,
        reviews_per_product: int = 3,
        cache_ttl: Optional[int] = None,
        fingerprint_extra: Optional[Dict[str, Any]] = None,
    cache_scope: str = "response",
    bypass_cache: bool = False,
    on_before_response_completed: Optional[Callable[[SearchResponse, Dict[str, Any]], Awaitable[None]]] = None,
    emit_response_completed: bool = True,
    ) -> SearchResponse:
        logger.info("Starting search for query '%s'", query)
        pipeline = self._require_pipeline()

        async def emit(step: str, payload: Mapping[str, Any] | None = None) -> None:
            await self._emit_timeline_event(query_hash, step, payload)

        cache_key = cache_utils.build_response_cache_key(
            schema_version=self.schema_version,
            query=query,
            products_k=products_k,
            reviews_per_product=reviews_per_product,
            extra=fingerprint_extra,
        )

        cache_event_payload: Dict[str, Any] = {
            "cache_key": cache_key,
            "scope": cache_scope,
            "bypass_cache": bypass_cache,
            "cache_enabled": self.cache_enabled,
        }
        cache_step = "search.cache.miss"
        cached: Optional[SearchResponse] = None
        miss_reason: Optional[str] = None

        if self.cache_enabled and not bypass_cache:
            cached = await self._get_cached_response(cache_key, cache_scope)
            if cached is not None:
                cache_step = "search.cache.hit"
            else:
                miss_reason = "not_found"
        else:
            miss_reason = "bypass" if bypass_cache else "disabled"

        if miss_reason is not None:
            cache_event_payload["reason"] = miss_reason

        await emit(cache_step, cache_event_payload)

        if self.cache_enabled and not bypass_cache:
            if cached is not None:
                logger.debug("Cache hit for key %s", cache_key)
                summary = self._summarize_response(
                    cached,
                    source="cache",
                    cache_scope=cache_scope,
                    cache_key=cache_key,
                )
                if on_before_response_completed:
                    await on_before_response_completed(cached, summary)
                if emit_response_completed:
                    await emit("response.completed", summary)
                return cached

        await emit(
            "search.engine.started",
            {
                "query": query,
                "products_k": products_k,
                "reviews_per_product": reviews_per_product,
                "fingerprint_extra": fingerprint_extra or {},
                "cache_scope": cache_scope,
            },
        )
        try:
            search_results = await self.search_engine.hybrid_search(
                query,
                products_k=products_k,
                reviews_per_product=reviews_per_product,
                timeline_emit=emit,
            )
        except Exception as exc:
            logger.error("Search engine lookup failed: %s", exc)
            raise

        await emit(
            "search.engine.candidates",
            {
                "result_count": len(search_results),
                "top_candidates": self._summarize_candidates(search_results),
            },
        )

        await emit(
            "rag.pipeline.started",
            {
                "product_count": len(search_results),
                "batching_enabled": pipeline.batching_enabled,
                "default_chunk_size": pipeline.default_chunk_size,
            },
        )
        try:
            analyses = await pipeline.generate_batch_explanations(
                query,
                search_results,
                timeline_emit=emit,
            )
        except Exception as exc:
            logger.error("RAG pipeline execution failed: %s", exc)
            raise

        await emit(
            "rag.pipeline.completed",
            {
                "analysis_count": len(analyses),
                "product_count": len(search_results),
            },
        )

        response = self._build_response(query, search_results, analyses)
        ttl = cache_ttl if cache_ttl and cache_ttl > 0 else self.default_ttl
        cached_stored = await self._store_cached_response(cache_key, response, ttl, cache_scope)
        if cached_stored:
            await emit(
                "response.cached",
                {
                    "cache_key": cache_key,
                    "ttl_seconds": ttl,
                    "scope": cache_scope,
                },
            )

        summary = self._summarize_response(
            response,
            source="search",
            cache_scope=cache_scope,
            cache_key=cache_key,
        )

        if on_before_response_completed:
            await on_before_response_completed(response, summary)

        if emit_response_completed:
            await emit("response.completed", summary)
        logger.info("Search completed for '%s' with %d results", query, response.count)
        return response

    async def _emit_timeline_event(
        self,
        query_hash: Optional[str],
        step: str,
        payload: Mapping[str, Any] | None = None,
    ) -> None:
        if not query_hash:
            return

        try:
            await publish_timeline_event(
                self.timeline_adapter,
                query_hash=query_hash,
                step=step,
                payload=payload or {},
            )
        except Exception as exc:  # pragma: no cover - timeline best effort
            logger.debug("Timeline publish failed for %s: %s", step, exc)

    def _require_pipeline(self) -> RAGPipeline:
        if self.rag_pipeline is None:
            raise RuntimeError("RAG pipeline is not configured for SearchService")
        return self.rag_pipeline

    async def _get_cached_response(
        self,
        cache_key: str,
        scope: str,
    ) -> Optional[SearchResponse]:
        if not self.cache:
            return None
        try:
            blob = await self.cache.get(cache_key)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("get")
            logger.warning("Cache get failed for key %s: %s", cache_key, exc)
            if self.fail_open:
                return None
            raise

        if blob is None:
            record_cache_miss(scope)
            return None

        try:
            data = cache_utils.deserialize_payload(blob)
            response = SearchResponse(**data)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("decode")
            logger.warning("Failed to decode cached payload for %s: %s", cache_key, exc)
            if self.fail_open:
                return None
            raise

        record_cache_hit(scope)
        return response

    async def _store_cached_response(
        self,
        cache_key: str,
        response: SearchResponse,
        ttl_seconds: int,
        scope: str,
    ) -> bool:
        if not self.cache:
            return False
        payload = self._dump_response(response)
        blob = cache_utils.serialize_payload(payload)
        if len(blob) > self.max_payload_bytes:
            logger.debug(
                "Skipping cache store for %s; payload size %d exceeds limit %d",
                cache_key,
                len(blob),
                self.max_payload_bytes,
            )
            return False

        try:
            await self.cache.set(cache_key, blob, ttl_seconds)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("set")
            logger.warning("Cache set failed for %s: %s", cache_key, exc)
            if not self.fail_open:
                raise
            return False
        return True
    def _build_response(
        self,
        query: str,
        search_results: List[Dict[str, Any]],
        analyses: List[ProductAnalysis],
    ) -> SearchResponse:
        analysis_map = {analysis.asin: analysis for analysis in analyses if analysis.asin}
        response_items: List[ProductSearchResult] = []

        for product in search_results:
            asin = product.get("asin") or "unknown"
            reviews_payload = [
                ProductReview(
                    content=review.get("content", ""),
                    rating=review.get("rating"),
                    verified_purchase=review.get("verified_purchase"),
                    user_id=review.get("user_id"),
                    timestamp=review.get("timestamp"),
                    similarity=review.get("similarity"),
                    has_rating=review.get("has_rating"),
                )
                for review in product.get("reviews", [])
            ]

            response_items.append(
                ProductSearchResult(
                    asin=asin,
                    product_title=product.get("product_title", ""),
                    cleaned_item_description=product.get("cleaned_item_description", ""),
                    product_categories=product.get("product_categories", ""),
                    similarity=product.get("similarity"),
                    avg_rating=product.get("avg_rating"),
                    rating_count=product.get("rating_count"),
                    displayed_rating=product.get("displayed_rating"),
                    combined_score=product.get("combined_score"),
                    reviews=reviews_payload,
                    analysis=analysis_map.get(asin),
                )
            )

        return SearchResponse(query=query, count=len(response_items), results=response_items)

    @staticmethod
    def _summarize_candidates(results: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
        summary: List[Dict[str, Any]] = []
        for product in results[:limit]:
            summary.append(
                {
                    "asin": product.get("asin"),
                    "title": product.get("product_title"),
                    "similarity": product.get("similarity"),
                    "combined_score": product.get("combined_score"),
                    "avg_rating": product.get("avg_rating"),
                    "rating_count": product.get("rating_count"),
                    "review_count": len(product.get("reviews", []) or []),
                }
            )
        return summary

    def _summarize_response(
        self,
        response: SearchResponse,
        *,
        source: str,
        cache_scope: str,
        cache_key: str,
    ) -> Dict[str, Any]:
        payload = {
            "source": source,
            "cache_scope": cache_scope,
            "cache_key": cache_key,
            "result_count": response.count,
            "top_results": [
                {
                    "asin": item.asin,
                    "title": item.product_title,
                    "combined_score": item.combined_score,
                    "similarity": item.similarity,
                }
                for item in response.results[:5]
            ],
        }

        payload["response"] = {
            "count": response.count,
            "results": [
                {
                    "asin": item.asin,
                    "analysis_present": item.analysis is not None,
                }
                for item in response.results[:5]
            ],
        }

        try:
            serialized = json.dumps(self._dump_response(response), sort_keys=True, separators=(",", ":"))
            payload["response_hash"] = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        except Exception:
            payload["response_hash"] = "unknown"

        return payload

    @staticmethod
    def _dump_response(response: SearchResponse) -> Dict[str, Any]:
        if hasattr(response, "model_dump"):
            # Pydantic v2 returns JSON-serializable content when mode="json".
            return response.model_dump(mode="json")  # type: ignore[call-arg]
        # Fallback for older Pydantic versions.
        return json.loads(response.json())  # type: ignore[attr-defined]

    async def get_precomputed_response(self, query: str) -> Optional[SearchResponse]:
        if not self.cache:
            return None

        canonical_query = cache_utils.canonicalize_query(query)
        canonical_slug_key = cache_utils.build_canonical_query_key(canonical_query)
        canonical_slug_blob = await self._cache_get_bytes(canonical_slug_key, "canonical-index")

        if canonical_slug_blob:
            try:
                canonical_slug = canonical_slug_blob.decode("utf-8").strip()
            except Exception as exc:  # pragma: no cover - defensive path
                record_cache_error("canonical-decode")
                logger.warning("Failed to decode canonical slug payload for %s: %s", canonical_slug_key, exc)
                if self.fail_open:
                    canonical_slug = ""
                else:
                    raise
            if canonical_slug:
                canonical_payload_key = cache_utils.build_canonical_payload_key(canonical_slug)
                canonical_payload_blob = await self._cache_get_bytes(canonical_payload_key, "canonical-fetch")
                if canonical_payload_blob:
                    try:
                        canonical_data = cache_utils.deserialize_payload(canonical_payload_blob)
                        canonical_response = SearchResponse(**canonical_data)
                    except Exception as exc:  # pragma: no cover - defensive path
                        record_cache_error("canonical-decode")
                        logger.warning("Failed to decode canonical payload for %s: %s", canonical_payload_key, exc)
                        if not self.fail_open:
                            raise
                    else:
                        record_cache_hit("canonical")
                        record_guest_precomputed_served()
                        return canonical_response
                record_cache_miss("canonical-payload")
            else:
                record_cache_miss("canonical")
        else:
            record_cache_miss("canonical")

        slug_key = cache_utils.build_precomputed_query_key(query)
        slug_blob = await self._cache_get_bytes(slug_key, "precomputed-index")
        if not slug_blob:
            record_cache_miss("precomputed")
            return None

        slug = slug_blob.decode("utf-8").strip()
        if not slug:
            record_cache_miss("precomputed")
            return None

        payload_key = cache_utils.build_precomputed_payload_key(slug)
        payload_blob = await self._cache_get_bytes(payload_key, "precomputed-fetch")
        if not payload_blob:
            record_cache_miss("precomputed")
            return None

        try:
            data = cache_utils.deserialize_payload(payload_blob)
            response = SearchResponse(**data)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("precomputed-decode")
            logger.warning("Failed to decode precomputed payload for %s: %s", payload_key, exc)
            if self.fail_open:
                return None
            raise

        record_cache_hit("precomputed")
        record_guest_precomputed_served()
        return response

    async def store_precomputed_response(
        self,
        *,
        slug: str,
        query: str,
        response: SearchResponse,
        ttl_seconds: Optional[int] = None,
    ) -> None:
        if not self.cache:
            raise RuntimeError("Cache adapter is not configured for storing precomputed responses")

        ttl = ttl_seconds if ttl_seconds and ttl_seconds > 0 else config.GUEST_CACHE_TTL
        payload = cache_utils.serialize_payload(self._dump_response(response))
        payload_key = cache_utils.build_precomputed_payload_key(slug)
        await self.cache.set(payload_key, payload, ttl)

        canonical_query = cache_utils.canonicalize_query(query)
        slug_key = cache_utils.build_precomputed_query_key(canonical_query)
        await self.cache.set(slug_key, slug.encode("utf-8"), ttl)

        index = await self._load_precomputed_index()
        index[slug] = {"query": canonical_query, "hash": slug_key}
        await self._write_precomputed_index(index, ttl)

    async def store_canonical_response(
        self,
        *,
        slug: str,
        query: str,
        response: SearchResponse,
    ) -> None:
        if not self.cache:
            raise RuntimeError("Cache adapter is not configured for storing canonical responses")

        canonical_query = cache_utils.canonicalize_query(query)
        canonical_payload_key = cache_utils.build_canonical_payload_key(slug)
        payload = cache_utils.serialize_payload(self._dump_response(response))

        try:
            await self.cache.set_persistent(canonical_payload_key, payload)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("canonical-set")
            logger.warning("Failed to persist canonical payload %s: %s", canonical_payload_key, exc)
            if not self.fail_open:
                raise

        canonical_slug_key = cache_utils.build_canonical_query_key(canonical_query)
        try:
            await self.cache.set_persistent(canonical_slug_key, slug.encode("utf-8"))
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("canonical-set")
            logger.warning("Failed to persist canonical slug %s: %s", canonical_slug_key, exc)
            if not self.fail_open:
                raise

        index = await self._load_canonical_index()
        index[slug] = {"query": canonical_query, "hash": canonical_slug_key}
        await self._write_canonical_index(index)

    async def delete_precomputed_response(self, slug: str, *, query: Optional[str] = None) -> bool:
        if not self.cache:
            return False

        index = await self._load_precomputed_index()
        canonical_index = await self._load_canonical_index()
        entry = index.get(slug)
        canonical_entry = canonical_index.get(slug)
        canonical_query = cache_utils.canonicalize_query(query) if query else (
            (canonical_entry.get("query") if canonical_entry else (entry.get("query") if entry else None))
        )

        payload_key = cache_utils.build_precomputed_payload_key(slug)
        try:
            await self.cache.delete(payload_key)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("precomputed-delete")
            logger.warning("Failed to delete precomputed payload %s: %s", payload_key, exc)
            if not self.fail_open:
                raise

        if canonical_query:
            slug_key = cache_utils.build_precomputed_query_key(canonical_query)
            try:
                await self.cache.delete(slug_key)
            except Exception as exc:  # pragma: no cover - defensive path
                record_cache_error("precomputed-delete-index")
                logger.warning("Failed to delete precomputed index %s: %s", slug_key, exc)
                if not self.fail_open:
                    raise

            canonical_slug_key = cache_utils.build_canonical_query_key(canonical_query)
            try:
                await self.cache.delete(canonical_slug_key)
            except Exception as exc:  # pragma: no cover - defensive path
                record_cache_error("canonical-delete")
                logger.warning("Failed to delete canonical slug %s: %s", canonical_slug_key, exc)
                if not self.fail_open:
                    raise

        canonical_payload_key = cache_utils.build_canonical_payload_key(slug)
        try:
            await self.cache.delete(canonical_payload_key)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("canonical-delete")
            logger.warning("Failed to delete canonical payload %s: %s", canonical_payload_key, exc)
            if not self.fail_open:
                raise

        if slug in index:
            index.pop(slug, None)
            await self._write_precomputed_index(index, config.GUEST_CACHE_TTL)

        if slug in canonical_index:
            canonical_index.pop(slug, None)
            await self._write_canonical_index(canonical_index)

        return True

    async def list_precomputed_responses(self) -> Dict[str, Dict[str, str]]:
        if not self.cache:
            return {}
        ttl_index = await self._load_precomputed_index()
        canonical_index = await self._load_canonical_index()
        combined: Dict[str, Dict[str, str]] = {**ttl_index}
        combined.update(canonical_index)
        return combined

    async def _cache_get_bytes(self, key: str, operation: str) -> Optional[bytes]:
        if not self.cache:
            return None
        try:
            return await self.cache.get(key)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error(operation)
            logger.warning("Cache get failed for %s (%s): %s", key, operation, exc)
            if self.fail_open:
                return None
            raise

    async def _load_precomputed_index(self) -> Dict[str, Dict[str, str]]:
        index_key = cache_utils.build_precomputed_index_key()
        raw = await self._cache_get_bytes(index_key, "precomputed-index-load")
        if not raw:
            return {}
        try:
            payload = cache_utils.deserialize_payload(raw)
            if isinstance(payload, dict):
                result: Dict[str, Dict[str, str]] = {}
                for slug, entry in payload.items():
                    if not isinstance(entry, dict):
                        continue
                    query = str(entry.get("query", ""))
                    hash_key = str(entry.get("hash", ""))
                    if query:
                        result[str(slug)] = {"query": query, "hash": hash_key}
                return result
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("precomputed-index-decode")
            logger.warning("Failed to decode precomputed index: %s", exc)
            if not self.fail_open:
                raise
        return {}

    async def _load_canonical_index(self) -> Dict[str, Dict[str, str]]:
        index_key = cache_utils.build_canonical_index_key()
        raw = await self._cache_get_bytes(index_key, "canonical-index-load")
        if not raw:
            return {}
        try:
            payload = cache_utils.deserialize_payload(raw)
            if isinstance(payload, dict):
                result: Dict[str, Dict[str, str]] = {}
                for slug, entry in payload.items():
                    if not isinstance(entry, dict):
                        continue
                    query = str(entry.get("query", ""))
                    hash_key = str(entry.get("hash", ""))
                    if query:
                        result[str(slug)] = {"query": query, "hash": hash_key}
                return result
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("canonical-index-decode")
            logger.warning("Failed to decode canonical index: %s", exc)
            if not self.fail_open:
                raise
        return {}

    async def _write_precomputed_index(self, index: Dict[str, Dict[str, str]], ttl: int) -> None:
        if not self.cache:
            return
        ttl_value = ttl if ttl > 0 else config.GUEST_CACHE_TTL
        index_key = cache_utils.build_precomputed_index_key()
        payload = cache_utils.serialize_payload(index)
        await self.cache.set(index_key, payload, ttl_value)

    async def _write_canonical_index(self, index: Dict[str, Dict[str, str]]) -> None:
        if not self.cache:
            return
        index_key = cache_utils.build_canonical_index_key()
        payload = cache_utils.serialize_payload(index)
        try:
            await self.cache.set_persistent(index_key, payload)
        except Exception as exc:  # pragma: no cover - defensive path
            record_cache_error("canonical-index-set")
            logger.warning("Failed to persist canonical index %s: %s", index_key, exc)
            if not self.fail_open:
                raise


