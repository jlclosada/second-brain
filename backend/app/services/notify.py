"""Avisos: se guardan en la app y se envían como notificación push (Web Push)."""

import base64
import json
import logging
from datetime import UTC, datetime

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Account, Notification, PushSubscription
from app.security import get_account

log = logging.getLogger(__name__)


def vapid_keys(db: Session) -> Account:
    """Claves VAPID propias, generadas la primera vez que hacen falta."""
    account = get_account(db)
    if not account.vapid_private_pem:
        key = ec.generate_private_key(ec.SECP256R1())
        account.vapid_private_pem = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode()
        public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        account.vapid_public_key = base64.urlsafe_b64encode(public).rstrip(b"=").decode()
        db.commit()
    return account


def notify(db: Session, *, kind: str, title: str, body: str | None, url: str | None, key: str) -> bool:
    """Crea el aviso si no existía (por `key`) y lo envía. Devuelve True si es nuevo."""
    inserted = db.execute(
        insert(Notification)
        .values(kind=kind, title=title, body=body, url=url, dedupe_key=key)
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
        .returning(Notification.id)
    ).scalar()
    db.commit()
    if inserted is None:
        return False
    notification = db.get(Notification, inserted)
    send_push(db, notification)
    return True


def send_push(db: Session, notification: Notification) -> int:
    subs = db.scalars(select(PushSubscription)).all()
    if not subs:
        return 0
    account = vapid_keys(db)
    vapid = Vapid.from_pem(account.vapid_private_pem.encode())
    payload = json.dumps({
        "title": notification.title,
        "body": notification.body or "",
        "url": notification.url or "/",
        "tag": notification.dedupe_key[:60],
    })
    sent = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload,
                vapid_private_key=vapid,
                vapid_claims={"sub": get_settings().vapid_contact},
                timeout=10,
            )
            sub.last_error = None
            sent += 1
        except WebPushException as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in (404, 410):
                # El navegador dio de baja la suscripción.
                db.execute(delete(PushSubscription).where(PushSubscription.id == sub.id))
            else:
                sub.last_error = str(exc)[:500]
                log.warning("Push fallido: %s", exc)
        except Exception as exc:  # red caída, etc.: el aviso sigue en la app
            sub.last_error = str(exc)[:500]
            log.warning("Push fallido: %s", exc)
    notification.pushed_at = datetime.now(UTC) if sent else None
    db.commit()
    return sent
