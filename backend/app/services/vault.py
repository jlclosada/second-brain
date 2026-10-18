"""Tu vault de Obsidian como memoria: se lee entero para buscar y responder, y
se escribe siguiendo sus propias reglas (CLAUDE.md del vault):

- Lo nuevo va a 00-Bandeja/ con `estado: bandeja`.
- Diario en 05-Diario/YYYY-MM-DD.md desde Plantillas/Nota diaria.md; si existe, se añade.
- Toda nota enlaza al menos a otra con [[wikilinks]].
- Nunca se borra ni se sobrescribe nada.
"""

import logging
import os
import re
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import quote

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Item, VaultNote
from app.services.indexing import schedule_index
from app.services.jobs import handler

log = logging.getLogger(__name__)

SKIP_DIRS = {".obsidian", ".trash", ".git", "Plantillas"}
INBOX = "00-Bandeja"
DIARY = "05-Diario"
ATTACHMENTS = "Adjuntos"
DOCS_FOLDER = "03-Recursos/Documentos"
DOCS_INDEX = "03-Recursos/Documentos.md"
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")

WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
          "noviembre", "diciembre"]


class VaultError(Exception):
    pass


def root() -> Path | None:
    path = get_settings().vault_dir
    return path if path and path.is_dir() else None


def vault_name() -> str:
    r = root()
    return r.name if r else ""


def obsidian_url(rel_path: str) -> str:
    """Enlace que abre la nota en la app de Obsidian."""
    file = rel_path.removesuffix(".md")
    return f"obsidian://open?vault={quote(vault_name())}&file={quote(file)}"


def _resolve(rel_path: str) -> Path:
    r = root()
    if r is None:
        raise VaultError("No hay vault de Obsidian configurado")
    path = (r / rel_path).resolve()
    if not path.is_relative_to(r.resolve()):
        raise VaultError("Ruta fuera del vault")
    return path


def parse(text: str) -> tuple[dict, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    try:
        data = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    # Fechas y demás tipos de YAML a texto, para guardarlos como JSON.
    clean = {k: (v.isoformat() if isinstance(v, date) else v) for k, v in data.items()}
    return clean, text[match.end():]


def _tags(fm: dict) -> list[str]:
    tags = fm.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.replace(",", " ").split()]
    return sorted({str(t).lstrip("#").lower() for t in tags if str(t).strip()})[:20]


def excerpt(body: str, length: int = 220) -> str:
    text = WIKILINK_RE.sub(lambda m: m.group(2) or m.group(1), body)
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_`>|\[\]]+", " ", text)
    text = " ".join(text.split())
    return text[:length] + ("…" if len(text) > length else "")


# --- Lectura: sincronizar el índice con el disco ---------------------------------------

def _files(r: Path):
    for dirpath, dirnames, filenames in os.walk(r):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            if name.endswith(".md") and not name.startswith("."):
                yield Path(dirpath) / name


def _upsert(db: Session, r: Path, path: Path, note: VaultNote | None, mtime: float) -> None:
    rel_path = path.relative_to(r).as_posix()
    fm, body = parse(path.read_text(errors="replace"))
    if note is None:
        item = Item(kind="vault", title="", status="ready", tags=[], entities={})
        note = VaultNote(path=rel_path)
        item.vault_note = note
        db.add(item)
    item = note.item
    item.title = path.stem[:300]
    item.summary = excerpt(body)
    item.tags = _tags(fm)
    item.entities = {"estado": fm.get("estado")} if fm.get("estado") else {}
    note.folder = path.parent.relative_to(r).as_posix() if path.parent != r else ""
    note.mtime = mtime
    note.frontmatter = fm
    note.body = body
    item.updated_at = datetime.fromtimestamp(mtime, UTC)
    db.flush()
    schedule_index(db, item.id)


def sync(db: Session) -> dict[str, int]:
    """Refleja el vault en la base: nuevas, cambiadas y borradas (por fecha de modificación)."""
    r = root()
    if r is None:
        return {}
    existing = {n.path: n for n in db.scalars(select(VaultNote).options(selectinload(VaultNote.item)))}
    seen: set[str] = set()
    changed = 0
    for path in _files(r):
        rel_path = path.relative_to(r).as_posix()
        seen.add(rel_path)
        mtime = path.stat().st_mtime
        note = existing.get(rel_path)
        if note is not None and abs(note.mtime - mtime) < 0.001:
            continue
        try:
            _upsert(db, r, path, note, mtime)
            changed += 1
        except OSError as exc:
            log.warning("No se pudo leer %s: %s", rel_path, exc)
    removed = 0
    for rel_path, note in existing.items():
        if rel_path not in seen:
            db.delete(note.item)
            removed += 1
    db.commit()
    if changed or removed:
        log.info("Vault: %d notas actualizadas, %d quitadas", changed, removed)
    return {"changed": changed, "removed": removed, "total": len(seen)}


@handler("sync_vault")
def _sync_vault(db: Session, payload: dict) -> None:
    sync(db)


def read(rel_path: str) -> str:
    path = _resolve(rel_path)
    if not path.is_file():
        raise VaultError("Esa nota no existe")
    return path.read_text(errors="replace")


def find_note(db: Session, title: str) -> VaultNote | None:
    """Una nota por su título (como en un [[wikilink]]) o por su ruta."""
    title = title.strip().removesuffix(".md")
    note = db.scalars(select(VaultNote).where(VaultNote.path == f"{title}.md")).first()
    if note:
        return note
    return db.scalars(
        select(VaultNote).join(Item, Item.id == VaultNote.item_id).where(Item.title.ilike(title.split("/")[-1]))
    ).first()


# --- Escritura -----------------------------------------------------------------------------

def safe_title(title: str) -> str:
    # Lo que Obsidian no admite en nombres de archivo: \ / : * ? " < > | # ^ [ ]
    clean = re.sub(r'[\\/:*?"<>|#^\[\]]+', " ", title)
    return " ".join(clean.split())[:120] or "Sin título"


def _unique(folder: Path, stem: str, suffix: str) -> Path:
    candidate = folder / f"{stem}{suffix}"
    n = 2
    while candidate.exists():
        candidate = folder / f"{stem} ({n}){suffix}"
        n += 1
    return candidate


def _dump_frontmatter(fm: dict) -> str:
    lines = []
    for key, value in fm.items():
        if value is None:
            continue
        if isinstance(value, list):
            lines.append(f"{key}: [{', '.join(str(v) for v in value)}]")
        else:
            lines.append(yaml.safe_dump({key: value}, allow_unicode=True, default_flow_style=False).strip())
    return "---\n" + "\n".join(lines) + "\n---\n"


def write_note(db: Session, folder: str, title: str, body: str, fm: dict, links: list[str] | None = None) -> str:
    """Crea una nota nueva (nunca sobrescribe). Devuelve su ruta relativa."""
    r = root()
    if r is None:
        raise VaultError("No hay vault de Obsidian configurado")
    target_dir = _resolve(folder)
    target_dir.mkdir(parents=True, exist_ok=True)
    path = _unique(target_dir, safe_title(title), ".md")
    text = _dump_frontmatter(fm) + f"# {path.stem}\n\n{body.strip()}\n"
    if links and not any(f"[[{link}" in body for link in links):
        text += "\n---\nEnlaces: " + " · ".join(f"[[{link}]]" for link in links) + "\n"
    path.write_text(text)
    _upsert(db, r, path, None, path.stat().st_mtime)
    db.commit()
    return path.relative_to(r).as_posix()


def capture(db: Session, title: str, body: str, tags: list[str] | None = None) -> str:
    """Captura rápida a la bandeja del vault, como manda su CLAUDE.md."""
    fm = {"tags": tags or ["captura"], "fecha": date.today().isoformat(), "estado": "bandeja"}
    return write_note(db, INBOX, title, body, fm, links=["Bandeja"])


# --- Diario -----------------------------------------------------------------------------------

def _moment(fmt: str, day: date) -> str:
    """Formato de fechas de Obsidian (moment.js) lo justo para las plantillas: YYYY MM DD D dddd MMMM [literal]."""
    out, i = [], 0
    tokens = [("YYYY", lambda: f"{day.year}"), ("MMMM", lambda: MONTHS[day.month - 1]), ("dddd", lambda: WEEKDAYS[day.weekday()]),
              ("MM", lambda: f"{day.month:02d}"), ("DD", lambda: f"{day.day:02d}"), ("D", lambda: f"{day.day}")]
    while i < len(fmt):
        if fmt[i] == "[":
            end = fmt.find("]", i)
            end = len(fmt) if end == -1 else end
            out.append(fmt[i + 1:end])
            i = end + 1
            continue
        for token, value in tokens:
            if fmt.startswith(token, i):
                out.append(value())
                i += len(token)
                break
        else:
            out.append(fmt[i])
            i += 1
    return "".join(out)


def render_template(text: str, day: date, title: str = "") -> str:
    text = re.sub(r"\{\{date:([^}]+)\}\}", lambda m: _moment(m.group(1), day), text)
    text = text.replace("{{date}}", day.isoformat()).replace("{{title}}", title)
    return text.replace("{{time}}", datetime.now(get_settings().tz).strftime("%H:%M"))


def daily_path(day: date) -> str:
    return f"{DIARY}/{day.isoformat()}.md"


def ensure_daily(db: Session, day: date) -> str:
    rel_path = daily_path(day)
    path = _resolve(rel_path)
    if not path.exists():
        template = _resolve("Plantillas/Nota diaria.md")
        if template.exists():
            text = render_template(template.read_text(), day, day.isoformat())
        else:
            text = _dump_frontmatter({"tags": ["diario"], "fecha": day.isoformat(), "estado": "activo"}) + (
                f"# {_moment('dddd, D [de] MMMM [de] YYYY', day).capitalize()}\n\n## Notas y capturas\n- \n\n---\nEnlaces: [[Inicio]]\n"
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return rel_path


def append_daily(db: Session, text: str, section: str = "Notas y capturas", day: date | None = None) -> str:
    """Añade una línea a una sección del diario de hoy (lo crea desde la plantilla si no existe)."""
    day = day or datetime.now(get_settings().tz).date()
    rel_path = ensure_daily(db, day)
    path = _resolve(rel_path)
    lines = path.read_text().splitlines()
    entry = f"- {text.strip()}"
    heading = next((i for i, line in enumerate(lines) if line.strip().lower() == f"## {section}".lower()), None)
    if heading is None:
        lines += ["", f"## {section}", entry]
    else:
        end = heading + 1
        while end < len(lines) and not lines[end].startswith("#") and lines[end].strip() != "---":
            end += 1
        # Se reutiliza la viñeta vacía de la plantilla («- »).
        empty = next((i for i in range(heading + 1, end) if lines[i].strip() in ("-", "- [ ]")), None)
        if empty is not None and lines[empty].strip() == "-":
            lines[empty] = entry
        else:
            insert_at = end
            while insert_at > heading + 1 and not lines[insert_at - 1].strip():
                insert_at -= 1
            lines.insert(insert_at, entry)
    path.write_text("\n".join(lines) + "\n")
    r = root()
    note = db.scalars(select(VaultNote).where(VaultNote.path == rel_path)).first()
    _upsert(db, r, path, note, path.stat().st_mtime)
    db.commit()
    return rel_path


# --- Para la interfaz -----------------------------------------------------------------------

def tree(db: Session) -> list[dict]:
    """Carpetas de primer nivel con sus notas, ordenadas como en Obsidian."""
    notes = db.scalars(select(VaultNote).options(selectinload(VaultNote.item)).order_by(VaultNote.path)).all()
    groups: dict[str, list[dict]] = {}
    for n in notes:
        top = n.path.split("/")[0] if "/" in n.path else ""
        groups.setdefault(top, []).append({
            "id": str(n.item_id), "path": n.path, "title": n.item.title, "folder": n.folder,
            "excerpt": n.item.summary or "", "tags": n.item.tags, "estado": n.frontmatter.get("estado"),
            "updated_at": n.item.updated_at.isoformat() if n.item.updated_at else None,
        })
    return [{"folder": k, "notes": v} for k, v in sorted(groups.items())]

