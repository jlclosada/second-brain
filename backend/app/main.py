from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.db import init_db
from app.routers import auth, documents, search


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.files_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(title="Segundo Cerebro", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(search.router)


@app.get("/api/health")
def health():
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
            return FileResponse(candidate)
        return FileResponse(static_dir / "index.html")
