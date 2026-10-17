"""Tareas periódicas del worker: avisos, resumen del día, sincronizar calendarios
y limpieza. Solo un worker a la vez ejecuta el planificador (advisory lock)."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Calendar, Item, LoginAttempt, Reminder, Task
from app.security import get_account
from app.services import jobs
from app.services.calendar import events_between, local_day_bounds, schedule_sync
from app.services.notify import notify

log = logging.getLogger(__name__)

SCHEDULER_LOCK = 727275
# Un aviso que llega con más retraso que esto ya no se envía (p. ej. el PC estaba apagado).
LATE_LIMIT = timedelta(minutes=30)
DEFAULT_PREFS = {"default_event_reminder": 15, "briefing_hour": 8, "expiry_warning_days": [30, 7, 1, 0]}


def prefs(db: Session) -> dict:
    return {**DEFAULT_PREFS, **(get_account(db).prefs or {})}


def _fmt_time(dt: datetime) -> str:
    return dt.astimezone(get_settings().tz).strftime("%H:%M")


def due_reminders(db: Session, now: datetime) -> None:
    for r in db.scalars(
        select(Reminder).where(Reminder.remind_at <= now, Reminder.sent_at.is_(None), Reminder.dismissed_at.is_(None))
    ):
        if now - r.remind_at <= LATE_LIMIT:
            url = f"/i/{r.item_id}" if r.item_id else "/hoy"
            notify(db, kind="reminder", title=r.title, body="Recordatorio", url=url, key=f"reminder:{r.id}")
        r.sent_at = now
    db.commit()


def event_alerts(db: Session, now: datetime, default_minutes: int) -> None:
    for occ in events_between(db, now, now + timedelta(days=15)):
        if occ.event.all_day:
            continue
        minutes = occ.event.remind_minutes
        if minutes is None and occ.calendar.source == "ics":
            minutes = default_minutes
        if minutes is None:
            continue
        alert_at = occ.starts_at - timedelta(minutes=minutes)
        if alert_at <= now and now - alert_at <= LATE_LIMIT:
            when = "Ahora" if minutes == 0 else f"A las {_fmt_time(occ.starts_at)}"
            body = f"{when}{f', en {occ.event.location}' if occ.event.location else ''}"
            notify(db, kind="event", title=occ.item.title, body=body, url=f"/calendario?evento={occ.item.id}",
                   key=f"event:{occ.item.id}:{occ.starts_at.isoformat()}:{minutes}")


def task_alerts(db: Session, now: datetime) -> None:
    tz = get_settings().tz
    today = now.astimezone(tz).date()
    rows = db.execute(
        select(Task, Item).join(Item, Item.id == Task.item_id).where(
            Task.done_at.is_(None), Task.remind.is_(True), Task.due_date == today, Task.due_time.is_not(None)
        )
    ).all()
    for task, item in rows:
        due = datetime.combine(today, task.due_time, tzinfo=tz)
        if due <= now and now - due <= LATE_LIMIT:
            notify(db, kind="task", title=item.title, body=f"Tarea para las {task.due_time.strftime('%H:%M')}",
                   url="/tareas", key=f"task:{item.id}:{today.isoformat()}")


def morning(db: Session, now: datetime, p: dict) -> None:
    """Resumen del día y vencimientos, a la hora elegida."""
    tz = get_settings().tz
    local = now.astimezone(tz)
    if local.hour < p["briefing_hour"]:
        return
    today = local.date()

    start, end = local_day_bounds(today)
    events = events_between(db, start, end)
    tasks = db.scalar(
        select(func.count()).select_from(Task).where(Task.done_at.is_(None), Task.due_date <= today)
    ) or 0
    if events or tasks:
        parts = []
        if events:
            first = next((o for o in events if not o.event.all_day), None)
            parts.append(f"{len(events)} {'evento' if len(events) == 1 else 'eventos'}"
                         + (f", el primero a las {_fmt_time(first.starts_at)}" if first else ""))
        if tasks:
            parts.append(f"{tasks} {'tarea pendiente' if tasks == 1 else 'tareas pendientes'}")
        notify(db, kind="briefing", title="Tu día", body=". ".join(parts) + ".", url="/hoy",
               key=f"briefing:{today.isoformat()}")

    for days in p["expiry_warning_days"]:
        target = today + timedelta(days=days)
        for item in db.scalars(select(Item).where(Item.kind == "document", Item.expires_on == target)):
            when = "hoy" if days == 0 else "mañana" if days == 1 else f"en {days} días"
            notify(db, kind="expiry", title=f"Vence {when}: {item.title}",
                   body=f"Fecha de vencimiento: {target.strftime('%d/%m/%Y')}", url=f"/documentos/{item.id}",
                   key=f"expiry:{item.id}:{target.isoformat()}")


def calendar_sync(db: Session, now: datetime) -> None:
    every = timedelta(minutes=get_settings().calendar_sync_minutes)
    for cal in db.scalars(select(Calendar).where(Calendar.source == "ics", Calendar.enabled.is_(True))):
        if cal.last_synced_at is None or now - cal.last_synced_at >= every:
            schedule_sync(db, cal)
    db.commit()


def housekeeping(db: Session, now: datetime) -> None:
    jobs.requeue_stale(db)
    jobs.purge_finished(db)
    db.execute(delete(LoginAttempt).where(LoginAttempt.at < now - timedelta(days=30)))
    db.commit()


def tick(db: Session, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    p = prefs(db)
    for step in (
        lambda: due_reminders(db, now),
        lambda: event_alerts(db, now, p["default_event_reminder"]),
        lambda: task_alerts(db, now),
        lambda: morning(db, now, p),
        lambda: calendar_sync(db, now),
    ):
        try:
            step()
        except Exception:
            db.rollback()
            log.exception("Fallo en el planificador")
    if now.minute == 0:
        housekeeping(db, now)
