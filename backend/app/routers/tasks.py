import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Item, Task
from app.schemas import TaskIn, TaskOut, TaskUpdate
from app.security import require_user
from app.services import brain

router = APIRouter(prefix="/api", tags=["tasks"], dependencies=[Depends(require_user)])

View = Literal["today", "upcoming", "inbox", "open", "done", "all"]


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(view: View = "open", project_id: uuid.UUID | None = None, tag: str | None = None,
               db: Session = Depends(get_db)):
    today = datetime.now(get_settings().tz).date()
    query = select(Item).join(Task, Task.item_id == Item.id).where(Item.kind == "task")
    if view == "done":
        query = query.where(Task.done_at.is_not(None), Task.done_at > datetime.now(UTC) - timedelta(days=30))
    elif view != "all":
        query = query.where(Task.done_at.is_(None))
    if view == "today":
        query = query.where(Task.due_date <= today)
    elif view == "upcoming":
        query = query.where(Task.due_date > today)
    elif view == "inbox":
        query = query.where(Task.due_date.is_(None), Item.project_id.is_(None))
    if project_id:
        query = query.where(Item.project_id == project_id)
    if tag:
        query = query.where(Item.tags.any(tag.lower()))
    if view == "done":
        query = query.order_by(Task.done_at.desc())
    else:
        query = query.order_by(Task.due_date.asc().nulls_last(), Task.due_time.asc().nulls_last(),
                               Task.priority.desc(), Task.sort)
    return [brain.task_out(i) for i in db.scalars(query.limit(500))]


@router.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskIn, db: Session = Depends(get_db)):
    return brain.task_out(brain.create_task(db, body))


@router.patch("/tasks/{item_id}", response_model=TaskOut)
def update_task(item_id: uuid.UUID, body: TaskUpdate, db: Session = Depends(get_db)):
    item = brain.get_item(db, item_id, "task")
    return brain.task_out(brain.update_task(db, item, body.model_dump(exclude_unset=True)))


@router.delete("/tasks/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(item_id: uuid.UUID, db: Session = Depends(get_db)):
    db.delete(brain.get_item(db, item_id, "task"))
    db.commit()
