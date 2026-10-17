import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Notification, PushSubscription
from app.schemas import NotificationOut, PushSubscriptionIn
from app.security import audit, require_user
from app.services.notify import notify, vapid_keys

router = APIRouter(prefix="/api", tags=["notifications"], dependencies=[Depends(require_user)])


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).order_by(Notification.created_at.desc()).limit(60))
    return [NotificationOut.model_validate(n, from_attributes=True) for n in rows]


@router.get("/notifications/unread")
def unread(db: Session = Depends(get_db)):
    return {"count": db.scalar(select(func.count()).select_from(Notification).where(Notification.read_at.is_(None)))}


@router.post("/notifications/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    db.commit()


@router.get("/push/key")
def push_key(db: Session = Depends(get_db)):
    return {"key": vapid_keys(db).vapid_public_key}


@router.post("/push/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(body: PushSubscriptionIn, request: Request, db: Session = Depends(get_db)):
    values = {"endpoint": body.endpoint, "p256dh": body.keys.get("p256dh", ""), "auth": body.keys.get("auth", ""),
              "user_agent": (request.headers.get("user-agent") or "")[:300]}
    db.execute(
        insert(PushSubscription).values(**values)
        .on_conflict_do_update(index_elements=["endpoint"], set_={k: values[k] for k in ("p256dh", "auth", "user_agent")})
    )
    db.commit()
    audit(db, "push_subscribed", request)


@router.post("/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(body: PushSubscriptionIn, db: Session = Depends(get_db)):
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    db.commit()


@router.post("/push/test")
def test_push(db: Session = Depends(get_db)):
    notify(db, kind="system", title="Las notificaciones funcionan",
           body="Así te avisaré de tus eventos, tareas y recordatorios.", url="/ajustes",
           key=f"test:{uuid.uuid4()}")
    return {"subscriptions": db.scalar(select(func.count()).select_from(PushSubscription))}
