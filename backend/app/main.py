import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.middleware.gzip import GZipMiddleware

from app.config import get_settings
from app.db import SessionLocal
from app.routers import assistant, auth, calendar, documents, notes, notifications, projects, search, tasks, today
from app.security import CSRF_HEADER

log = logging.getLogger(__name__)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# El feed iCal lo piden apps de calendario, no la web: no lleva cabecera CSRF.
CSRF_EXEMPT = ("/api/calendar/feed/",)

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
])


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().files_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Segundo Cerebro", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def security(request: Request, call_next):
    path = request.url.path
    if (
        path.startswith("/api/")
        and request.method not in SAFE_METHODS
        and not path.startswith(CSRF_EXEMPT)
        and not request.headers.get("authorization")
        and request.headers.get(CSRF_HEADER) != "segundo-cerebro"
    ):
        return JSONResponse({"detail": "Falta la cabecera de seguridad de la aplicación"}, status_code=403)

    response = await call_next(request)
    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("Referrer-Policy", "same-origin")
    headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    headers.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()")
    headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    headers.setdefault("Content-Security-Policy", CSP)
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    if path.startswith("/api/"):
        headers.setdefault("Cache-Control", "no-store")
    return response


for module in (auth, documents, search, notes, tasks, calendar, projects, today, notifications, assistant):
    app.include_router(module.router)
app.include_router(calendar.feed_router)


@app.get("/api/health")
def health():
    """Vivo y con base de datos."""
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except Exception:
        log.exception("Base de datos no disponible")
        return JSONResponse({"ok": False}, status_code=503)
    return {"ok": True}


# En producción la interfaz web (ya compilada) se sirve desde aquí mismo.
_static = get_settings().static_dir
if _static and Path(_static).is_dir():
    static_dir = Path(_static)
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        candidate = (static_dir / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(static_dir.resolve()):
            headers = {"Cache-Control": "no-cache"} if path in ("sw.js", "manifest.webmanifest") else None
            return FileResponse(candidate, headers=headers)
        return FileResponse(static_dir / "index.html", headers={"Cache-Control": "no-cache"})
