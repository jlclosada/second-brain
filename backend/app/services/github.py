"""GitHub: los issues que tienes asignados y los PR en los que te piden revisión
aparecen como tareas. Cuando se cierran (o dejan de ser tuyos) la tarea se marca
como hecha sola."""

import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Integration, Item, Task
from app.security import decrypt, encrypt
from app.services.indexing import schedule_index
from app.services.jobs import enqueue, handler

log = logging.getLogger(__name__)

API = "https://api.github.com"
QUERIES = {
    "review": "is:open is:pr archived:false review-requested:@me",
    "assigned": "is:open archived:false assignee:@me",
}
# En los tests se sustituye por un httpx.MockTransport.
transport: httpx.BaseTransport | None = None


class GitHubError(Exception):
    pass


def _http(token: str) -> httpx.Client:
    return httpx.Client(base_url=API, timeout=30, transport=transport, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "SegundoCerebro/1.0",
    })


def _message(r: httpx.Response) -> str:
    try:
        return r.json().get("message") or f"HTTP {r.status_code}"
    except ValueError:
        return f"HTTP {r.status_code}"


def connect(db: Session, token: str) -> Integration:
    token = token.strip()
    with _http(token) as http:
        r = http.get("/user")
    if r.status_code == 401:
        raise GitHubError("GitHub no acepta ese token")
    if r.status_code != 200:
        raise GitHubError(f"No se pudo comprobar el token: {_message(r)}")
    row = db.get(Integration, "github")
    if row is None:
        row = Integration(provider="github", state={})
        db.add(row)
    row.secret_encrypted = encrypt(json.dumps({"token": token}))
    row.account = r.json().get("login")
    row.status, row.error = "ok", None
    row.connected_at = datetime.now(UTC)
    db.flush()
    enqueue(db, "sync_github", {}, dedupe=True, max_attempts=1)
    return row


def disconnect(db: Session) -> None:
    row = db.get(Integration, "github")
    if row is not None:
        db.delete(row)
    # Las tareas abiertas que venían de GitHub se van; las hechas se quedan en el historial.
    for item in db.scalars(
        select(Item).join(Task, Task.item_id == Item.id).where(Task.source == "github", Task.done_at.is_(None))
    ):
        db.delete(item)


def _repo(issue: dict) -> str:
    return issue.get("repository_url", "").removeprefix(f"{API}/repos/")


def sync(db: Session, row: Integration) -> int:
    token = json.loads(decrypt(row.secret_encrypted) or "{}").get("token")
    if not token:
        raise GitHubError("Falta el token de GitHub")
    found: dict[str, tuple[str, dict]] = {}
    with _http(token) as http:
        for kind, q in QUERIES.items():
            r = http.get("/search/issues", params={"q": q, "per_page": 50, "sort": "updated"})
            if r.status_code == 401:
                row.status = "reconnect"
                raise GitHubError("El token de GitHub ya no vale")
            if r.status_code != 200:
                raise GitHubError(_message(r))
            for issue in r.json().get("items", []):
                # Si te piden revisión y además está asignado, manda la revisión.
                found.setdefault(issue["html_url"], (kind, issue))

    existing = {
        t.external_id: t
        for t in db.scalars(select(Task).where(Task.source == "github"))
    }
    now = datetime.now(UTC)
    for url, (kind, issue) in found.items():
        repo = _repo(issue)
        is_pr = "pull_request" in issue
        title = (f"Revisar: {issue['title']}" if kind == "review" else issue["title"])[:300]
        notes = f"{repo}#{issue['number']} · {'PR' if is_pr else 'Issue'}"
        tags = ["github", "revision" if kind == "review" else ("pr" if is_pr else "issue")]
        task = existing.get(url)
        if task is None:
            item = Item(kind="task", title=title, status="ready", tags=tags, entities={"repo": repo})
            item.task = Task(
                notes=notes, priority=2 if kind == "review" else 1, remind=False, sort=now.timestamp(),
                source="github", external_id=url, external_url=url,
            )
            db.add(item)
            db.flush()
            schedule_index(db, item.id)
            continue
        item = db.get(Item, task.item_id)
        if (item.title, task.notes) != (title, notes):
            item.title, task.notes = title, notes
            schedule_index(db, item.id)
        # Si la marcaste como hecha aquí, se respeta aunque siga abierta en GitHub.

    for url, task in existing.items():
        if url not in found and task.done_at is None:
            task.done_at = now  # cerrado, fusionado o ya no es tuyo
    row.status, row.error = "ok", None
    return len(found)


@handler("sync_github")
def _sync_github(db: Session, payload: dict) -> None:
    row = db.get(Integration, "github")
    if row is None or not row.secret_encrypted:
        return
    state = dict(row.state or {})
    try:
        count = sync(db, row)
        log.info("GitHub: %d issues y PR", count)
        state.pop("error", None)
    except (GitHubError, httpx.HTTPError) as exc:
        db.rollback()
        row = db.get(Integration, "github")
        row.error = str(exc)[:300]
        if "ya no vale" in str(exc):
            row.status = "reconnect"
        log.warning("GitHub: %s", exc)
    state["synced_at"] = datetime.now(UTC).isoformat()
    row.state = state


def schedule_github_sync(db: Session, now: datetime) -> None:
    row = db.get(Integration, "github")
    token = (get_settings().github_token or "").strip()
    if token and (row is None or not row.secret_encrypted or row.status == "reconnect"):
        # Con GITHUB_TOKEN en .env (p. ej. el de `gh auth token`) se conecta solo.
        stored = json.loads(decrypt(row.secret_encrypted) or "{}").get("token") if row and row.secret_encrypted else None
        if stored != token:
            try:
                connect(db, token)
                db.commit()
                log.info("GitHub conectado con GITHUB_TOKEN")
            except (GitHubError, httpx.HTTPError) as exc:
                db.rollback()
                log.warning("GITHUB_TOKEN no sirve: %s", exc)
            return
    if row is None or not row.secret_encrypted or row.status == "reconnect":
        return
    last = (row.state or {}).get("synced_at")
    every = timedelta(minutes=get_settings().github_sync_minutes) - timedelta(seconds=5)
    if last is None or now - datetime.fromisoformat(last) >= every:
        enqueue(db, "sync_github", {}, dedupe=True, max_attempts=1)
