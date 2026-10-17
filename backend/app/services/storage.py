import hashlib
import re
import uuid
from pathlib import Path

from app.config import get_settings


def safe_name(filename: str) -> str:
    name = Path(filename or "documento").name
    name = re.sub(r"[^\w.\- ]+", "_", name, flags=re.UNICODE).strip() or "documento"
    return name[:150]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_original(item_id: uuid.UUID, filename: str, data: bytes) -> Path:
    """Guarda el original intacto en data/files/<id>/<nombre>."""
    folder = get_settings().files_dir / str(item_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / safe_name(filename)
    path.write_bytes(data)
    return path


def delete_original(path: str) -> None:
    p = Path(path)
    if p.exists():
        p.unlink()
    if p.parent.exists() and not any(p.parent.iterdir()):
        p.parent.rmdir()
