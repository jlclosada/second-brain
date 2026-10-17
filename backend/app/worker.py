"""Proceso en segundo plano que procesa los documentos subidos.

    python -m app.worker
"""

import logging
import time

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.services.pipeline import reset_stuck, run_once

log = logging.getLogger("worker")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    init_db()
    with SessionLocal() as session:
        reset_stuck(session)
    log.info("Worker listo (IA: %s)", "Claude" if settings.anthropic_api_key else "reglas")
    while True:
        with SessionLocal() as session:
            worked = run_once(session)
        if not worked:
            time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
