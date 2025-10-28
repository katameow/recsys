from __future__ import annotations

import json
import logging
from typing import Iterable

from backend.app import config

try:  # pragma: no cover - optional dependency
    import google.cloud.logging  # type: ignore[import]
    from google.cloud.logging_v2.handlers import CloudLoggingHandler  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - optional dependency
    google = None  # type: ignore[assignment]
    CloudLoggingHandler = None  # type: ignore[assignment]
else:  # pragma: no cover - optional dependency
    google = google  # type: ignore[misc]

try:  # pragma: no cover - optional dependency
    from prometheus_client import Counter  # type: ignore[import]
    from prometheus_fastapi_instrumentator import Instrumentator, metrics  # type: ignore[import]
except ImportError:  # pragma: no cover - optional dependency
    Counter = None  # type: ignore[assignment]
    Instrumentator = None  # type: ignore[assignment]
    metrics = None  # type: ignore[assignment]


class JsonFormatter(logging.Formatter):
    """Minimal JSON formatter for console logging."""

    def format(self, record: logging.LogRecord) -> str:  # pragma: no cover - simple serialization
        payload = {
            "message": record.getMessage(),
            "severity": record.levelname,
            "logger": record.name,
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
        }
        if record.exc_info:
            payload["trace"] = self.formatException(record.exc_info)
        json_fields = getattr(record, "json_fields", None)
        if isinstance(json_fields, dict):
            payload.update(json_fields)
        return json.dumps(payload, default=str, separators=(",", ":"))


def _sanitize_excluded_loggers(raw: Iterable[str]) -> list[str]:
    return [name for name in raw if name]


def configure_logging() -> None:
    """Configure application logging for Cloud Logging or JSON console output."""

    root_logger = logging.getLogger()
    log_level = getattr(logging, config.LOG_LEVEL.upper(), logging.INFO)

    if config.ENABLE_CLOUD_LOGGING and google is not None and CloudLoggingHandler is not None:
        try:  # pragma: no cover - network interactions exercised via integration tests
            client = google.cloud.logging.Client()
            handler = CloudLoggingHandler(client=client, name=config.CLOUD_LOGGING_LOG_NAME)
            root_logger.handlers.clear()
            root_logger.addHandler(handler)
            root_logger.setLevel(log_level)
            excluded = _sanitize_excluded_loggers(config.CLOUD_LOGGING_EXCLUDED_LOGGERS)
            for logger_name in excluded:
                logging.getLogger(logger_name).propagate = False
            logging.getLogger(__name__).info(
                "Cloud Logging handler configured",
                extra={
                    "json_fields": {
                        "logName": config.CLOUD_LOGGING_LOG_NAME,
                        "excluded": excluded,
                    }
                },
            )
            return
        except Exception as exc:  # pragma: no cover - defensive fallback path
            logging.getLogger(__name__).warning(
                "Failed to initialize Cloud Logging; falling back to JSON console",
                extra={"json_fields": {"error": str(exc)}},
            )

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)
    logging.getLogger(__name__).info(
        "JSON console logging configured",
        extra={"json_fields": {"logLevel": logging.getLevelName(log_level)}},
    )


_guest_token_counter = (
    Counter(
        "guest_tokens_issued_total",
        "Number of guest access tokens issued",
        labelnames=("status",),
        namespace=config.PROMETHEUS_METRICS_NAMESPACE,
        subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
    )
    if Counter is not None
    else None
)

_refresh_revocation_counter = (
    Counter(
        "refresh_tokens_revoked_total",
        "Number of refresh hashes revoked",
        labelnames=("reason",),
        namespace=config.PROMETHEUS_METRICS_NAMESPACE,
        subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
    )
    if Counter is not None
    else None
)

_cache_hit_counter = (
    Counter(
        "search_cache_hits_total",
        "Number of cache hits for search responses",
        labelnames=("scope",),
        namespace=config.PROMETHEUS_METRICS_NAMESPACE,
        subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
    )
    if Counter is not None
    else None
)

_cache_miss_counter = (
    Counter(
        "search_cache_misses_total",
        "Number of cache misses for search responses",
        labelnames=("scope",),
        namespace=config.PROMETHEUS_METRICS_NAMESPACE,
        subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
    )
    if Counter is not None
    else None
)

_cache_error_counter = (
    Counter(
        "search_cache_errors_total",
        "Number of cache errors during search response caching",
        labelnames=("operation",),
        namespace=config.PROMETHEUS_METRICS_NAMESPACE,
        subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
    )
    if Counter is not None
    else None
)

_guest_precomputed_counter = (
    Counter(
        "guest_precomputed_served_total",
        "Number of guest precomputed responses served",
        namespace=config.PROMETHEUS_METRICS_NAMESPACE,
        subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
    )
    if Counter is not None
    else None
)


def configure_metrics(app) -> None:
    """Attach Prometheus instrumentation to the FastAPI app if available."""

    if not config.ENABLE_PROMETHEUS_METRICS:
        logging.getLogger(__name__).info("Prometheus metrics disabled via configuration")
        return

    if Instrumentator is None or metrics is None:
        logging.getLogger(__name__).warning(
            "Prometheus instrumentation not installed; skipping metrics setup",
        )
        return

    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        should_instrument_requests_inprogress=True,
        excluded_handlers=[".*metrics"],
    )
    instrumentator.add(
        metrics.default(
            metric_namespace=config.PROMETHEUS_METRICS_NAMESPACE,
            metric_subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
        )
    )
    instrumentator.instrument(
        app,
        metric_namespace=config.PROMETHEUS_METRICS_NAMESPACE,
        metric_subsystem=config.PROMETHEUS_METRICS_SUBSYSTEM,
    ).expose(app, include_in_schema=False, should_gzip=True)
    logging.getLogger(__name__).info(
        "Prometheus metrics endpoint exposed",
        extra={
            "json_fields": {
                "namespace": config.PROMETHEUS_METRICS_NAMESPACE,
                "subsystem": config.PROMETHEUS_METRICS_SUBSYSTEM,
            }
        },
    )


def record_guest_token_metric(status: str) -> None:
    if _guest_token_counter is None:
        return
    _guest_token_counter.labels(status=status).inc()


def record_refresh_revocation(reason: str) -> None:
    if _refresh_revocation_counter is None:
        return
    _refresh_revocation_counter.labels(reason=reason).inc()


def record_cache_hit(scope: str) -> None:
    if _cache_hit_counter is None:
        return
    _cache_hit_counter.labels(scope=scope).inc()


def record_cache_miss(scope: str) -> None:
    if _cache_miss_counter is None:
        return
    _cache_miss_counter.labels(scope=scope).inc()


def record_cache_error(operation: str) -> None:
    if _cache_error_counter is None:
        return
    _cache_error_counter.labels(operation=operation).inc()


def record_guest_precomputed_served() -> None:
    if _guest_precomputed_counter is None:
        return
    _guest_precomputed_counter.inc()


__all__ = [
    "configure_logging",
    "configure_metrics",
    "record_guest_token_metric",
    "record_refresh_revocation",
    "record_cache_hit",
    "record_cache_miss",
    "record_cache_error",
    "record_guest_precomputed_served",
]
