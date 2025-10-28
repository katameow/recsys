import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from backend.app.api import admin_endpoints, auth_endpoints, search_endpoints, sentiment_endpoints
from backend.app.auth.dependencies import require_admin_user
from backend.app.auth.rate_limiting import limiter, rate_limit_handler
from backend.app.dependencies import (
    get_rag_pipeline_dep,
    get_search_service_dep,
    initialize_on_startup,
)
from backend.app.utils.observability import configure_logging, configure_metrics
from slowapi.errors import RateLimitExceeded  # type: ignore[import]
from slowapi.middleware import SlowAPIMiddleware  # type: ignore[import]

configure_logging()

# Disable default docs endpoints by setting docs_url, redoc_url, and openapi_url to None
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
configure_metrics(app)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Your Next.js frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)


# Include routers, passing dependencies - CORRECTED: Pass dependencies as router arguments
app.include_router(search_endpoints.router, dependencies=[Depends(get_search_service_dep)])
app.include_router(sentiment_endpoints.router, dependencies=[Depends(get_rag_pipeline_dep)]) # Add dependencies to sentiment_endpoints as well (if needed in the future)
app.include_router(auth_endpoints.router)
app.include_router(admin_endpoints.router)

@app.get("/")
async def read_root():
    return {"message": "Product Search and Recommendation API"}


# Protected documentation endpoints - admin only
@app.get("/docs", include_in_schema=False)
async def get_swagger_documentation(_=Depends(require_admin_user)):
    """Swagger UI documentation - Admin access only."""
    return get_swagger_ui_html(openapi_url="/openapi.json", title="API Documentation")


@app.get("/redoc", include_in_schema=False)
async def get_redoc_documentation(_=Depends(require_admin_user)):
    """ReDoc documentation - Admin access only."""
    return get_redoc_html(openapi_url="/openapi.json", title="API Documentation")


@app.get("/openapi.json", include_in_schema=False)
async def get_openapi_schema(_=Depends(require_admin_user)):
    """OpenAPI schema - Admin access only."""
    return JSONResponse(content=get_openapi(
        title=app.title,
        version=app.version,
        openapi_version=app.openapi_version,
        description=app.description,
        routes=app.routes,
    ))


@app.on_event("startup")
async def startup_event():
    logging.info("Application starting up, checking dependencies...")
    try:
        # initialize heavy clients in background to detect configuration errors early
        await initialize_on_startup()
        # also ensure core services can be constructed
        _ = get_search_service_dep()
        _ = get_rag_pipeline_dep()
        logging.info("Dependencies initialized successfully")
    except Exception as e:
        logging.error(f"Failed to initialize dependencies: {str(e)}")