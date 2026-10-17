from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.models import Item, Note, Reminder, Task
from app.schemas import CaptureIn, CaptureOut, ExpiringDoc, TodayOut
from app.security import require_user
from app.services import brain
from app.services.calendar import events_between, local_day_bounds
from app.services.capture import capture

router = APIRouter(prefix="/api", tags=["today"], dependencies=[Depends(require_user)])


@router.get("/today", response_model=TodayOut)
def today(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    now = datetime.now(settings.tz)
    day = now.date()
    start, end = local_day_bounds(day)

    tasks = db.scalars(
        select(Item).join(Task, Task.item_id == Item.id)
        .where(Task.done_at.is_(None), Task.due_date <= day)
        .order_by(Task.due_date, Task.due_time.asc().nulls_last(), Task.priority.desc(), Task.sort)
    ).all()
    overdue = [brain.task_out(i) for i in tasks if i.task.due_date < day]
    due_today = [brain.task_out(i) for i in tasks if i.task.due_date == day]

    reminders = db.scalars(
        select(Reminder).where(Reminder.dismissed_at.is_(None), Reminder.remind_at < end,
                               Reminder.remind_at >= start - timedelta(days=1))
        .order_by(Reminder.remind_at)
    ).all()

    expiring = [
        ExpiringDoc(id=i.id, title=i.title, category=i.category, expires_on=i.expires_on,
                    days_left=(i.expires_on - day).days)
        for i in db.scalars(
            select(Item).where(Item.kind == "document", Item.expires_on.between(day, day + timedelta(days=45)))
            .order_by(Item.expires_on).limit(8)
        )
    ]

    journal = brain.journal_for(db, day, create=False)
    pinned = db.scalars(
        select(Item).join(Note).where(Item.pinned.is_(True), Note.journal_date.is_(None))
        .order_by(Item.updated_at.desc()).limit(6)
    ).all()
    recent = db.scalars(
        select(Item).where(Item.status == "ready", Item.updated_at > datetime.now(UTC) - timedelta(days=7))
        .order_by(Item.updated_at.desc()).limit(8)
    ).all()

    counts = dict(db.execute(select(Item.kind, func.count()).group_by(Item.kind)).all())
    counts["open_tasks"] = db.scalar(select(func.count()).select_from(Task).where(Task.done_at.is_(None))) or 0
    counts["done_today"] = db.scalar(
        select(func.count()).select_from(Task).where(Task.done_at >= start, Task.done_at < end)
    ) or 0

    return TodayOut(
        date=day, timezone=settings.timezone,
        events=[brain.event_out(o) for o in events_between(db, start, end)],
        overdue=overdue, due_today=due_today, reminders=[brain.reminder_out(r) for r in reminders],
        expiring=expiring, journal=brain.note_out(journal) if journal else None,
        pinned_notes=[brain.note_out(i) for i in pinned], recent=[brain.link_ref(i) for i in recent],
        counts=counts,
    )


@router.post("/capture", response_model=CaptureOut)
def capture_endpoint(body: CaptureIn, db: Session = Depends(get_db)):
    return capture(db, body.text, commit=body.commit)
