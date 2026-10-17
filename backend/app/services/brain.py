"""Operaciones del segundo cerebro compartidas por la API, la captura rápida y
el asistente: crear y modificar notas, tareas, eventos y recordatorios."""

import re
import uuid
from datetime import UTC, date, datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Calendar, Event, Item, ItemLink, Note, Project, Reminder, Task
from app.schemas import (
    EventIn,
    EventOut,
    LinkRef,
    NoteIn,
    NoteOut,
    ReminderIn,
    ReminderOut,
    TaskIn,
    TaskOut,
)
from app.services.calendar import Occurrence, default_calendar
from app.services.indexing import schedule_index
from app.services.recurrence import next_date, repeat_until

WIKILINK_RE = re.compile(r"\[\[([^\[\]\n]{1,200})\]\]")
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
          "septiembre", "octubre", "noviembre", "diciembre"]
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def clean_tags(tags: list[str] | None) -> list[str]:
    return sorted({t.strip().lstrip("#").lower() for t in tags or [] if t.strip().lstrip("#")})[:20]


def get_item(db: Session, item_id: uuid.UUID, kind: str | None = None) -> Item:
    item = db.get(Item, item_id)
    if item is None or (kind and item.kind != kind):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No encontrado")
    return item


def check_project(db: Session, project_id: uuid.UUID | None) -> None:
    if project_id and db.get(Project, project_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ese proyecto no existe")


# --- Notas -------------------------------------------------------------------

def _note_title(title: str, body: str) -> str:
    if title.strip():
        return title.strip()[:300]
    first = next((line.strip("# ").strip() for line in body.splitlines() if line.strip()), "")
    return first[:120] or "Nota sin título"


def excerpt(body: str, length: int = 180) -> str:
    text = re.sub(r"^\s*[-*+]\s+\[[ xX]\]\s*", "", body, flags=re.MULTILINE)  # casillas de listas
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"[#>*_`\-\[\]]+", " ", text)
    text = " ".join(text.split())
    return text[:length] + ("…" if len(text) > length else "")


def note_out(item: Item) -> NoteOut:
    note = item.note
    return NoteOut(
        id=item.id, title=item.title, body=note.body if note else "", excerpt=excerpt(note.body if note else ""),
        tags=item.tags, pinned=item.pinned, project_id=item.project_id,
        journal_date=note.journal_date if note else None, created_at=item.created_at, updated_at=item.updated_at,
    )


def update_links(db: Session, item: Item) -> None:
    """Sincroniza los enlaces [[Título]] de una nota con la tabla de enlaces."""
    db.execute(delete(ItemLink).where(ItemLink.source_id == item.id))
    titles = {m.strip().lower() for m in WIKILINK_RE.findall(item.note.body if item.note else "")}
    if not titles:
        return
    targets = db.scalars(
        select(Item.id).where(func.lower(Item.title).in_(titles), Item.id != item.id)
    ).all()
    for target in set(targets):
        db.add(ItemLink(source_id=item.id, target_id=target))


def relink_mentions(db: Session, item: Item) -> None:
    """Las notas que ya mencionaban [[este título]] pasan a enlazar con este elemento."""
    pattern = f"%[[{item.title.replace('%', '').replace('_', '')}]]%"
    for other in db.scalars(select(Item).join(Note).where(Note.body.ilike(pattern), Item.id != item.id)):
        update_links(db, other)


def links_of(db: Session, item: Item) -> tuple[list[LinkRef], list[LinkRef]]:
    out = db.execute(
        select(Item.id, Item.kind, Item.title).join(ItemLink, ItemLink.target_id == Item.id)
        .where(ItemLink.source_id == item.id)
    ).all()
    back = db.execute(
        select(Item.id, Item.kind, Item.title).join(ItemLink, ItemLink.source_id == Item.id)
        .where(ItemLink.target_id == item.id)
    ).all()
    return [LinkRef(id=r.id, kind=r.kind, title=r.title) for r in out], [
        LinkRef(id=r.id, kind=r.kind, title=r.title) for r in back
    ]


def create_note(db: Session, data: NoteIn, journal_date: date | None = None) -> Item:
    check_project(db, data.project_id)
    item = Item(
        kind="note", title=_note_title(data.title, data.body), status="ready", tags=clean_tags(data.tags),
        entities={}, pinned=data.pinned, project_id=data.project_id,
    )
    item.note = Note(body=data.body, journal_date=journal_date)
    db.add(item)
    db.flush()
    update_links(db, item)
    relink_mentions(db, item)
    schedule_index(db, item.id)
    db.commit()
    return item


def update_note(db: Session, item: Item, changes: dict) -> Item:
    check_project(db, changes.get("project_id"))
    if "body" in changes:
        item.note.body = changes["body"]
    if item.note.journal_date is None and ("title" in changes or "body" in changes):
        item.title = _note_title(changes.get("title", item.title), item.note.body)
    for key in ("pinned", "project_id"):
        if key in changes:
            setattr(item, key, changes[key])
    if "tags" in changes:
        item.tags = clean_tags(changes["tags"])
    item.updated_at = datetime.now(UTC)
    db.flush()
    update_links(db, item)
    if "title" in changes:
        relink_mentions(db, item)
    schedule_index(db, item.id)
    db.commit()
    return item


def journal_title(day: date) -> str:
    return f"Diario del {WEEKDAYS[day.weekday()]} {day.day} de {MONTHS[day.month - 1]} de {day.year}"


def journal_for(db: Session, day: date, create: bool) -> Item | None:
    item = db.scalars(select(Item).join(Note).where(Note.journal_date == day)).first()
    if item is None and create:
        item = create_note(db, NoteIn(title=journal_title(day), body="", tags=["diario"]), journal_date=day)
    return item


# --- Tareas ------------------------------------------------------------------

def task_out(item: Item) -> TaskOut:
    t = item.task
    return TaskOut(
        id=item.id, title=item.title, notes=t.notes, due_date=t.due_date, due_time=t.due_time, priority=t.priority,
        done_at=t.done_at, rrule=t.rrule, remind=t.remind, tags=item.tags, project_id=item.project_id,
        sort=t.sort, created_at=item.created_at,
    )


def create_task(db: Session, data: TaskIn) -> Item:
    check_project(db, data.project_id)
    item = Item(kind="task", title=data.title.strip(), status="ready", tags=clean_tags(data.tags), entities={},
                project_id=data.project_id)
    item.task = Task(
        notes=data.notes, due_date=data.due_date, due_time=data.due_time if data.due_date else None,
        priority=data.priority, rrule=data.rrule, remind=data.remind,
        sort=datetime.now(UTC).timestamp(),
    )
    db.add(item)
    db.flush()
    schedule_index(db, item.id)
    db.commit()
    return item


def update_task(db: Session, item: Item, changes: dict) -> Item:
    check_project(db, changes.get("project_id"))
    t = item.task
    done = changes.pop("done", None)
    for key in ("notes", "due_date", "due_time", "priority", "rrule", "remind", "sort"):
        if key in changes:
            setattr(t, key, changes[key])
    if t.due_date is None:
        t.due_time = None
    if "title" in changes:
        item.title = changes["title"].strip()
    if "project_id" in changes:
        item.project_id = changes["project_id"]
    if "tags" in changes:
        item.tags = clean_tags(changes["tags"])
    if done is True:
        complete_task(item)
    elif done is False:
        t.done_at = None
    item.updated_at = datetime.now(UTC)
    schedule_index(db, item.id)
    db.commit()
    return item


def complete_task(item: Item) -> None:
    """Marca como hecha. Si se repite, en vez de cerrarla pasa a la siguiente fecha."""
    t = item.task
    if t.rrule and t.due_date:
        today = datetime.now(get_settings().tz).date()
        nxt = next_date(t.rrule, t.due_date)
        while nxt and nxt <= today:
            nxt = next_date(t.rrule, nxt)
        if nxt:
            t.due_date = nxt
            t.done_at = None
            return
    t.done_at = datetime.now(UTC)


# --- Eventos -----------------------------------------------------------------

def _event_bounds(starts_at: datetime, ends_at: datetime | None, all_day: bool) -> tuple[datetime, datetime]:
    tz = get_settings().tz
    if starts_at.tzinfo is None:
        starts_at = starts_at.replace(tzinfo=tz)
    if ends_at is not None and ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=tz)
    if all_day:
        first = starts_at.astimezone(tz).date()
        last = ends_at.astimezone(tz).date() if ends_at else first
        # El fin de un evento de día completo es exclusivo: medianoche del día siguiente.
        if ends_at is None or last <= first or ends_at.astimezone(tz).time() != time.min:
            last = max(last, first) + timedelta(days=1)
        starts_at = datetime.combine(first, time.min, tzinfo=tz)
        ends_at = datetime.combine(last, time.min, tzinfo=tz)
    elif ends_at is None or ends_at <= starts_at:
        ends_at = starts_at + timedelta(hours=1)
    return starts_at.astimezone(UTC), ends_at.astimezone(UTC)


def _local_calendar(db: Session, calendar_id: uuid.UUID | None) -> Calendar:
    if calendar_id is None:
        return default_calendar(db)
    cal = db.get(Calendar, calendar_id)
    if cal is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ese calendario no existe")
    if cal.source != "local":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Los calendarios sincronizados son de solo lectura")
    return cal


def create_event(db: Session, data: EventIn) -> Item:
    check_project(db, data.project_id)
    cal = _local_calendar(db, data.calendar_id)
    starts_at, ends_at = _event_bounds(data.starts_at, data.ends_at, data.all_day)
    item = Item(kind="event", title=data.title.strip(), status="ready", tags=clean_tags(data.tags), entities={},
                project_id=data.project_id)
    item.event = Event(
        calendar_id=cal.id, starts_at=starts_at, ends_at=ends_at, all_day=data.all_day, location=data.location,
        description=data.description, rrule=data.rrule, repeat_until=repeat_until(data.rrule, starts_at),
        remind_minutes=data.remind_minutes,
    )
    db.add(item)
    db.flush()
    schedule_index(db, item.id)
    db.commit()
    return item


def update_event(db: Session, item: Item, changes: dict) -> Item:
    e = item.event
    if e.calendar.source != "local":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Este evento viene de un calendario sincronizado")
    check_project(db, changes.get("project_id"))
    if "calendar_id" in changes and changes["calendar_id"]:
        e.calendar_id = _local_calendar(db, changes["calendar_id"]).id
    for key in ("location", "description", "rrule", "remind_minutes"):
        if key in changes:
            setattr(e, key, changes[key])
    if {"starts_at", "ends_at", "all_day"} & changes.keys():
        all_day = changes.get("all_day", e.all_day)
        start = changes.get("starts_at") or e.starts_at
        end = changes.get("ends_at") if "ends_at" in changes else (
            None if "starts_at" in changes else e.ends_at
        )
        if end is None and "starts_at" in changes and not all_day:
            end = start + (e.ends_at - e.starts_at)
        e.starts_at, e.ends_at = _event_bounds(start, end, all_day)
        e.all_day = all_day
    e.repeat_until = repeat_until(e.rrule, e.starts_at)
    if "title" in changes:
        item.title = changes["title"].strip()
    if "tags" in changes:
        item.tags = clean_tags(changes["tags"])
    if "project_id" in changes:
        item.project_id = changes["project_id"]
    item.updated_at = datetime.now(UTC)
    schedule_index(db, item.id)
    db.commit()
    return item


def event_out(occ: Occurrence) -> EventOut:
    e, item = occ.event, occ.item
    return EventOut(
        id=item.id, title=item.title, calendar_id=occ.calendar.id, color=occ.calendar.color,
        source=occ.calendar.source, starts_at=occ.starts_at, ends_at=occ.ends_at, all_day=e.all_day,
        location=e.location, description=e.description, rrule=e.rrule, remind_minutes=e.remind_minutes,
        tags=item.tags, project_id=item.project_id, recurring=occ.recurring,
    )


def event_item_out(item: Item) -> EventOut:
    e = item.event
    return event_out(Occurrence(item, e, e.calendar, e.starts_at, e.ends_at, bool(e.rrule)))


# --- Recordatorios ----------------------------------------------------------

def reminder_out(r: Reminder) -> ReminderOut:
    return ReminderOut.model_validate(r)


def create_reminder(db: Session, data: ReminderIn) -> Reminder:
    remind_at = data.remind_at
    if remind_at.tzinfo is None:
        remind_at = remind_at.replace(tzinfo=get_settings().tz)
    if data.item_id:
        get_item(db, data.item_id)
    r = Reminder(title=data.title.strip(), remind_at=remind_at.astimezone(UTC), item_id=data.item_id)
    db.add(r)
    db.commit()
    return r


def link_ref(item: Item) -> LinkRef:
    return LinkRef(id=item.id, kind=item.kind, title=item.title)
