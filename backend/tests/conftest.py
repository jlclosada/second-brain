import os
import tempfile

# La configuración se lee al importar la app, así que va antes de cualquier import de app.*
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://brain:brain@localhost:5432/brain_test")
os.environ["EMBEDDINGS_PROVIDER"] = "hash"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["APP_PASSWORD"] = "secreto"
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="sb-test-")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine, migrate  # noqa: E402
from app.main import app  # noqa: E402
from app.services import calendar, indexing, pipeline  # noqa: E402,F401  registran trabajos
from app.services.jobs import run_once  # noqa: E402

CSRF = {"X-Requested-With": "segundo-cerebro"}
TABLES = (
    "items, jobs, reminders, notifications, sessions, login_attempts, audit_log, conversations, projects, "
    "account, push_subscriptions, calendars"
)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    migrate()


@pytest.fixture(autouse=True)
def _clean():
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES} CASCADE"))
    yield


@pytest.fixture
def client():
    with TestClient(app, headers=CSRF) as c:
        assert c.post("/api/auth/login", json={"password": "secreto"}).status_code == 200
        yield c


@pytest.fixture
def process_all():
    def _run():
        with SessionLocal() as session:
            while run_once(session):
                pass

    return _run


@pytest.fixture
def upload(client):
    def _upload(name: str, content: bytes | str, mime: str = "text/plain"):
        data = content.encode() if isinstance(content, str) else content
        r = client.post("/api/documents", files=[("files", (name, data, mime))])
        assert r.status_code == 201, r.text
        return r.json()

    return _upload
