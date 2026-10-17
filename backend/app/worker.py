"""Proceso en segundo plano: consume la cola de trabajos y, una vez por minuto,
ejecuta el planificador (avisos, resumen del día, sincronizar calendarios).

    python -m app.worker

Se pueden arrancar varios: la cola reparte el trabajo y solo uno planifica.
"""

import logging
import signal
import time
from datetime import UTC, datetime

from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal, engine
from app.services import calendar, indexing, jobs, pipeline, scheduler  # noqa: F401  registran sus trabajos

log = logging.getLogger("worker")
_running = True


def _stop(*_):
    global _running
    _running = False


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    with SessionLocal() as session:
        jobs.requeue_stale(session)
    log.info("Worker listo (IA: %s)", "Claude" if settings.anthropic_api_key else "reglas")

    # Conexión dedicada para el lock del planificador: se mantiene mientras el worker viva.
    lock_conn = engine.connect()
    is_scheduler = False
    last_tick = None
    while _running:
        minute = datetime.now(UTC).replace(second=0, microsecond=0)
        if last_tick != minute:
            last_tick = minute
            if not is_scheduler:
                is_scheduler = bool(lock_conn.execute(
                    text("SELECT pg_try_advisory_lock(:k)"), {"k": scheduler.SCHEDULER_LOCK}
                ).scalar())
                lock_conn.commit()
            if is_scheduler:
                with SessionLocal() as session:
                    scheduler.tick(session, minute)

        with SessionLocal() as session:
            worked = jobs.run_once(session)
        if not worked:
            time.sleep(settings.worker_poll_seconds)
    lock_conn.close()
    log.info("Worker detenido")


if __name__ == "__main__":
    main()
