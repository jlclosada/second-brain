import hmac
import secrets
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Calendar, Event, Item
from app.schemas import CalendarIn, CalendarOut, CalendarUpdate, EventIn, EventOut, EventUpdate, FeedOut
from app.security import audit, encrypt, get_account, require_user
from app.services import brain
from app.services.calendar import build_feed, default_calendar, events_between, local_day_bounds, schedule_sync

router = APIRouter(prefix="/api", tags=["calendar"], dependencies=[Depends(require_user)])
# El feed iCal se protege con su propio token secreto (los calendarios del móvil no envían cookies).
feed_router = APIRouter(prefix="/api", tags=["calendar"])

MAX_RANGE = timedelta(days=120)


def _calendar_out(db: Session, cal: Calendar) -> CalendarOut:
    count = db.scalar(select(func.count()).select_from(Event).where(Event.calendar_id == cal.id)) or 0
    return CalendarOut(**CalendarOut.model_validate(cal).model_dump(exclude={"events"}), events=count)


@router.get("/calendars", response_model=list[CalendarOut])
def list_calendars(db: Session = Depends(get_db)):
    default_calendar(db)
    db.commit()
    return [_calendar_out(db, c) for c in db.scalars(select(Calendar).order_by(Calendar.created_at))]


@router.post("/calendars", response_model=CalendarOut, status_code=status.HTTP_201_CREATED)
def add_calendar(body: CalendarIn, request: Request, db: Session = Depends(get_db)):
    cal = Calendar(name=body.name, color=body.color, source="ics" if body.url else "local",
                   url_encrypted=encrypt(body.url) if body.url else None)
    db.add(cal)
    db.flush()
    if body.url:
        schedule_sync(db, cal)
        audit(db, "calendar_added", request, name=body.name)
    db.commit()
    return _calendar_out(db, cal)


@router.patch("/calendars/{cal_id}", response_model=CalendarOut)
def update_calendar(cal_id: uuid.UUID, body: CalendarUpdate, db: Session = Depends(get_db)):
    cal = db.get(Calendar, cal_id)
    if cal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendario no encontrado")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(cal, key, value)
    db.commit()
    return _calendar_out(db, cal)


@router.post("/calendars/{cal_id}/sync", response_model=CalendarOut)
def sync_now(cal_id: uuid.UUID, db: Session = Depends(get_db)):
    cal = db.get(Calendar, cal_id)
    if cal is None or cal.source != "ics":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendario sincronizado no encontrado")
    schedule_sync(db, cal)
    db.commit()
    return _calendar_out(db, cal)


@router.delete("/calendars/{cal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calendar(cal_id: uuid.UUID, db: Session = Depends(get_db)):
    cal = db.get(Calendar, cal_id)
    if cal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendario no encontrado")
    if cal.source == "local" and db.scalar(select(func.count()).select_from(Calendar).where(Calendar.source == "local")) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Necesitas al menos un calendario propio")
    # Los elementos de sus eventos se borran con ellos.
    item_ids = db.scalars(select(Event.item_id).where(Event.calendar_id == cal_id)).all()
    for item_id in item_ids:
        db.delete(db.get(Item, item_id))
    db.delete(cal)
    db.commit()


@router.get("/events", response_model=list[EventOut])
def list_events(start: date = Query(...), end: date = Query(...), db: Session = Depends(get_db)):
    """Eventos entre dos días locales (ambos incluidos), con las repeticiones ya expandidas."""
    if end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "El fin es anterior al inicio")
    lo, _ = local_day_bounds(start)
    _, hi = local_day_bounds(end)
    if hi - lo > MAX_RANGE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pide como mucho 120 días")
    return [brain.event_out(o) for o in events_between(db, lo, hi)]


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(body: EventIn, db: Session = Depends(get_db)):
    return brain.event_item_out(brain.create_event(db, body))


@router.get("/events/{item_id}", response_model=EventOut)
def get_event(item_id: uuid.UUID, db: Session = Depends(get_db)):
    return brain.event_item_out(brain.get_item(db, item_id, "event"))


@router.patch("/events/{item_id}", response_model=EventOut)
def update_event(item_id: uuid.UUID, body: EventUpdate, db: Session = Depends(get_db)):
    item = brain.get_item(db, item_id, "event")
    return brain.event_item_out(brain.update_event(db, item, body.model_dump(exclude_unset=True)))


@router.delete("/events/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(item_id: uuid.UUID, db: Session = Depends(get_db)):
    item = brain.get_item(db, item_id, "event")
    if item.event.calendar.source != "local":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Bórralo en el calendario original")
    db.delete(item)
    db.commit()


@router.get("/calendar/feed", response_model=FeedOut)
def feed_url(db: Session = Depends(get_db)):
    return FeedOut(url_path=f"/api/calendar/feed/{get_account(db).feed_token}.ics")


@router.post("/calendar/feed/rotate", response_model=FeedOut)
def rotate_feed(request: Request, db: Session = Depends(get_db)):
    account = get_account(db)
    account.feed_token = secrets.token_urlsafe(32)
    db.commit()
    audit(db, "feed_rotated", request)
    return FeedOut(url_path=f"/api/calendar/feed/{account.feed_token}.ics")


@feed_router.get("/calendar/feed/{token}.ics", include_in_schema=False)
def feed(token: str, db: Session = Depends(get_db)):
    if not hmac.compare_digest(token.encode(), get_account(db).feed_token.encode()):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(build_feed(db), media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=300"})
