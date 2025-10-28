import os

# Google Cloud Project ID
PROJECT_ID = os.environ.get("PROJECT_ID")

# Vertex AI Region
VERTEX_AI_REGION = os.environ.get("VERTEX_AI_REGION", "us-central1")

# BigQuery Dataset ID
BIGQUERY_DATASET_ID = os.environ.get("BIGQUERY_DATASET_ID")

# BigQuery Table ID for products
BIGQUERY_PRODUCT_TABLE = os.environ.get("BIGQUERY_PRODUCT_TABLE", "product_embeddings") 
# BigQuery Table ID for reviews
BIGQUERY_REVIEW_TABLE = os.environ.get("BIGQUERY_REVIEW_TABLE", "review_embeddings") 

# LLM Model Name (Vertex AI PaLM or Gemini)
LLM_MODEL_NAME = os.environ.get("LLM_MODEL_NAME", "gemini-2.0-flash-lite") 

# Optional: Sentiment Analysis Model Name (Vertex AI or other)
SENTIMENT_MODEL_NAME = os.environ.get("SENTIMENT_MODEL_NAME")

# Path to Google Application Credentials JSON file
GOOGLE_APPLICATION_CREDENTIALS_PATH = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") 



def _get_bool_env(name: str, default: bool) -> bool:
	raw = os.environ.get(name)
	if raw is None:
		return default
	return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_int_env(name: str, default: int) -> int:
	raw = os.environ.get(name)
	if raw is None:
		return default
	try:
		return int(raw)
	except ValueError:
		return default


# RAG batching / prompt configuration
RAG_BATCHING_ENABLED = _get_bool_env("RAG_BATCHING_ENABLED", True)
RAG_BATCH_SIZE = _get_int_env("RAG_BATCH_SIZE", 3)
RAG_MAX_PROMPT_TOKENS = _get_int_env("RAG_MAX_PROMPT_TOKENS", 65536)
RAG_MAX_REVIEW_CHARS = _get_int_env("RAG_MAX_REVIEW_CHARS", 4000)

# Application authentication
APP_JWT_SECRET = os.environ.get("APP_JWT_SECRET") or os.environ.get("NEXTAUTH_SECRET")
APP_JWT_ALGORITHM = os.environ.get("APP_JWT_ALGORITHM", "HS256")
APP_JWT_ISSUER = os.environ.get("APP_JWT_ISSUER", "rag-recommender")
APP_JWT_AUDIENCE = os.environ.get("APP_JWT_AUDIENCE", "rag-recommender")

GUEST_ACCESS_TOKEN_TTL_SECONDS = _get_int_env("GUEST_ACCESS_TOKEN_TTL_SECONDS", 60 * 10)
GUEST_SESSION_RATE_LIMIT = os.environ.get("GUEST_SESSION_RATE_LIMIT", "5/minute")
GUEST_SEARCH_RATE_LIMIT = os.environ.get("GUEST_SEARCH_RATE_LIMIT", "20/minute")
USER_SEARCH_RATE_LIMIT = os.environ.get("USER_SEARCH_RATE_LIMIT", "60/minute")
ADMIN_SEARCH_RATE_LIMIT = os.environ.get("ADMIN_SEARCH_RATE_LIMIT", "120/minute")

# Observability configuration
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
ENABLE_CLOUD_LOGGING = _get_bool_env("ENABLE_CLOUD_LOGGING", False)
CLOUD_LOGGING_LOG_NAME = os.environ.get("CLOUD_LOGGING_LOG_NAME", "rag-auth-service")
CLOUD_LOGGING_EXCLUDED_LOGGERS = tuple(
	part.strip()
	for part in os.environ.get("CLOUD_LOGGING_EXCLUDED_LOGGERS", "httpx").split(",")
	if part.strip()
)

ENABLE_PROMETHEUS_METRICS = _get_bool_env("ENABLE_PROMETHEUS_METRICS", False)
PROMETHEUS_METRICS_NAMESPACE = os.environ.get("PROMETHEUS_METRICS_NAMESPACE", "rag")
PROMETHEUS_METRICS_SUBSYSTEM = os.environ.get("PROMETHEUS_METRICS_SUBSYSTEM", "auth")

# Cache configuration
ENABLE_CACHE = _get_bool_env("ENABLE_CACHE", False)
CACHE_TTL_DEFAULT = _get_int_env("CACHE_TTL_DEFAULT", 60 * 60)
GUEST_CACHE_TTL = _get_int_env("GUEST_CACHE_TTL", 60 * 60 * 24)
ENABLE_GUEST_HASHED_QUERIES = _get_bool_env("ENABLE_GUEST_HASHED_QUERIES", False)
CACHE_FAIL_OPEN = _get_bool_env("CACHE_FAIL_OPEN", True)
CACHE_SCHEMA_VERSION = _get_int_env("CACHE_SCHEMA_VERSION", 1)
CACHE_MAX_PAYLOAD_BYTES = _get_int_env("CACHE_MAX_PAYLOAD_BYTES", 1_048_576)
CACHE_NAMESPACE = os.environ.get("CACHE_NAMESPACE")
CACHE_REDIS_URL = os.environ.get("CACHE_REDIS_URL")
