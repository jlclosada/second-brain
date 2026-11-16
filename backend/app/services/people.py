"""Personas: una ficha por persona en el vault (02-Areas/Personas/) para acordarte de quién es,
cómo tratarle y qué ha pasado con ella (con fechas e imágenes).

    02-Areas/Personas/Óscar Martín.md
      ## Quién es · ## Cómo tratarle · ## Historial · ## Pendiente
    Adjuntos/Personas/Óscar Martín/2026-10-18 Acuerdo HP.png
    02-Areas/Personas.md   ← índice que mantiene Jarvis

Antes de una reunión, Jarvis busca en el evento a las personas con ficha y te recuerda lo importante.
"""

import hashlib
import re
import shutil
import unicodedata
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Email, Item, VaultNote
from app.services import vault

FOLDER = vault.PEOPLE_FOLDER
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
    return _create_file(db, name, fields), True


def _create_file(db: Session, name: str, fields: dict | None = None) -> str:
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
    return rel_path


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
        "id": str(note.item_id), "nombre": note.item.title, "ruta": note.path, "obsidian_url": vault.obsidian_url(note.path),
        "empresa": fm.get("empresa") or None, "relacion": fm.get("relacion") or None, "rol": fm.get("rol") or None,
        "como_tratarle": sections.get("Cómo tratarle", [])[:3],
        "ultimo": sections.get("Historial", [])[-history:][::-1],
        "pendiente": sections.get("Pendiente", [])[:3],
    }


def _matcher(people: list[VaultNote]):
    """Una función que dice si una persona aparece en un texto (por nombre, alias o nombre de pila
    si no hay otra igual) o entre unos emails."""
    first_names: dict[str, int] = {}
    for p in people:
        first = fold(p.item.title).split()[0] if p.item.title.strip() else ""
        first_names[first] = first_names.get(first, 0) + 1

    def matches(p: VaultNote, haystack: str, emails: set[str]) -> bool:
        email = str(p.frontmatter.get("email") or "").lower()
        names = [fold(n) for n in _names(p)]
        first = fold(p.item.title).split()[0] if p.item.title.strip() else ""
        if first and first_names.get(first) == 1 and len(first) > 2:
            names.append(first)  # «Reunión con Óscar» si solo hay un Óscar
        return bool(email and email in emails) or any(
            re.search(rf"(?<!\w){re.escape(n)}(?!\w)", haystack) for n in names if n)

    return matches


def mentioned(db: Session, text: str, emails: list[str] | None = None) -> list[dict]:
    """Las personas con ficha que aparecen en un texto (título de evento, asunto…) o por su email."""
    haystack = f" {fold(text)} "
    emails_set = {e.lower() for e in emails or []}
    people = all_people(db)
    matches = _matcher(people)
    return [card(p) for p in people if matches(p, haystack, emails_set)]


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


# --- Para la sección Personas de la interfaz ------------------------------------------------
#
# La ficha sigue siendo un archivo Markdown del vault (se puede editar también en Obsidian). La
# interfaz la lee por secciones y cambia líneas concretas: cada apunte se identifica por un hash
# de su línea, así que si la ficha cambió en Obsidian entre medias no se pisa nada (409).

FIELDS = ("empresa", "rol", "relacion", "email", "telefono", "cumpleanos", "alias")
ENTRY_RE = re.compile(r"^- \*\*(\d{4}-\d{2}-\d{2})\*\*\s*[—–-]\s*(.*)$")
EMBED_RE = re.compile(r"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")


class Conflict(Exception):
    """La línea que se quería cambiar ya no está (la ficha cambió en Obsidian)."""


def today() -> date:
    return datetime.now(get_settings().tz).date()


def is_person(note: VaultNote | None) -> bool:
    return bool(note and note.path.startswith(f"{FOLDER}/") and note.path.endswith(".md"))


def get(db: Session, person_id) -> VaultNote | None:
    note = db.get(VaultNote, person_id)
    return note if is_person(note) else None


def clean_line(text: str) -> str:
    """Un apunte es una línea de lista: sin saltos de línea ni espacios de más."""
    return " ".join(text.split())


def _entry_id(section: str, raw: str, n: int) -> str:
    return hashlib.sha256(f"{fold(section)}\x00{raw}\x00{n}".encode()).hexdigest()[:16]


def _section_blocks(lines: list[str]) -> dict[str, list[tuple[int, int]]]:
    """Por sección, los apuntes como (primera línea, línea siguiente al apunte), incluidas sus
    líneas sangradas (imágenes ![[…]] o texto que continúa)."""
    out: dict[str, list[tuple[int, int]]] = {}
    current = None
    in_fm = bool(lines) and lines[0].strip() == "---"
    i = 1 if in_fm else 0
    if in_fm:
        while i < len(lines) and lines[i].strip() != "---":
            i += 1
        i += 1
    while i < len(lines):
        line = lines[i]
        if line.startswith("#"):
            current = line.lstrip("#").strip() if line.startswith("## ") else None
            i += 1
            continue
        if line.strip() == "---":
            current = None
        if current and line.startswith("- ") and line[2:].strip():
            end = i + 1
            while end < len(lines) and lines[end].startswith(("  ", "\t")) and lines[end].strip():
                end += 1
            out.setdefault(current, []).append((i, end))
            i = end
            continue
        i += 1
    return out


def _entries(text: str) -> dict[str, list[dict]]:
    lines = text.splitlines()
    out: dict[str, list[dict]] = {}
    for section, blocks in _section_blocks(lines).items():
        seen: dict[str, int] = {}
        for start, end in blocks:
            raw = lines[start]
            n = seen.get(raw, 0)
            seen[raw] = n + 1
            m = ENTRY_RE.match(raw)
            day, body = (m.group(1), m.group(2)) if m else (None, raw[2:].strip())
            extra = [ln.strip() for ln in lines[start + 1:end]]
            images = [e for ln in extra for e in EMBED_RE.findall(ln)]
            more = " ".join(EMBED_RE.sub("", ln).strip() for ln in extra).strip()
            out.setdefault(section, []).append({
                "id": _entry_id(section, raw, n), "section": section, "date": day,
                "text": re.sub(r"\*\*(.+?)\*\*", r"\1", (body + (" " + more if more else "")).strip()),
                "attachments": images,
            })
    return out


def _canonical_section(section: str) -> str:
    return next((s for s in SECTIONS if fold(s) == fold(section)), "")


def _rewrite(db: Session, note: VaultNote, change) -> None:
    """Aplica un cambio a las líneas del archivo y vuelve a indexar la ficha."""
    path = vault._resolve(note.path)
    lines = path.read_text().splitlines()
    lines = change(lines)
    path.write_text("\n".join(lines) + "\n")
    vault._upsert(db, vault.root(), path, note, path.stat().st_mtime)
    db.commit()


def _locate(lines: list[str], entry_id: str) -> tuple[str, int, int]:
    for section, blocks in _section_blocks(lines).items():
        seen: dict[str, int] = {}
        for start, end in blocks:
            raw = lines[start]
            n = seen.get(raw, 0)
            seen[raw] = n + 1
            if _entry_id(section, raw, n) == entry_id:
                return section, start, end
    raise Conflict("Ese apunte ya no está en la ficha (¿lo cambiaste en Obsidian?). Recarga la página.")


def add_entry(db: Session, note: VaultNote, text: str, day: date | None, section: str = "Historial") -> None:
    section = _canonical_section(section) or "Historial"
    text = clean_line(text)
    line = f"- **{(day or today()).isoformat()}** — {text}" if section == "Historial" else f"- {text}"
    vault.append_lines(db, note.path, section, [line])


def edit_entry(db: Session, note: VaultNote, entry_id: str, text: str, day: date | None) -> None:
    def change(lines: list[str]) -> list[str]:
        section, start, _ = _locate(lines, entry_id)
        m = ENTRY_RE.match(lines[start])
        if fold(section) == fold("Historial") or m:
            old_day = m.group(1) if m else None
            when = day.isoformat() if day else (old_day or today().isoformat())
            lines[start] = f"- **{when}** — {clean_line(text)}"
        else:
            lines[start] = f"- {clean_line(text)}"
        return lines

    _rewrite(db, note, change)


def delete_entry(db: Session, note: VaultNote, entry_id: str) -> str:
    """Quita un apunte (con sus imágenes enlazadas debajo; los archivos de imagen se quedan en Adjuntos)."""
    removed = {}

    def change(lines: list[str]) -> list[str]:
        section, start, end = _locate(lines, entry_id)
        removed["text"] = lines[start]
        rest = lines[:start] + lines[end:]
        if section not in _section_blocks(rest):
            rest.insert(start, "-")  # la sección queda como en la plantilla
        return rest

    _rewrite(db, note, change)
    return removed["text"]


def complete_pending(db: Session, note: VaultNote, entry_id: str) -> None:
    """Un pendiente hecho pasa al historial con la fecha de hoy."""
    path = vault._resolve(note.path)
    section, start, _ = _locate(path.read_text().splitlines(), entry_id)
    if fold(section) != fold("Pendiente"):
        raise Conflict("Solo se pueden completar los pendientes")
    entry = next(e for e in _entries(path.read_text()).get(section, []) if e["id"] == entry_id)
    delete_entry(db, note, entry_id)
    add_entry(db, note, f"Hecho: {entry['text']}", today(), "Historial")


def update_fields(db: Session, note: VaultNote, fields: dict) -> None:
    """Cambia los datos de la ficha (empresa, rol…). Aquí sí se sobrescriben: lo pide la persona."""
    path = vault._resolve(note.path)
    fm, body = vault.parse(path.read_text())
    for key, value in fields.items():
        if key not in FIELDS:
            continue
        if key == "alias":
            fm[key] = [clean_line(str(a)).replace(",", " ") for a in (value or []) if str(a).strip()]
        else:
            fm[key] = clean_line(str(value)) if value else ""
    fm = {k: ("" if v is None else v) for k, v in fm.items()}
    path.write_text(vault._dump_frontmatter(fm) + body.lstrip("\n"))
    vault._upsert(db, vault.root(), path, note, path.stat().st_mtime)
    db.commit()
    rebuild_index(db)


def create(db: Session, name: str, fields: dict | None = None, about: str | None = None) -> tuple[VaultNote, bool]:
    """Ficha nueva desde la interfaz. Si ya hay una con ese nombre exacto (o alias), devuelve esa."""
    wanted = fold(name)
    existing = next((p for p in all_people(db) if wanted in {fold(n) for n in _names(p)}), None)
    if existing:
        return existing, False
    rel_path = _create_file(db, name)
    note = db.scalars(select(VaultNote).where(VaultNote.path == rel_path)).one()
    if fields:
        update_fields(db, note, fields)
    if about and about.strip():
        add_entry(db, note, about, None, "Quién es")
    return note, True


def _newest_first(entries: list[dict]) -> list[dict]:
    """Por fecha, lo más reciente arriba; con la misma fecha, lo último que se apuntó primero."""
    return sorted(entries[::-1], key=lambda e: e["date"] or "", reverse=True)


def summary(note: VaultNote) -> dict:
    """Para la lista de personas."""
    fm = note.frontmatter
    entries = _entries(note.body)
    history = _newest_first([e for e in entries.get("Historial", []) if e["date"]])
    return {
        "id": str(note.item_id), "name": note.item.title, "path": note.path,
        "company": fm.get("empresa") or None, "role": fm.get("rol") or None,
        "relation": fm.get("relacion") or None, "email": fm.get("email") or None,
        "entries": len(entries.get("Historial", [])), "pending": len(entries.get("Pendiente", [])),
        "last_entry": history[0] if history else None,
        "updated_at": note.item.updated_at.isoformat() if note.item.updated_at else None,
    }


def events_with(db: Session, note: VaultNote, past_days: int = 365, ahead_days: int = 90) -> tuple[list, list]:
    """Eventos del calendario con esta persona (por nombre o email de los asistentes): (próximos, pasados)."""
    from app.services.calendar import events_between

    now = datetime.now(UTC)
    matches = _matcher(all_people(db))
    emails_of = lambda o: {str(a.get("email", "")).lower() for a in (o.item.entities or {}).get("attendees") or []}  # noqa: E731
    upcoming, past = [], []
    for o in events_between(db, now - timedelta(days=past_days), now + timedelta(days=ahead_days)):
        attendees = (o.item.entities or {}).get("attendees") or []
        text = " ".join(filter(None, [o.item.title, o.event.description or "", o.event.location or "",
                                      *[str(a.get("name", "")) for a in attendees]]))
        if matches(note, f" {fold(text)} ", emails_of(o)):
            (upcoming if o.ends_at > now else past).append(o)
    return upcoming[:5], past[::-1][:10]


def mentions(db: Session, note: VaultNote, limit: int = 8) -> list[dict]:
    """Otras notas del vault (diario, proyectos, reuniones) que enlazan o nombran a esta persona."""
    title = note.item.title.replace("%", "").replace("_", "")
    if not title.strip():
        return []
    # Candidatas por el nombre completo, los alias o el nombre de pila; luego se confirma con el
    # mismo criterio que en los eventos («Samuel» vale si solo hay un Samuel).
    terms = {t.replace("%", "").replace("_", "") for t in [title, *_names(note), title.split()[0]] if len(t.strip()) > 2}
    rows = db.execute(
        select(VaultNote.item_id, VaultNote.path, VaultNote.body, Item.title).join(Item, Item.id == VaultNote.item_id)
        .where(VaultNote.path != note.path, VaultNote.path != INDEX, ~VaultNote.path.like(f"{FOLDER}/%"),
               or_(*[VaultNote.body.ilike(f"%{t}%") for t in terms]))
        .order_by(VaultNote.path.desc()).limit(limit * 4)
    ).all()
    matches = _matcher(all_people(db))
    out = []
    for item_id, path, body, ttl in rows:
        if len(out) >= limit or not matches(note, f" {fold(body)} ", set()):
            continue
        low = body.lower()
        i = next((low.find(t.lower()) for t in sorted(terms, key=len, reverse=True) if t.lower() in low), -1)
        snippet = vault.excerpt(body[max(0, i - 120): i + 180], 240) if i >= 0 else vault.excerpt(body, 200)
        out.append({"id": str(item_id), "title": ttl, "path": path, "snippet": snippet,
                    "obsidian_url": vault.obsidian_url(path)})
    return out


def emails_with(db: Session, note: VaultNote, limit: int = 5) -> list[Email]:
    email = str(note.frontmatter.get("email") or "").strip().lower()
    if not email:
        return []
    return db.scalars(
        select(Email).options(selectinload(Email.item)).where(Email.sender_email.ilike(email))
        .order_by(Email.received_at.desc()).limit(limit)
    ).all()


def detail(db: Session, note: VaultNote) -> dict:
    from app.services import brain

    entries = _entries(note.body)
    history = _newest_first(entries.get("Historial", []))
    upcoming, past = events_with(db, note)
    fm = note.frontmatter
    aliases = fm.get("alias") or fm.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [a.strip() for a in aliases.split(",") if a.strip()]
    return {
        **summary(note),
        "phone": fm.get("telefono") or None, "birthday": str(fm.get("cumpleanos") or "") or None,
        "aliases": [str(a) for a in aliases],
        "obsidian_url": vault.obsidian_url(note.path),
        "history": history,
        "about": entries.get("Quién es", []), "how_to": entries.get("Cómo tratarle", []),
        "todo": entries.get("Pendiente", []),
        "other_sections": {k: v for k, v in entries.items() if k not in SECTIONS},
        "upcoming": [brain.event_out(o) for o in upcoming],
        "past_meetings": [brain.event_out(o) for o in past],
        "mentions": mentions(db, note),
        "emails": [{"id": str(e.item_id), "subject": e.item.title, "snippet": e.snippet,
                    "received_at": e.received_at.isoformat()} for e in emails_with(db, note)],
    }


def context_for_ai(db: Session, note: VaultNote) -> str:
    """Todo lo que se sabe de una persona, en texto, para que Claude prepare la chuleta."""
    d = detail(db, note)
    tz = get_settings().tz
    lines = [f"Persona: {d['name']}"]
    for label, key in (("Empresa", "company"), ("Rol", "role"), ("Relación", "relation"), ("Cumpleaños", "birthday")):
        if d.get(key):
            lines.append(f"{label}: {d[key]}")
    for title, key in (("Quién es", "about"), ("Cómo tratarle", "how_to"), ("Pendiente", "todo")):
        if d[key]:
            lines += [f"\n## {title}", *[f"- {e['text']}" for e in d[key]]]
    if d["history"]:
        lines += ["\n## Historial (más reciente primero)", *[f"- {e['date'] or 's/f'}: {e['text']}" for e in d["history"][:40]]]
    fmt = lambda e: e.starts_at.astimezone(tz).strftime("%Y-%m-%d %H:%M")  # noqa: E731
    if d["upcoming"]:
        lines += ["\n## Próximas reuniones", *[f"- {fmt(e)}: {e.title}" for e in d["upcoming"]]]
    if d["past_meetings"]:
        lines += ["\n## Reuniones anteriores", *[f"- {fmt(e)}: {e.title}" for e in d["past_meetings"][:5]]]
    if d["mentions"]:
        lines += ["\n## Menciones en otras notas", *[f"- «{m['title']}»: {m['snippet']}" for m in d["mentions"]]]
    if d["emails"]:
        lines += ["\n## Últimos correos suyos", *[f"- {e['received_at'][:10]}: {e['subject']} — {e['snippet'][:160]}"
                                                   for e in d["emails"]]]
    return "\n".join(lines)
