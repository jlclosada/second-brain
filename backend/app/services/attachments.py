"""Lo que adjuntas en el chat de Jarvis (capturas, fotos, PDF): se guarda un rato para que
Claude lo vea y las herramientas puedan archivarlo (en la ficha de una persona, en Documentos…)."""

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import get_settings

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
ALLOWED = {**IMAGE_TYPES, ".pdf": "application/pdf", ".heic": "image/heic"}
MAX_BYTES = 15 * 1024 * 1024
KEEP = timedelta(days=2)
_ID_RE = re.compile(r"^[0-9a-f]{32}\.[a-z0-9]{2,5}$")


def folder() -> Path:
    path = get_settings().data_dir / "chat"
    path.mkdir(parents=True, exist_ok=True)
    return path


def save(filename: str, data: bytes) -> dict:
    suffix = Path(filename or "").suffix.lower() or ".png"
    if suffix not in ALLOWED:
        raise ValueError("Adjunta imágenes (PNG, JPG, WebP, HEIC) o PDF")
    if len(data) > MAX_BYTES:
        raise ValueError("El archivo es demasiado grande (máximo 15 MB)")
    file_id = f"{uuid.uuid4().hex}{suffix}"
    (folder() / file_id).write_bytes(data)
    # De paso, se borra lo que tenga más de dos días.
    limit = datetime.now(UTC) - KEEP
    for old in folder().iterdir():
        if datetime.fromtimestamp(old.stat().st_mtime, UTC) < limit:
            old.unlink(missing_ok=True)
    return {"id": file_id, "name": Path(filename or file_id).name[:120], "mime": ALLOWED[suffix], "size": len(data)}


def resolve(ids: list[str]) -> list[Path]:
    out = []
    for file_id in ids:
        if _ID_RE.match(file_id) and (folder() / file_id).is_file():
            out.append(folder() / file_id)
    return out
