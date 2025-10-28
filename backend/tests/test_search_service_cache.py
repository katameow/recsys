from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

import pytest

from backend.app import config
from backend.app.cache import BaseCacheAdapter, InMemoryCacheAdapter
from backend.app.utils.timeline import ReadOptions, clear_in_memory_timelines, read_timeline_events
from backend.app.core import search_service as search_service_module
from backend.app.core.search_service import SearchService
from backend.app.schemas.llm_outputs import ProductAnalysis, ReviewHighlightItem, ReviewHighlights
from backend.app.schemas.search import ProductSearchResult, SearchResponse


class _StubSearchEngine:
    def __init__(self) -> None:
        self.calls: int = 0

    async def hybrid_search(
        self,
        query: str,
        *,
        products_k: int = 3,
        reviews_per_product: int = 3,
    timeline_emit: Optional[Any] = None,
    ) -> List[Dict[str, Any]]:
        self.calls += 1
        if timeline_emit:
            await timeline_emit(
                "search.bq.started",
                {"stub": True},
            )
            await timeline_emit(
                "search.bq.completed",
                {"stub": True},
            )
            await timeline_emit(
                "search.reviews.selected",
                {"stub": True},
            )
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
        self.batching_enabled = False
        self.default_chunk_size = 1

    async def generate_batch_explanations(
        self,
        query: str,
        results: List[Dict[str, Any]],
        *,
    timeline_emit: Optional[Any] = None,
    ) -> List[ProductAnalysis]:
        self.calls += 1
        if timeline_emit:
            await timeline_emit(
                "rag.product.analysis",
                {"asin": "ASIN-1", "stub": True},
            )
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


def _sample_response() -> SearchResponse:
    return SearchResponse(
        query="smart speaker",
        count=1,
        results=[
            ProductSearchResult(
                asin="ASIN-1",
                product_title="Precomputed",
                cleaned_item_description="A precomputed product",
                product_categories="Speaker",
            )
        ],
    )


@pytest.fixture(autouse=True)
def _enable_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "ENABLE_CACHE", True)
    monkeypatch.setattr(config, "CACHE_TTL_DEFAULT", 60)
    monkeypatch.setattr(config, "CACHE_SCHEMA_VERSION", 1)
    monkeypatch.setattr(config, "CACHE_MAX_PAYLOAD_BYTES", 1024 * 1024)
    monkeypatch.setattr(config, "CACHE_FAIL_OPEN", True)
    monkeypatch.setattr(config, "GUEST_CACHE_TTL", 3600)


@pytest.mark.asyncio
async def test_search_service_uses_cache_after_first_call(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _StubSearchEngine()
    pipeline = _StubRAGPipeline()
    cache = InMemoryCacheAdapter()

    hits: list[str] = []
    misses: list[str] = []
    monkeypatch.setattr(search_service_module, "record_cache_hit", lambda scope: hits.append(scope))
    monkeypatch.setattr(search_service_module, "record_cache_miss", lambda scope: misses.append(scope))

    service = SearchService(search_engine=engine, rag_pipeline=pipeline, cache=cache)

    first = await service.search_products("Smart Speaker", fingerprint_extra={"guest": False})
    assert engine.calls == 1
    assert pipeline.calls == 1
    assert first.count == 1

    second = await service.search_products("Smart Speaker", fingerprint_extra={"guest": False})
    assert engine.calls == 1
    assert pipeline.calls == 1  # cached response re-used
    assert second.count == first.count
    assert second.results[0].analysis is not None
    assert "response" in misses
    assert "response" in hits


@pytest.mark.asyncio
async def test_search_service_emits_timeline_events_for_cache_hit(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _StubSearchEngine()
    pipeline = _StubRAGPipeline()
    cache = InMemoryCacheAdapter()

    events: list[tuple[str, Dict[str, Any]]] = []

    async def _fake_publish(
        adapter: BaseCacheAdapter,
        *,
        query_hash: str,
        step: str,
        payload: Mapping[str, Any] | None = None,
        **_: Any,
    ) -> Dict[str, Any]:
        materialised = dict(payload or {})
        events.append((step, materialised))
        return {
            "event_id": f"evt-{len(events)}",
            "query_hash": query_hash,
            "step": step,
            "payload": materialised,
        }

    monkeypatch.setattr(search_service_module, "publish_timeline_event", _fake_publish)

    service = SearchService(search_engine=engine, rag_pipeline=pipeline, cache=cache)

    await service.search_products(
        "Smart Speaker",
        query_hash="hash-123",
        fingerprint_extra={"guest": False},
    )

    assert events[0][0] == "search.cache.miss"
    assert events[0][1]["reason"] == "not_found"

    await service.search_products(
        "Smart Speaker",
        query_hash="hash-123",
        fingerprint_extra={"guest": False},
    )

    assert events[-2][0] == "search.cache.hit"
    hit_payload = events[-2][1]
    assert hit_payload["cache_key"].startswith("cache:response:")
    assert hit_payload["cache_enabled"] is True

    assert events[-1][0] == "response.completed"
    completed_payload = events[-1][1]
    assert completed_payload["source"] == "cache"
    assert completed_payload["result_count"] == 1
    assert completed_payload["response"]["count"] == 1


@pytest.mark.asyncio
async def test_search_service_bypass_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _StubSearchEngine()
    pipeline = _StubRAGPipeline()
    cache = InMemoryCacheAdapter()

    service = SearchService(search_engine=engine, rag_pipeline=pipeline, cache=cache)

    await service.search_products("Smart Speaker", fingerprint_extra={"guest": False})
    await service.search_products("Smart Speaker", fingerprint_extra={"guest": False}, bypass_cache=True)

    assert engine.calls == 2
    assert pipeline.calls == 2


@pytest.mark.asyncio
async def test_precomputed_response_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = InMemoryCacheAdapter()
    service = SearchService(search_engine=_StubSearchEngine(), rag_pipeline=_StubRAGPipeline(), cache=cache)

    response = _sample_response()
    precomputed_hits: list[str] = []
    guest_served: list[bool] = []
    monkeypatch.setattr(search_service_module, "record_cache_hit", lambda scope: precomputed_hits.append(scope))
    monkeypatch.setattr(search_service_module, "record_cache_miss", lambda scope: None)
    monkeypatch.setattr(search_service_module, "record_guest_precomputed_served", lambda: guest_served.append(True))
    await service.store_precomputed_response(slug="demo", query="Smart Speaker", response=response, ttl_seconds=30)
    await service.store_canonical_response(slug="demo", query="Smart Speaker", response=response)

    stored = await service.get_precomputed_response("Smart Speaker")
    assert stored is not None
    assert stored.query == response.query
    assert stored.results[0].asin == "ASIN-1"
    assert "canonical" in precomputed_hits
    assert guest_served

    index = await service.list_precomputed_responses()
    assert "demo" in index

    removed = await service.delete_precomputed_response("demo")
    assert removed is True
    assert await service.get_precomputed_response("Smart Speaker") is None


@pytest.mark.asyncio
async def test_precomputed_response_ttl_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = InMemoryCacheAdapter()
    service = SearchService(search_engine=_StubSearchEngine(), rag_pipeline=_StubRAGPipeline(), cache=cache)

    response = _sample_response()
    hits: list[str] = []
    misses: list[str] = []
    monkeypatch.setattr(search_service_module, "record_cache_hit", lambda scope: hits.append(scope))
    monkeypatch.setattr(search_service_module, "record_cache_miss", lambda scope: misses.append(scope))

    await service.store_precomputed_response(slug="ttl-demo", query="Smart Speaker", response=response, ttl_seconds=30)

    stored = await service.get_precomputed_response("Smart Speaker")
    assert stored is not None
    assert stored.results[0].asin == "ASIN-1"
    assert "precomputed" in hits
    assert "canonical" in misses


class _FailingCacheAdapter(BaseCacheAdapter):
    def __init__(self, *, fail_on_get: bool = True, fail_on_set: bool = False) -> None:
        self.fail_on_get = fail_on_get
        self.fail_on_set = fail_on_set
        self.set_invocations: int = 0

    async def get(self, key: str) -> bytes | None:
        if self.fail_on_get:
            raise RuntimeError("cache get failed")
        return None

    async def set(self, key: str, value: bytes, ttl_seconds: int) -> None:
        self.set_invocations += 1
        if self.fail_on_set:
            raise RuntimeError("cache set failed")

    async def set_persistent(self, key: str, value: bytes) -> None:
        self.set_invocations += 1
        if self.fail_on_set:
            raise RuntimeError("cache persistent set failed")

    async def delete(self, key: str) -> None:
        return None

    async def exists(self, key: str) -> bool:
        return False


@pytest.mark.asyncio
async def test_cache_fail_open_swallows_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "CACHE_FAIL_OPEN", True)
    engine = _StubSearchEngine()
    pipeline = _StubRAGPipeline()
    cache = _FailingCacheAdapter()
    cache_errors: list[str] = []
    monkeypatch.setattr(search_service_module, "record_cache_error", lambda operation: cache_errors.append(operation))

    service = SearchService(search_engine=engine, rag_pipeline=pipeline, cache=cache)

    result = await service.search_products("Smart Speaker", fingerprint_extra={"guest": False})
    assert result.count == 1
    assert engine.calls == 1
    assert pipeline.calls == 1
    assert "get" in cache_errors


@pytest.mark.asyncio
async def test_cache_fail_closed_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "CACHE_FAIL_OPEN", False)
    engine = _StubSearchEngine()
    pipeline = _StubRAGPipeline()
    cache = _FailingCacheAdapter()

    service = SearchService(search_engine=engine, rag_pipeline=pipeline, cache=cache)

    with pytest.raises(RuntimeError):
        await service.search_products("Smart Speaker", fingerprint_extra={"guest": False})


@pytest.mark.asyncio
async def test_cache_payload_limit_skips_store(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "CACHE_MAX_PAYLOAD_BYTES", 10)
    engine = _StubSearchEngine()
    pipeline = _StubRAGPipeline()
    cache = _FailingCacheAdapter(fail_on_get=False)

    service = SearchService(search_engine=engine, rag_pipeline=pipeline, cache=cache)

    await service.search_products("Smart Speaker", fingerprint_extra={"guest": False})
    assert cache.set_invocations == 0


@pytest.mark.asyncio
async def test_search_service_emits_timeline_events() -> None:
    adapter = InMemoryCacheAdapter()
    service = SearchService(search_engine=_StubSearchEngine(), rag_pipeline=_StubRAGPipeline(), cache=adapter)

    query_hash = "timeline-evt"
    await clear_in_memory_timelines(query_hash)

    response = await service.search_products(
        "Smart Speaker",
        query_hash=query_hash,
        fingerprint_extra={"guest": False},
    )

    assert response.count == 1

    events = await read_timeline_events(
        adapter,
        query_hash=query_hash,
        options=ReadOptions(count=25),
    )
    steps = [event["step"] for event in events]

    expected_sequence = [
        "search.cache.miss",
        "search.engine.started",
        "search.bq.started",
        "search.bq.completed",
        "search.engine.candidates",
        "rag.pipeline.started",
        "rag.product.analysis",
        "rag.pipeline.completed",
        "response.cached",
        "response.completed",
    ]

    for step in expected_sequence:
        assert step in steps, f"Missing timeline step {step}"

    ordering = {step: steps.index(step) for step in expected_sequence if step in steps}
    assert ordering["search.cache.miss"] < ordering["search.engine.started"]
    assert ordering["search.engine.started"] < ordering["search.engine.candidates"]
    assert ordering["search.engine.candidates"] < ordering["rag.pipeline.started"]
    assert ordering["rag.pipeline.started"] < ordering["rag.pipeline.completed"]
    assert ordering["rag.pipeline.completed"] < ordering["response.cached"] < ordering["response.completed"]

    completed_event = next(event for event in events if event["step"] == "response.completed")
    assert completed_event["payload"]["source"] == "search"