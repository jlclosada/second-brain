"""Personas: una ficha por persona en el vault (02-Areas/Personas/) para acordarte de quién es,
cómo tratarle y qué ha pasado con ella (con fechas e imágenes).

    02-Areas/Personas/Óscar Martín.md
      ## Quién es · ## Cómo tratarle · ## Historial · ## Pendiente
    Adjuntos/Personas/Óscar Martín/2026-10-18 Acuerdo HP.png
    02-Areas/Personas.md   ← índice que mantiene Jarvis

Antes de una reunión, Jarvis busca en el evento a las personas con ficha y te recuerda lo importante.
"""

import re
import shutil
import unicodedata
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import VaultNote
from app.services import vault

FOLDER = "02-Areas/Personas"
INDEX = "02-Areas/Personas.md"
TEMPLATE = "Plantillas/Persona.md"
ATTACHMENTS = "Adjuntos/Personas"
SECTIONS = ("Quién es", "Cómo tratarle", "Historial", "Pendiente")

TEMPLATE_TEXT = """---
tags: [persona]
fecha: {{date:YYYY-MM-DD}}
estado: activo
relacion:
empresa:
rol:
email:
telefono:
alias: []
---
# {{title}}

## Quién es
-

## Cómo tratarle
-

## Historial
-

## Pendiente
-

---
Enlaces: [[Personas]]
"""


def fold(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", value.lower()) if unicodedata.category(c) != "Mn").strip()


def all_people(db: Session) -> list[VaultNote]:
    return db.scalars(
        select(VaultNote).options(selectinload(VaultNote.item)).where(VaultNote.path.like(f"{FOLDER}/%.md"))
        .order_by(VaultNote.path)
    ).all()


def _names(note: VaultNote) -> list[str]:
    """Cómo se puede llamar a esta persona: nombre completo, alias y nombre de pila."""
    title = note.item.title
    aliases = note.frontmatter.get("alias") or note.frontmatter.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [a.strip() for a in aliases.split(",")]
    return [n for n in {title, *[str(a) for a in aliases if a]} if n]


def find(db: Session, name: str) -> list[VaultNote]:
    """Las fichas que encajan con un nombre: exacta, alias, o nombre de pila si no hay otra igual."""
    wanted = fold(name)
    people = all_people(db)
    exact = [p for p in people if wanted in {fold(n) for n in _names(p)}]
    if exact:
        return exact
    if not wanted or " " in wanted:
        return []  # un nombre completo que no existe es una persona nueva («Óscar Ruiz» ≠ «Óscar Martín»)
    # Un nombre suelto («Óscar») vale para «Óscar Martín»; si hay dos Óscar, devuelve los dos.
    return [p for p in people if any(fold(n).split()[0] == wanted for n in _names(p) if n.strip())]


def ensure(db: Session, name: str, fields: dict | None = None) -> tuple[str, bool]:
    """La ficha de una persona (la crea desde la plantilla si no existe). Devuelve (ruta, creada)."""
    matches = find(db, name)
    if len(matches) == 1:
        rel_path = matches[0].path
        if fields:
            _fill_frontmatter(db, rel_path, fields)
        return rel_path, False
    r = vault.root()
    if r is None:
        raise vault.VaultError("No hay vault de Obsidian configurado")
    template = r / TEMPLATE
    if not template.exists():
        template.parent.mkdir(parents=True, exist_ok=True)
        template.write_text(TEMPLATE_TEXT)
    title = vault.safe_title(name.strip().title() if name.islower() else name.strip())
    folder = r / FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    path = vault._unique(folder, title, ".md")
    today = datetime.now(get_settings().tz).date()
    path.write_text(vault.render_template(template.read_text(), today, path.stem))
    rel_path = path.relative_to(r).as_posix()
    if fields:
        _fill_frontmatter(db, rel_path, fields, sync=False)
    vault._upsert(db, r, path, None, path.stat().st_mtime)
    db.commit()
    rebuild_index(db)
    return rel_path, True


def _fill_frontmatter(db: Session, rel_path: str, fields: dict, sync: bool = True) -> None:
    """Rellena campos vacíos del frontmatter (empresa, relación…); nunca pisa lo que ya escribiste."""
    path = vault._resolve(rel_path)
    text = path.read_text()
    fm, body = vault.parse(text)
    changed = False
    for key, value in fields.items():
        if value and not fm.get(key):
            fm[key] = value
            changed = True
    if not changed:
        return
    fm = {k: ("" if v is None else v) for k, v in fm.items()}
    path.write_text(vault._dump_frontmatter(fm) + body.lstrip("\n"))
    if sync:
        note = db.scalars(select(VaultNote).where(VaultNote.path == rel_path)).first()
        vault._upsert(db, vault.root(), path, note, path.stat().st_mtime)
        db.commit()


def attach(name: str, images: list[Path], day: date, label: str) -> list[str]:
    """Copia imágenes a Adjuntos/Personas/<nombre>/ con un nombre que dice qué son."""
    r = vault.root()
    folder = r / ATTACHMENTS / vault.safe_title(name)
    folder.mkdir(parents=True, exist_ok=True)
    out = []
    slug = vault.safe_title(label)[:60]
    for i, src in enumerate(images, start=1):
        stem = f"{day.isoformat()} {slug}" + (f" {i}" if len(images) > 1 else "")
        dest = vault._unique(folder, stem, src.suffix.lower())
        shutil.copy2(src, dest)
        out.append(dest.relative_to(r).as_posix())
    return out


def note_fact(db: Session, name: str, text: str, day: date | None = None, section: str = "Historial",
              images: list[Path] | None = None, fields: dict | None = None) -> dict:
    """Apunta algo sobre una persona: en Historial con fecha («- **2026-10-18** — …») o en otra sección."""
    day = day or datetime.now(get_settings().tz).date()
    section = next((s for s in SECTIONS if fold(s) == fold(section)), section.strip().capitalize() or "Historial")
    rel_path, created = ensure(db, name, fields)
    person = Path(rel_path).stem
    files = attach(person, images or [], day, text) if images else []
    line = f"- **{day.isoformat()}** — {text.strip()}" if section == "Historial" else f"- {text.strip()}"
    entries = [line, *[f"    ![[{f}]]" for f in files]]
    vault.append_lines(db, rel_path, section, entries)
    return {"ruta": rel_path, "persona": person, "creada": created, "adjuntos": files}


def card(note: VaultNote, history: int = 3) -> dict:
    """Lo importante de una ficha, para recordarlo de un vistazo."""
    sections: dict[str, list[str]] = {}
    current = None
    for line in note.body.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            continue
        item = line.strip()
        if current and item.startswith("- ") and item[2:].strip():
            sections.setdefault(current, []).append(re.sub(r"\*\*(.+?)\*\*", r"\1", item[2:].strip()))
    fm = note.frontmatter
    return {
        "nombre": note.item.title, "ruta": note.path, "obsidian_url": vault.obsidian_url(note.path),
        "empresa": fm.get("empresa") or None, "relacion": fm.get("relacion") or None, "rol": fm.get("rol") or None,
        "como_tratarle": sections.get("Cómo tratarle", [])[:3],
        "ultimo": sections.get("Historial", [])[-history:][::-1],
        "pendiente": sections.get("Pendiente", [])[:3],
    }


def mentioned(db: Session, text: str, emails: list[str] | None = None) -> list[dict]:
    """Las personas con ficha que aparecen en un texto (título de evento, asunto…) o por su email."""
    haystack = f" {fold(text)} "
    emails = {e.lower() for e in emails or []}
    people = all_people(db)
    first_names: dict[str, int] = {}
    for p in people:
        first = fold(p.item.title).split()[0] if p.item.title else ""
        first_names[first] = first_names.get(first, 0) + 1
    found = []
    for p in people:
        email = str(p.frontmatter.get("email") or "").lower()
        names = [fold(n) for n in _names(p)]
        first = fold(p.item.title).split()[0] if p.item.title else ""
        if first and first_names.get(first) == 1 and len(first) > 2:
            names.append(first)  # «Reunión con Óscar» si solo hay un Óscar
        if (email and email in emails) or any(re.search(rf"(?<!\w){re.escape(n)}(?!\w)", haystack) for n in names if n):
            found.append(card(p))
    return found


def rebuild_index(db: Session) -> None:
    """02-Areas/Personas.md: todas las fichas, agrupadas por relación (cliente, equipo…)."""
    r = vault.root()
    if r is None:
        return
    groups: dict[str, list[VaultNote]] = {}
    for p in all_people(db):
        groups.setdefault(str(p.frontmatter.get("relacion") or "Otras").capitalize(), []).append(p)
    lines = ["---", "tags: [moc, personas]", f"fecha: {date.today().isoformat()}", "estado: activo", "generado: jarvis", "---",
             "# Personas", "", "Una ficha por persona: quién es, cómo tratarle y lo que ha pasado. Jarvis la mantiene y te la "
             "recuerda antes de cada reunión. Este índice se regenera solo.", ""]
    for group, people in sorted(groups.items()):
        lines.append(f"## {group}")
        for p in people:
            extra = " · ".join(str(x) for x in (p.frontmatter.get("empresa"), p.frontmatter.get("rol")) if x)
            lines.append(f"- [[{p.item.title}]]" + (f" — {extra}" if extra else ""))
        lines.append("")
    lines += ["---", "Enlaces: [[Áreas]] · [[Inicio]]", ""]
    path = r / INDEX
    path.write_text("\n".join(lines))
    note = db.scalars(select(VaultNote).where(VaultNote.path == INDEX)).first()
    vault._upsert(db, r, path, note, path.stat().st_mtime)
    db.commit()


def for_event(db: Session, title: str, description: str | None, location: str | None, entities: dict | None) -> list[dict]:
    """Las fichas de las personas de un evento (por nombre en el título o por email de los asistentes)."""
    attendees = (entities or {}).get("attendees") or []
    text = " ".join(filter(None, [title, description or "", location or "", *[a.get("name", "") for a in attendees]]))
    return mentioned(db, text, [a.get("email", "") for a in attendees])
