from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

from rusnipez.api.routes import router
from rusnipez.db import create_engine, create_sessionmaker
from rusnipez.services.workers import run_workers
from rusnipez.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = create_engine(settings.database_url)
    sessions = create_sessionmaker(engine)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        workers = (
            asyncio.create_task(run_workers(sessions, settings)) if settings.run_workers else None
        )
        try:
            yield
        finally:
            if workers is not None:
                workers.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await workers
            await engine.dispose()

    app = FastAPI(
        title="RU SnipeZ API",
        version="3.0.0",
        summary="Live Rutgers open-section status, openings and history.",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessions = sessions
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.include_router(router)
    return app
