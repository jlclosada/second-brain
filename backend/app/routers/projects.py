import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Item, Project, Reminder, Task
from app.schemas import ProjectIn, ProjectOut, ProjectUpdate, ReminderIn, ReminderOut, ReminderUpdate
from app.security import require_user
from app.services import brain

router = APIRouter(prefix="/api", tags=["projects"], dependencies=[Depends(require_user)])


def _with_counts(db: Session, projects: list[Project]) -> list[ProjectOut]:
    ids = [p.id for p in projects]
    counts: dict[tuple[uuid.UUID, str], int] = {}
    if ids:
        rows = db.execute(
            select(Item.project_id, Item.kind, func.count())
            .outerjoin(Task, Task.item_id == Item.id)
            .where(Item.project_id.in_(ids), (Item.kind != "task") | and_(Item.kind == "task", Task.done_at.is_(None)))
            .group_by(Item.project_id, Item.kind)
        )
        counts = {(pid, kind): n for pid, kind, n in rows}
    return [
        ProjectOut(
            **ProjectOut.model_validate(p).model_dump(exclude={"open_tasks", "notes", "documents"}),
            open_tasks=counts.get((p.id, "task"), 0), notes=counts.get((p.id, "note"), 0),
            documents=counts.get((p.id, "document"), 0),
        )
        for p in projects
    ]


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(archived: bool = False, db: Session = Depends(get_db)):
    query = select(Project).where(Project.archived_at.is_not(None) if archived else Project.archived_at.is_(None))
    return _with_counts(db, list(db.scalars(query.order_by(Project.kind.desc(), Project.name))))


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    project = Project(**body.model_dump())
    db.add(project)
    db.commit()
    return _with_counts(db, [project])[0]


def _project(db: Session, project_id: uuid.UUID) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")
    return project


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return _with_counts(db, [_project(db, project_id)])[0]


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: uuid.UUID, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = _project(db, project_id)
    changes = body.model_dump(exclude_unset=True)
    if "archived" in changes:
        project.archived_at = datetime.now(UTC) if changes.pop("archived") else None
    for key, value in changes.items():
        setattr(project, key, value)
    db.commit()
    return _with_counts(db, [project])[0]


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
    # Las tareas, notas y documentos se quedan, sin proyecto.
    db.delete(_project(db, project_id))
    db.commit()


# --- Recordatorios ----------------------------------------------------------

@router.get("/reminders", response_model=list[ReminderOut])
def list_reminders(include_past: bool = False, db: Session = Depends(get_db)):
    query = select(Reminder).where(Reminder.dismissed_at.is_(None))
    if not include_past:
        query = query.where(Reminder.sent_at.is_(None))
    return [brain.reminder_out(r) for r in db.scalars(query.order_by(Reminder.remind_at).limit(200))]


@router.post("/reminders", response_model=ReminderOut, status_code=status.HTTP_201_CREATED)
def create_reminder(body: ReminderIn, db: Session = Depends(get_db)):
    return brain.reminder_out(brain.create_reminder(db, body))


@router.patch("/reminders/{reminder_id}", response_model=ReminderOut)
def update_reminder(reminder_id: uuid.UUID, body: ReminderUpdate, db: Session = Depends(get_db)):
    r = db.get(Reminder, reminder_id)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recordatorio no encontrado")
    changes = body.model_dump(exclude_unset=True)
    if "title" in changes:
        r.title = changes["title"]
    if changes.get("remind_at"):
        r.remind_at = changes["remind_at"]
        r.sent_at = None
    if "dismissed" in changes:
        r.dismissed_at = datetime.now(UTC) if changes["dismissed"] else None
    db.commit()
    return brain.reminder_out(r)


@router.delete("/reminders/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reminder(reminder_id: uuid.UUID, db: Session = Depends(get_db)):
    r = db.get(Reminder, reminder_id)
    if r is not None:
        db.delete(r)
        db.commit()
