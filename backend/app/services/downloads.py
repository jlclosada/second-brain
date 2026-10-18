"""Descargas se ordena sola: cada documento nuevo se lee (con OCR si hace falta),
se clasifica, se le pone un nombre claro y se mueve al vault:

    ~/Downloads/scan_0032.pdf
      → Segundo-Cerebro/Adjuntos/Vehículo/2024-03 Póliza seguro coche Mapfre.pdf
      + 03-Recursos/Documentos/Póliza seguro coche Mapfre 2024.md  (resumen, datos y enlace)

Nunca se borra nada: los duplicados van a Adjuntos/_Duplicados y lo que no es un
documento (instaladores, comprimidos, vídeos) se queda donde está.
"""

import logging
import mimetypes
import re
import shutil
import time
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Document, Item
from app.services import storage, vault
from app.services.jobs import handler
from app.services.notify import activity
from app.services.pipeline import schedule_processing

log = logging.getLogger(__name__)

DOCUMENT_TYPES = {
    ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".heic",
    ".docx", ".doc", ".odt", ".rtf", ".txt", ".md", ".csv", ".json", ".xlsx", ".xls", ".ods", ".pptx", ".key",
    ".pages", ".numbers", ".eml", ".html", ".htm",
}
PARTIAL = (".crdownload", ".part", ".download", ".tmp", ".partial")
MAX_MB = 100


def candidates(folder: Path, settle_seconds: int) -> list[Path]:
    """Documentos de la carpeta que ya han terminado de descargarse."""
    now = time.time()
    out = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.name.startswith(".") or path.name.endswith(PARTIAL):
            continue
        if path.suffix.lower() not in DOCUMENT_TYPES:
            continue
        stat = path.stat()
        if now - stat.st_mtime < settle_seconds or stat.st_size == 0 or stat.st_size > MAX_MB * 1024 * 1024:
            continue
        out.append(path)
    return out


def scan(db: Session) -> int:
    """Mete en la cola cada documento nuevo de Descargas. Devuelve cuántos."""
    settings = get_settings()
    folder = settings.downloads_dir
    if folder is None or not folder.is_dir() or vault.root() is None or not ai_ready():
        return 0
    queued = 0
    for path in candidates(folder, settings.downloads_settle_seconds):
        data = path.read_bytes()
        digest = storage.sha256(data)
        existing = db.scalars(select(Document).where(Document.sha256 == digest)).first()
        if existing is not None:
            if existing.path == str(path):
                continue  # ya se está procesando
            _move_duplicate(db, path, existing)
            continue
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        item = Item(id=uuid.uuid4(), kind="document", title=path.stem, status="pending", tags=[],
                    entities={"origin": str(path), "auto": True})
        item.document = Document(filename=path.name, mime=mime, size=len(data), sha256=digest, path=str(path))
        db.add(item)
        db.flush()
        schedule_processing(db, item)
        db.commit()
        queued += 1
        log.info("Descargas: %s en cola", path.name)
    return queued


def _move_duplicate(db: Session, path: Path, original: Document) -> None:
    r = vault.root()
    target = r / vault.ATTACHMENTS / "_Duplicados"
    target.mkdir(parents=True, exist_ok=True)
    dest = vault._unique(target, path.stem, path.suffix)
    shutil.move(str(path), dest)
    item = db.get(Item, original.item_id)
    activity(db, title=f"Duplicado apartado: {path.name}",
             body=f"Ya lo tenías como «{item.title if item else original.filename}». Movido a Adjuntos/_Duplicados.",
             url=f"/documentos/{original.item_id}", key=f"dup:{original.item_id}:{path.name}:{int(time.time())}")
    db.commit()


def clean_name(item: Item, suffix: str) -> str:
    """«2024-03 Póliza seguro coche Mapfre.pdf»: fecha delante para que se ordenen solos.

    El año ya va delante, así que se quita del título solo si está suelto («… 2024»),
    nunca si forma parte de algo («Factura 2026-A-0042»)."""
    when = item.doc_date or (date(item.year, 1, 1) if item.year else None)
    prefix = f"{when:%Y-%m} " if item.doc_date else (f"{when:%Y} " if when else "")
    title = vault.safe_title(item.title or "Documento")
    if item.year and prefix:
        stripped = re.sub(rf"(?<![\w-]){item.year}(?![\w-])", "", title)
        stripped = re.sub(r"\(\s*\)", "", stripped)            # «( )» que quedan vacíos
        stripped = re.sub(r"\s+([),.;:])", r"\1", stripped)    # «enero )» → «enero)»
        stripped = " ".join(stripped.split()).strip(" -_,")
        title = stripped or title
    return f"{prefix}{title}"[:140].rstrip() + suffix.lower()


def refile_names(db: Session) -> int:
    """Vuelve a poner nombre a los documentos ya archivados (si la regla de nombres mejoró)."""
    r = vault.root()
    if r is None:
        return 0
    changed = 0
    for item in db.scalars(select(Item).where(Item.kind == "document", Item.entities["filed_to"].astext.is_not(None))):
        doc = item.document
        src = Path(doc.path) if doc else None
        if src is None or not src.exists():
            continue
        wanted = clean_name(item, src.suffix)
        if wanted == src.name:
            continue
        dest = vault._unique(src.parent, Path(wanted).stem, Path(wanted).suffix)
        src.rename(dest)
        old_rel, new_rel = src.relative_to(r).as_posix(), dest.relative_to(r).as_posix()
        doc.path, doc.filename = str(dest), dest.name
        note_path = (item.entities or {}).get("note")
        if note_path and (r / note_path).exists():
            note = r / note_path
            note.write_text(note.read_text().replace(old_rel, new_rel).replace(src.name, dest.name))
        item.entities = {**item.entities, "filed_to": new_rel}
        changed += 1
        log.info("Renombrado %s → %s", src.name, dest.name)
    if changed:
        rebuild_index(db)
    db.commit()
    return changed


def file_document(db: Session, item: Item) -> str | None:
    """Mueve el documento ya clasificado a Adjuntos/<categoría>/ y le crea su nota."""
    doc = item.document
    r = vault.root()
    if doc is None or r is None:
        return None
    src = Path(doc.path)
    if not src.exists():
        return None
    category = item.category or "Otros"
    folder = r / vault.ATTACHMENTS / vault.safe_title(category)
    folder.mkdir(parents=True, exist_ok=True)
    name = clean_name(item, src.suffix)
    dest = vault._unique(folder, Path(name).stem, Path(name).suffix)
    shutil.move(str(src), dest)
    doc.path = str(dest)
    doc.filename = dest.name
    attachment = dest.relative_to(r).as_posix()

    details = [f"- **Tipo:** {item.doc_type}" if item.doc_type else None,
               f"- **Categoría:** {category}",
               f"- **Fecha:** {item.doc_date:%d/%m/%Y}" if item.doc_date else None,
               f"- **Vence:** {item.expires_on:%d/%m/%Y}" if item.expires_on else None,
               f"- **Archivo:** [[{attachment}|{dest.name}]]",
               f"- **Venía de:** Descargas/{src.name}"]
    people = [e.get("name") for e in (item.entities or {}).get("list", []) if e.get("name")]
    body = "\n".join(filter(None, [
        item.summary or "",
        "",
        "## Datos",
        *[d for d in details if d],
        f"- **Menciona:** {', '.join(people[:8])}" if people else None,
        "",
        f"![[{attachment}]]" if src.suffix.lower() in (".pdf", ".png", ".jpg", ".jpeg", ".webp") else None,
    ]))
    fm = {
        "tags": ["documento", *[t.replace(" ", "-") for t in (item.tags or [])[:5]]],
        "fecha": date.today().isoformat(),
        "estado": "activo",
        "tipo": item.doc_type,
        "categoria": category,
        "año": item.year,
        "vence": item.expires_on.isoformat() if item.expires_on else None,
        "archivo": attachment,
    }
    note_path = vault.write_note(db, vault.DOCS_FOLDER, item.title or dest.stem, body, fm, links=["Documentos"])
    item.entities = {**(item.entities or {}), "filed_to": attachment, "note": note_path}
    rebuild_index(db)
    activity(db, title=f"Archivado: {item.title}", body=f"Descargas → {attachment}",
             url=f"/documentos/{item.id}", key=f"filed:{item.id}")
    db.commit()
    log.info("Archivado %s → %s", src.name, attachment)
    return attachment


def rebuild_index(db: Session) -> None:
    """La nota índice 03-Recursos/Documentos.md, agrupada por categoría (la mantiene Jarvis)."""
    r = vault.root()
    docs = db.scalars(
        select(Item).where(Item.kind == "document", Item.entities["note"].astext.is_not(None)).order_by(Item.category, Item.title)
    ).all()
    groups: dict[str, list[Item]] = {}
    for d in docs:
        groups.setdefault(d.category or "Otros", []).append(d)
    lines = [
        "---", "tags: [moc, documentos]", f"fecha: {date.today().isoformat()}", "estado: activo", "generado: jarvis", "---",
        "# Documentos", "",
        "Índice de los documentos que Jarvis ha leído y archivado. Se regenera solo: no lo edites a mano.", "",
    ]
    for category, items in sorted(groups.items()):
        lines.append(f"## {category}")
        for d in items:
            note = Path(d.entities["note"]).stem
            extra = f" · vence {d.expires_on:%d/%m/%Y}" if d.expires_on else ""
            lines.append(f"- [[{note}]]{f' — {d.doc_type}' if d.doc_type else ''}{extra}")
        lines.append("")
    lines += ["---", "Enlaces: [[Recursos]] · [[Inicio]]", ""]
    path = r / vault.DOCS_INDEX
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))


@handler("scan_downloads")
def _scan(db: Session, payload: dict) -> None:
    scan(db)


@handler("file_document")
def _file(db: Session, payload: dict) -> None:
    item = db.get(Item, uuid.UUID(payload["item_id"]))
    if item is not None and item.status == "ready":
        file_document(db, item)


def ai_ready() -> bool:
    settings = get_settings()
    return bool(settings.anthropic_api_key) or not settings.downloads_require_ai


def status() -> dict:
    settings = get_settings()
    folder = settings.downloads_dir
    return {
        "enabled": bool(folder and folder.is_dir() and vault.root() and ai_ready()),
        "waiting_for_ai": bool(folder and folder.is_dir() and vault.root() and not ai_ready()),
        "folder": str(folder) if folder else None,
        "pending": len(candidates(folder, 0)) if folder and folder.is_dir() else 0,
        "checked_at": datetime.now(UTC).isoformat(),
    }
