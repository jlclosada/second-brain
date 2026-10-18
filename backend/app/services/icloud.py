"""Calendario de iCloud (el del iPhone) en los dos sentidos, por CalDAV.

Apple no tiene OAuth para esto: se usa el Apple ID y una «contraseña de app» que
se genera en appleid.apple.com (no la contraseña del Apple ID). Se guarda cifrada.

Los eventos sueltos se pueden crear, editar y borrar desde aquí; los que se
repiten se ven pero se editan en el iPhone (cambiar una serie por CalDAV es frágil).
"""

import json
import logging
import uuid
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from urllib.parse import urljoin

import httpx
import icalendar
import recurring_ical_events
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Calendar, Event, Integration, Item
from app.security import decrypt, encrypt
from app.services.calendar import _as_utc
from app.services.google import _nearest_color
from app.services.indexing import schedule_index
from app.services.jobs import enqueue, handler

log = logging.getLogger(__name__)

BASE = "https://caldav.icloud.com/"
NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav", "a": "http://apple.com/ns/ical/"}
SYNC_PAST = timedelta(days=60)
SYNC_FUTURE = timedelta(days=365)
# En los tests se sustituye por un httpx.MockTransport.
transport: httpx.BaseTransport | None = None


class ICloudError(Exception):
    pass


class ICloudAuth(ICloudError):
    """Apple ID o contraseña de app incorrectos (o revocada)."""


def _http(apple_id: str, password: str) -> httpx.Client:
    return httpx.Client(auth=(apple_id, password), timeout=30, transport=transport, follow_redirects=True,
                        headers={"User-Agent": "SegundoCerebro/1.0"})


def _check(r: httpx.Response, ok: tuple[int, ...] = (207,)) -> httpx.Response:
    if r.status_code == 401:
        raise ICloudAuth("iCloud no acepta ese Apple ID o la contraseña de app")
    if r.status_code not in ok:
        raise ICloudError(f"iCloud respondió {r.status_code}")
    return r


def _dav(http: httpx.Client, method: str, url: str, body: str, depth: str) -> ET.Element:
    r = _check(http.request(method, url, content=body.encode(), headers={
        "Depth": depth, "Content-Type": "application/xml; charset=utf-8",
    }))
    return ET.fromstring(r.content)


def _href(root: ET.Element, prop: str) -> str | None:
    node = root.find(f".//{prop}/d:href", NS)
    return node.text.strip() if node is not None and node.text else None


def discover(http: httpx.Client) -> list[dict]:
    """Los calendarios de eventos de la cuenta: url, nombre, color y si se puede escribir."""
    root = _dav(http, "PROPFIND", BASE,
                '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', "0")
    principal = _href(root, "d:current-user-principal")
    if not principal:
        raise ICloudError("iCloud no devolvió la cuenta")
    principal = urljoin(BASE, principal)
    root = _dav(http, "PROPFIND", principal,
                '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
                '<d:prop><c:calendar-home-set/></d:prop></d:propfind>', "0")
    home = _href(root, "c:calendar-home-set")
    if not home:
        raise ICloudError("iCloud no devolvió dónde están los calendarios")
    home = urljoin(principal, home)
    root = _dav(http, "PROPFIND", home,
                '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">'
                '<d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/>'
                '<d:current-user-privilege-set/></d:prop></d:propfind>', "1")
    calendars = []
    for resp in root.findall("d:response", NS):
        href = resp.findtext("d:href", namespaces=NS)
        prop = resp.find(".//d:prop", NS)
        if not href or prop is None or prop.find("d:resourcetype/c:calendar", NS) is None:
            continue
        comps = [c.get("name") for c in prop.findall("c:supported-calendar-component-set/c:comp", NS)]
        if comps and "VEVENT" not in comps:
            continue  # recordatorios, no eventos
        privileges = {p.tag.split("}")[-1] for p in prop.findall("d:current-user-privilege-set/d:privilege/*", NS)}
        calendars.append({
            "url": urljoin(home, href),
            "name": (prop.findtext("d:displayname", namespaces=NS) or "iCloud").strip(),
            "color": (prop.findtext("a:calendar-color", namespaces=NS) or "")[:7],
            "writable": bool(privileges & {"write", "write-content", "all"}) or not privileges,
        })
    return calendars


def _creds(db: Session) -> tuple[Integration, str, str]:
    row = db.get(Integration, "icloud")
    data = json.loads(decrypt(row.secret_encrypted) or "{}") if row and row.secret_encrypted else {}
    if not data.get("apple_id"):
        raise ICloudAuth("iCloud no está conectado")
    return row, data["apple_id"], data["password"]


def connect(db: Session, apple_id: str, password: str) -> Integration:
    apple_id, password = apple_id.strip(), password.strip().replace(" ", "")
    with _http(apple_id, password) as http:
        found = discover(http)
    row = db.get(Integration, "icloud")
    if row is None:
        row = Integration(provider="icloud", state={})
        db.add(row)
    row.secret_encrypted = encrypt(json.dumps({"apple_id": apple_id, "password": password}))
    row.account = apple_id
    row.status, row.error = "ok", None
    row.connected_at = datetime.now(UTC)
    db.flush()
    enqueue(db, "sync_icloud", {}, dedupe=True, max_attempts=1)
    log.info("iCloud conectado: %d calendarios", len(found))
    return row


def disconnect(db: Session) -> None:
    for cal in db.scalars(select(Calendar).where(Calendar.source == "icloud")):
        for item_id in db.scalars(select(Event.item_id).where(Event.calendar_id == cal.id)).all():
            db.delete(db.get(Item, item_id))
        db.delete(cal)
    row = db.get(Integration, "icloud")
    if row is not None:
        db.delete(row)


# --- Lectura ---------------------------------------------------------------------------

def _range_query(start: datetime, end: datetime) -> str:
    fmt = "%Y%m%dT%H%M%SZ"
    return (
        '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        '<d:prop><d:getetag/><c:calendar-data/></d:prop>'
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
        f'<c:time-range start="{start.strftime(fmt)}" end="{end.strftime(fmt)}"/>'
        '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'
    )


def sync_events(db: Session, http: httpx.Client, cal: Calendar) -> int:
    now = datetime.now(UTC)
    start, end = now - SYNC_PAST, now + SYNC_FUTURE
    root = _dav(http, "REPORT", cal.external_id, _range_query(start, end), "1")

    existing = {
        e.external_key: e
        for e in db.scalars(select(Event).options(selectinload(Event.item)).where(Event.calendar_id == cal.id))
    }
    seen: set[str] = set()
    for resp in root.findall("d:response", NS):
        href = urljoin(cal.external_id, resp.findtext("d:href", namespaces=NS) or "")
        etag = resp.findtext(".//d:getetag", namespaces=NS) or ""
        data = resp.findtext(".//c:calendar-data", namespaces=NS)
        if not data:
            continue
        try:
            parsed = icalendar.Calendar.from_ical(data)
        except ValueError:
            continue
        masters = [c for c in parsed.walk("VEVENT")]
        recurring = any(c.get("RRULE") or c.get("RECURRENCE-ID") for c in masters)
        for comp in recurring_ical_events.of(parsed).between(start, end):
            if str(comp.get("STATUS", "")).upper() == "CANCELLED" or comp.get("DTSTART") is None:
                continue
            starts_at, all_day = _as_utc(comp.get("DTSTART").dt)
            if comp.get("DTEND") is not None:
                ends_at, _ = _as_utc(comp.get("DTEND").dt)
            elif comp.get("DURATION") is not None:
                ends_at = starts_at + comp.get("DURATION").dt
            else:
                ends_at = starts_at + (timedelta(days=1) if all_day else timedelta(hours=1))
            uid = str(comp.get("UID", "")) or href
            key = f"{uid}|{starts_at.isoformat()}"
            if key in seen:
                continue
            seen.add(key)
            title = str(comp.get("SUMMARY", "") or "Sin título")[:300]
            values = {
                "starts_at": starts_at, "ends_at": ends_at, "all_day": all_day,
                "location": str(comp.get("LOCATION", "") or "") or None,
                "description": (str(comp.get("DESCRIPTION", "") or "") or None),
            }
            entities = {"href": href, "etag": etag, "uid": uid}
            if recurring:
                entities["recurring_event_id"] = uid
            event = existing.get(key)
            if event is None:
                item = Item(kind="event", title=title, status="ready", tags=[], entities=entities)
                event = Event(calendar_id=cal.id, external_key=key)
                item.event = event
                db.add(item)
            else:
                item = event.item
                if item.title == title and item.entities == entities and all(getattr(event, k) == v for k, v in values.items()):
                    continue
            item.title, item.entities = title, entities
            for k, v in values.items():
                setattr(event, k, v)
            db.flush()
            schedule_index(db, item.id)

    for key, event in existing.items():
        if key not in seen:
            db.delete(event.item)
    cal.last_synced_at = now
    cal.sync_error = None
    return len(seen)


def sync(db: Session) -> None:
    row, apple_id, password = _creds(db)
    with _http(apple_id, password) as http:
        found = discover(http)
        existing = {c.external_id: c for c in db.scalars(select(Calendar).where(Calendar.source == "icloud"))}
        for info in found:
            cal = existing.pop(info["url"], None)
            if cal is None:
                cal = Calendar(source="icloud", external_id=info["url"], name=info["name"],
                               color=_nearest_color(info["color"]), enabled=True)
                db.add(cal)
            cal.writable = info["writable"]
            db.flush()
        for cal in existing.values():
            for item_id in db.scalars(select(Event.item_id).where(Event.calendar_id == cal.id)).all():
                db.delete(db.get(Item, item_id))
            db.delete(cal)
        for cal in db.scalars(select(Calendar).where(Calendar.source == "icloud", Calendar.enabled.is_(True))):
            try:
                sync_events(db, http, cal)
            except ICloudAuth:
                raise
            except (ICloudError, ET.ParseError) as exc:
                cal.sync_error = str(exc)[:300]
                cal.last_synced_at = datetime.now(UTC)
    row.status, row.error = "ok", None


@handler("sync_icloud")
def _sync_icloud(db: Session, payload: dict) -> None:
    row = db.get(Integration, "icloud")
    if row is None or not row.secret_encrypted:
        return
    state = dict(row.state or {})
    try:
        sync(db)
        state.pop("error", None)
    except (ICloudError, httpx.HTTPError) as exc:
        db.rollback()
        row = db.get(Integration, "icloud")
        row.error = str(exc)[:300]
        if isinstance(exc, ICloudAuth):
            row.status = "reconnect"
        log.warning("iCloud: %s", exc)
    state["synced_at"] = datetime.now(UTC).isoformat()
    row.state = state


def schedule_icloud_sync(db: Session, now: datetime) -> None:
    row = db.get(Integration, "icloud")
    if row is None or not row.secret_encrypted or row.status == "reconnect":
        return
    last = (row.state or {}).get("synced_at")
    every = timedelta(minutes=get_settings().icloud_sync_minutes) - timedelta(seconds=5)
    if last is None or now - datetime.fromisoformat(last) >= every:
        enqueue(db, "sync_icloud", {}, dedupe=True, max_attempts=1)


# --- Escritura ---------------------------------------------------------------------------

def _ics(item: Item, event: Event, uid: str) -> bytes:
    tz = get_settings().tz
    cal = icalendar.Calendar()
    cal.add("prodid", "-//Segundo Cerebro//ES")
    cal.add("version", "2.0")
    ve = icalendar.Event()
    ve.add("uid", uid)
    ve.add("summary", item.title)
    ve.add("dtstamp", datetime.now(UTC))
    if event.all_day:
        ve.add("dtstart", event.starts_at.astimezone(tz).date())
        ve.add("dtend", event.ends_at.astimezone(tz).date())
    else:
        ve.add("dtstart", event.starts_at.astimezone(UTC))
        ve.add("dtend", event.ends_at.astimezone(UTC))
    if event.location:
        ve.add("location", event.location)
    if event.description:
        ve.add("description", event.description)
    if event.rrule:
        ve.add("rrule", icalendar.vRecur.from_ical(event.rrule))
    if event.remind_minutes is not None:
        alarm = icalendar.Alarm()
        alarm.add("action", "DISPLAY")
        alarm.add("description", item.title)
        alarm.add("trigger", timedelta(minutes=-event.remind_minutes))
        ve.add_component(alarm)
    cal.add_component(ve)
    return cal.to_ical()


def push_event(db: Session, item: Item) -> None:
    """Crea o actualiza el evento en iCloud antes de confirmar el cambio local."""
    event = item.event
    cal = event.calendar or db.get(Calendar, event.calendar_id)
    ents = dict(item.entities or {})
    if not cal.writable:
        raise ICloudError("Ese calendario de iCloud es de solo lectura")
    if ents.get("recurring_event_id"):
        raise ICloudError("Los eventos que se repiten se editan en el iPhone")
    _, apple_id, password = _creds(db)
    uid = ents.get("uid") or f"{item.id}@segundo-cerebro"
    href = ents.get("href") or urljoin(cal.external_id, f"{uuid.uuid5(uuid.NAMESPACE_URL, uid)}.ics")
    headers = {"Content-Type": "text/calendar; charset=utf-8"}
    if ents.get("href"):
        if ents.get("etag"):
            headers["If-Match"] = ents["etag"]
    else:
        headers["If-None-Match"] = "*"
    with _http(apple_id, password) as http:
        r = _check(http.put(href, content=_ics(item, event, uid), headers=headers), ok=(200, 201, 204))
    item.entities = {**ents, "uid": uid, "href": href, "etag": r.headers.get("etag", "")}
    event.external_key = f"{uid}|{event.starts_at.astimezone(UTC).isoformat()}"
    if event.rrule:
        enqueue(db, "sync_icloud", {}, dedupe=True, max_attempts=1)


def delete_remote_event(db: Session, item: Item) -> None:
    ents = item.entities or {}
    if ents.get("recurring_event_id"):
        raise ICloudError("Los eventos que se repiten se borran en el iPhone")
    if not item.event.calendar.writable:
        raise ICloudError("Ese calendario de iCloud es de solo lectura")
    if not ents.get("href"):
        return
    _, apple_id, password = _creds(db)
    with _http(apple_id, password) as http:
        _check(http.delete(ents["href"]), ok=(200, 204, 404, 410))
