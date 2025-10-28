"""Dependency factories for FastAPI.

Clients are created lazily to avoid import-time failures when credentials
or environment variables are missing. Factories cache created instances.
"""
import asyncio
import logging
import os
from typing import Optional

from backend.app import config
from backend.app.cache import (
    BaseCacheAdapter,
    CacheError,
    InMemoryCacheAdapter,
    RedisCacheAdapter,
    VercelKVCacheAdapter,
)
from backend.app.core.rag_pipeline import RAGPipeline
from backend.app.core.search_engine import SearchEngine
from backend.app.core.search_service import SearchService
from backend.app.llm.vertex_ai_utils import VertexAIClient
from backend.app.llm.vertex_adapter import VertexAILangChainWrapper


_vertex_ai_client: Optional[VertexAIClient] = None
_langchain_llm: Optional[VertexAILangChainWrapper] = None
_search_engine: Optional[SearchEngine] = None
_search_service: Optional[SearchService] = None
_rag_pipeline: Optional[RAGPipeline] = None
_cache: Optional[BaseCacheAdapter] = None

logger = logging.getLogger("dependencies")


def get_vertex_ai_client() -> VertexAIClient:
    global _vertex_ai_client
    if _vertex_ai_client is None:
        _vertex_ai_client = VertexAIClient()
    return _vertex_ai_client


def get_langchain_llm() -> VertexAILangChainWrapper:
    global _langchain_llm
    if _langchain_llm is None:
        _langchain_llm = VertexAILangChainWrapper(get_vertex_ai_client())
    return _langchain_llm


def get_search_engine() -> SearchEngine:
    global _search_engine
    if _search_engine is None:
        _search_engine = SearchEngine(vertex_ai_client=get_vertex_ai_client())
    return _search_engine


def _build_cache_adapter() -> BaseCacheAdapter:
    rest_url = (
        os.getenv("KV_REST_API_URL")
        or os.getenv("VERCEL_KV_REST_API_URL")
        or os.getenv("UPSTASH_REDIS_REST_URL")
    )
    rest_token = (
        os.getenv("KV_REST_API_TOKEN")
        or os.getenv("VERCEL_KV_REST_API_TOKEN")
        or os.getenv("UPSTASH_REDIS_REST_TOKEN")
    )
    namespace = config.CACHE_NAMESPACE or os.getenv("VERCEL_KV_NAMESPACE")

    if rest_url and rest_token:
        try:
            logger.info("Initializing Vercel KV cache adapter")
            return VercelKVCacheAdapter(rest_url=rest_url, rest_token=rest_token, namespace=namespace)
        except CacheError as exc:
            logger.warning("Vercel KV cache initialization failed: %s", exc)

    redis_url = config.CACHE_REDIS_URL or os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
    if redis_url:
        try:
            logger.info("Initializing Redis cache adapter")
            return RedisCacheAdapter(url=redis_url)
        except CacheError as exc:
            logger.warning("Redis cache initialization failed: %s", exc)

    logger.info("Falling back to in-memory cache adapter")
    return InMemoryCacheAdapter()


def get_cache_dep() -> Optional[BaseCacheAdapter]:
    global _cache
    if not config.ENABLE_CACHE:
        return None
    if _cache is None:
        try:
            _cache = _build_cache_adapter()
        except CacheError as exc:
            logger.error("Failed to configure cache adapter, disabling cache: %s", exc)
            _cache = None
    return _cache


def get_search_service_dep() -> SearchService:
    global _search_service
    if _search_service is None:
        _search_service = SearchService(
            search_engine=get_search_engine(),
            rag_pipeline=get_rag_pipeline_dep(),
            cache=get_cache_dep(),
        )
    return _search_service


def get_rag_pipeline_dep() -> RAGPipeline:
    global _rag_pipeline
    if _rag_pipeline is None:
        _rag_pipeline = RAGPipeline(llm_client=get_langchain_llm())
    return _rag_pipeline


async def initialize_on_startup():
    # Eagerly initialize key clients; called from FastAPI startup event.
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, get_vertex_ai_client)
    # other factories will initialize lazily when requested
    if config.ENABLE_CACHE:
        await loop.run_in_executor(None, get_cache_dep)
