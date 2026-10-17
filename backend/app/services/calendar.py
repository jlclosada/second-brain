"""Calendario: eventos propios, calendarios externos por iCal y feed para el móvil."""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

import httpx
import icalendar
import recurring_ical_events
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Calendar, Event, Item
from app.security import decrypt
from app.services.indexing import reindex
from app.services.jobs import enqueue, handler
from app.services.recurrence import occurrences

log = logging.getLogger(__name__)

MAX_ICS_BYTES = 15 * 1024 * 1024
SYNC_PAST = timedelta(days=90)
SYNC_FUTURE = timedelta(days=400)


@dataclass
class Occurrence:
    item: Item
    event: Event
    calendar: Calendar
    starts_at: datetime
    ends_at: datetime
    recurring: bool


def default_calendar(db: Session) -> Calendar:
    cal = db.scalars(select(Calendar).where(Calendar.source == "local").order_by(Calendar.created_at)).first()
    if cal is None:
        cal = Calendar(name="Personal", color="cobalt", source="local")
        db.add(cal)
        db.flush()
    return cal


def local_day_bounds(day: date) -> tuple[datetime, datetime]:
    tz = get_settings().tz
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def events_between(db: Session, start: datetime, end: datetime) -> list[Occurrence]:
    """Todas las ocurrencias que se solapan con [start, end), ya expandidas."""
    rows = db.execute(
        select(Event, Item, Calendar)
        .join(Item, Item.id == Event.item_id)
        .join(Calendar, Calendar.id == Event.calendar_id)
        .where(
            Calendar.enabled.is_(True),
            or_(
                (Event.rrule.is_(None)) & (Event.starts_at < end) & (Event.ends_at > start),
                (Event.rrule.is_not(None)) & (Event.starts_at < end)
                & (or_(Event.repeat_until.is_(None), Event.repeat_until >= start)),
            ),
        )
    ).all()
    result: list[Occurrence] = []
    for event, item, cal in rows:
        if event.rrule:
            for s, e in occurrences(event.rrule, event.starts_at, event.ends_at, start, end):
                result.append(Occurrence(item, event, cal, s, e, True))
        else:
            result.append(Occurrence(item, event, cal, event.starts_at, event.ends_at, False))
    result.sort(key=lambda o: (not o.event.all_day, o.starts_at))
    return result


# --- Calendarios externos (iCal) ---------------------------------------------

def _as_utc(value, *, all_day_end: bool = False) -> tuple[datetime, bool]:
    """Convierte DTSTART/DTEND de iCal a UTC. Devuelve (instante, es_día_completo)."""
    tz = get_settings().tz
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=tz)
        return value.astimezone(UTC), False
    return datetime.combine(value, time.min, tzinfo=tz).astimezone(UTC), True


def fetch_ics(url: str) -> bytes:
    with httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": "SegundoCerebro/1.0"}) as client:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_ICS_BYTES:
                    raise ValueError("El calendario es demasiado grande")
    return bytes(data)


def sync_calendar(db: Session, cal: Calendar, raw: bytes | None = None) -> int:
    """Descarga el iCal y deja en la base exactamente sus eventos de la ventana."""
    url = decrypt(cal.url_encrypted)
    if raw is None:
        if not url:
            raise ValueError("Este calendario no tiene enlace iCal")
        raw = fetch_ics(url)
    parsed = icalendar.Calendar.from_ical(raw)
    now = datetime.now(UTC)
    window = recurring_ical_events.of(parsed).between(now - SYNC_PAST, now + SYNC_FUTURE)

    existing = {
        e.external_key: e
        for e in db.scalars(
            select(Event).options(selectinload(Event.item)).where(Event.calendar_id == cal.id)
        )
    }
    seen: set[str] = set()
    changed: list[Item] = []
    for comp in window:
        if comp.get("STATUS", "").upper() == "CANCELLED":
            continue
        start_raw = comp.get("DTSTART")
        if start_raw is None:
            continue
        starts_at, all_day = _as_utc(start_raw.dt)
        end_raw = comp.get("DTEND")
        if end_raw is not None:
            ends_at, _ = _as_utc(end_raw.dt)
        elif comp.get("DURATION") is not None:
            ends_at = starts_at + comp.get("DURATION").dt
        else:
            ends_at = starts_at + (timedelta(days=1) if all_day else timedelta(hours=1))
        uid = str(comp.get("UID", "")) or f"{comp.get('SUMMARY', '')}-{starts_at.isoformat()}"
        key = f"{uid}|{starts_at.isoformat()}"
        if key in seen:
            continue
        seen.add(key)
        title = str(comp.get("SUMMARY", "") or "Sin título")[:300]
        location = str(comp.get("LOCATION", "") or "") or None
        description = (str(comp.get("DESCRIPTION", "") or "") or None)
        if description:
            description = description[:5000]

        event = existing.get(key)
        if event is None:
            item = Item(kind="event", title=title, status="ready", tags=[], entities={})
            event = Event(calendar_id=cal.id, external_key=key)
            item.event = event
            db.add(item)
        else:
            item = event.item
            if (item.title, event.starts_at, event.ends_at, event.location, event.description) == (
                title, starts_at, ends_at, location, description
            ):
                continue
        item.title = title
        event.starts_at, event.ends_at, event.all_day = starts_at, ends_at, all_day
        event.location, event.description = location, description
        changed.append(item)

    for key, event in existing.items():
        if key not in seen:
            db.delete(event.item)

    db.flush()
    for item in changed:
        reindex(db, item)
    cal.last_synced_at = now
    cal.sync_error = None
    return len(seen)


@handler("sync_calendar")
def _sync_calendar(db: Session, payload: dict) -> None:
    cal = db.get(Calendar, uuid.UUID(payload["calendar_id"]))
    if cal is None or cal.source != "ics" or not cal.enabled:
        return
    try:
        count = sync_calendar(db, cal)
        log.info("Calendario %s sincronizado: %d eventos", cal.name, count)
    except Exception as exc:  # el error se guarda para enseñarlo en Ajustes
        db.rollback()
        cal = db.get(Calendar, cal.id)
        cal.sync_error = str(exc)[:500]
        cal.last_synced_at = datetime.now(UTC)
        log.warning("No se pudo sincronizar %s: %s", cal.name, exc)


def schedule_sync(db: Session, cal: Calendar) -> None:
    enqueue(db, "sync_calendar", {"calendar_id": str(cal.id)}, dedupe=True, max_attempts=1)


# --- Feed iCal para suscribirse desde el móvil --------------------------------

def build_feed(db: Session) -> bytes:
    cal = icalendar.Calendar()
    cal.add("prodid", "-//Segundo Cerebro//ES")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "Segundo Cerebro")
    rows = db.execute(
        select(Event, Item)
        .join(Item, Item.id == Event.item_id)
        .join(Calendar, Calendar.id == Event.calendar_id)
        .where(Calendar.source == "local", Event.ends_at > datetime.now(UTC) - timedelta(days=180))
    ).all()
    tz = get_settings().tz
    for event, item in rows:
        ve = icalendar.Event()
        ve.add("uid", f"{item.id}@segundo-cerebro")
        ve.add("summary", item.title)
        if event.all_day:
            ve.add("dtstart", event.starts_at.astimezone(tz).date())
            ve.add("dtend", event.ends_at.astimezone(tz).date())
        else:
            ve.add("dtstart", event.starts_at)
            ve.add("dtend", event.ends_at)
        if event.location:
            ve.add("location", event.location)
        if event.description:
            ve.add("description", event.description)
        if event.rrule:
            ve.add("rrule", icalendar.vRecur.from_ical(event.rrule))
        ve.add("dtstamp", item.updated_at or datetime.now(UTC))
        cal.add_component(ve)
    return cal.to_ical()
