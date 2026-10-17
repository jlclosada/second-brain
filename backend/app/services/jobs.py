"""Cola de trabajos sobre Postgres.

Cada trabajo se reclama con FOR UPDATE SKIP LOCKED, así que se pueden
arrancar tantos workers como haga falta sin que dos hagan lo mismo.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Job

log = logging.getLogger(__name__)

Handler = Callable[[Session, dict], None]
_HANDLERS: dict[str, Handler] = {}
# Un trabajo "running" más antiguo que esto se considera abandonado (worker caído).
STALE_AFTER = timedelta(minutes=15)


def handler(kind: str) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        _HANDLERS[kind] = fn
        return fn

    return register


_FAILURE_HOOKS: dict[str, Callable[[Session, dict, Exception], None]] = {}


def on_failure(kind: str):
    """Se llama cuando un trabajo agota sus reintentos."""
    def register(fn):
        _FAILURE_HOOKS[kind] = fn
        return fn

    return register


def enqueue(db: Session, kind: str, payload: dict | None = None, *, run_at: datetime | None = None,
            max_attempts: int = 3, dedupe: bool = False) -> None:
    """Añade un trabajo. Con dedupe=True no se duplica si ya hay uno igual en cola."""
    payload = payload or {}
    if dedupe and db.scalar(
        select(Job.id).where(Job.kind == kind, Job.status == "queued", Job.payload == payload).limit(1)
    ):
        return
    db.add(Job(kind=kind, payload=payload, run_at=run_at or datetime.now(UTC), max_attempts=max_attempts))


def claim(db: Session) -> Job | None:
    job = db.scalars(
        select(Job)
        .where(Job.status == "queued", Job.run_at <= datetime.now(UTC))
        .order_by(Job.run_at, Job.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).first()
    if job:
        job.status = "running"
        job.locked_at = datetime.now(UTC)
        job.attempts += 1
        db.commit()
    return job


def run_once(db: Session) -> bool:
    """Ejecuta un trabajo pendiente. Devuelve False si la cola estaba vacía."""
    job = claim(db)
    if job is None:
        return False
    fn = _HANDLERS.get(job.kind)
    try:
        if fn is None:
            raise RuntimeError(f"Tipo de trabajo desconocido: {job.kind}")
        fn(db, job.payload)
        db.commit()
        db.execute(update(Job).where(Job.id == job.id).values(status="done", finished_at=datetime.now(UTC)))
        db.commit()
    except Exception as exc:
        db.rollback()
        log.exception("Error en el trabajo %s (%s)", job.id, job.kind)
        retry = job.attempts < job.max_attempts
        db.execute(
            update(Job)
            .where(Job.id == job.id)
            .values(
                status="queued" if retry else "failed",
                # Reintento con espera creciente: 1, 4, 9… minutos.
                run_at=datetime.now(UTC) + timedelta(minutes=job.attempts**2),
                last_error=str(exc)[:2000],
                finished_at=None if retry else datetime.now(UTC),
            )
        )
        db.commit()
        failed = _FAILURE_HOOKS.get(job.kind)
        if failed and not retry:
            failed(db, job.payload, exc)
            db.commit()
    return True


def requeue_stale(db: Session) -> None:
    db.execute(
        update(Job)
        .where(Job.status == "running", Job.locked_at < datetime.now(UTC) - STALE_AFTER)
        .values(status="queued")
    )
    db.commit()


def purge_finished(db: Session, older_than: timedelta = timedelta(days=7)) -> None:
    from sqlalchemy import delete

    db.execute(delete(Job).where(Job.status == "done", Job.finished_at < datetime.now(UTC) - older_than))
    db.commit()
