"""Google (Gmail + Calendar) y GitHub con las APIs simuladas."""

import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.db import SessionLocal
from app.models import Calendar, Integration
from app.security import encrypt
from app.services import github, google

CLIENT_ID = "123-abc.apps.googleusercontent.com"


class FakeGoogle:
    """Un Google en miniatura: tokens, Gmail y Calendar en memoria."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.threads = {
            "t1": self._thread("t1", "Factura de octubre", "Ana Ruiz <ana@ejemplo.com>", ["INBOX", "UNREAD", "IMPORTANT"]),
            "t2": self._thread("t2", "Oferta increíble", "Tienda <promo@tienda.com>", ["INBOX", "CATEGORY_PROMOTIONS"]),
        }
        now = datetime.now(UTC).replace(microsecond=0)
        self.events = {
            "primary": {
                "e1": {
                    "id": "e1", "status": "confirmed", "summary": "Reunión de equipo",
                    "start": {"dateTime": (now + timedelta(hours=2)).isoformat()},
                    "end": {"dateTime": (now + timedelta(hours=3)).isoformat()},
                    "htmlLink": "https://calendar.google.com/e1", "hangoutLink": "https://meet.google.com/abc",
                },
            },
        }
        self.refreshes = 0

    @staticmethod
    def _thread(tid, subject, sender, labels):
        return {
            "id": tid, "historyId": "1",
            "messages": [{
                "id": f"{tid}m", "labelIds": labels, "snippet": f"Texto de {subject}",
                "internalDate": str(int(datetime.now(UTC).timestamp() * 1000)),
                "payload": {"headers": [{"name": "Subject", "value": subject}, {"name": "From", "value": sender}]},
            }],
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        self.calls.append((request.method, url.path))
        if url.host == "oauth2.googleapis.com" and url.path == "/token":
            form = parse_qs(request.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                self.refreshes += 1
            return httpx.Response(200, json={
                "access_token": "acc", "expires_in": 3600, "refresh_token": "ref",
                "scope": " ".join(google.SCOPES),
            })
        if url.host == "oauth2.googleapis.com" and url.path == "/revoke":
            return httpx.Response(200)
        if url.host == "openidconnect.googleapis.com":
            return httpx.Response(200, json={"email": "yo@gmail.com"})
        assert request.headers["authorization"] == "Bearer acc"
        if url.path == "/gmail/v1/users/me/threads":
            return httpx.Response(200, json={"threads": [{"id": t["id"], "historyId": t["historyId"]}
                                                         for t in self.threads.values()]})
        if url.path.startswith("/gmail/v1/users/me/threads/") and url.path.endswith("/modify"):
            tid = url.path.split("/")[-2]
            body = json.loads(request.content)
            labels = set(self.threads[tid]["messages"][0]["labelIds"])
            labels -= set(body["removeLabelIds"])
            labels |= set(body["addLabelIds"])
            self.threads[tid]["messages"][0]["labelIds"] = sorted(labels)
            if "INBOX" not in labels:
                del self.threads[tid]
            return httpx.Response(200, json={})
        if url.path.startswith("/gmail/v1/users/me/threads/"):
            return httpx.Response(200, json=self.threads[url.path.split("/")[-1]])
        if url.path == "/calendar/v3/users/me/calendarList":
            return httpx.Response(200, json={"items": [
                {"id": "primary", "summary": "yo@gmail.com", "primary": True, "accessRole": "owner",
                 "backgroundColor": "#039be5", "selected": True},
                {"id": "festivos", "summary": "Festivos", "accessRole": "reader", "backgroundColor": "#0b8043",
                 "selected": True},
            ]})
        if url.path.startswith("/calendar/v3/calendars/"):
            parts = url.path.split("/")
            cal_id = parts[4]
            events = self.events.setdefault(cal_id, {})
            if len(parts) == 6 and request.method == "GET":
                return httpx.Response(200, json={"items": list(events.values())})
            if len(parts) == 6 and request.method == "POST":
                body = json.loads(request.content)
                eid = f"new{len(events)}"
                events[eid] = {**body, "id": eid, "status": "confirmed", "htmlLink": f"https://calendar.google.com/{eid}"}
                return httpx.Response(200, json=events[eid])
            eid = parts[6]
            if request.method == "PATCH":
                events[eid].update(json.loads(request.content))
                return httpx.Response(200, json=events[eid])
            if request.method == "DELETE":
                events.pop(eid, None)
                return httpx.Response(204)
        return httpx.Response(404, json={"error": {"message": f"no simulado: {url}"}})


@pytest.fixture
def fake_google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(google, "transport", httpx.MockTransport(fake.handler))
    return fake


def _connect_google(client, fake):
    assert client.put("/api/integrations/google/client",
                      json={"client_id": CLIENT_ID, "client_secret": "secreto-123"}).status_code == 204
    start = client.get("/api/integrations/google/start").json()["url"]
    params = parse_qs(urlparse(start).query)
    assert params["client_id"] == [CLIENT_ID]
    assert "https://www.googleapis.com/auth/gmail.modify" in params["scope"][0]
    r = client.get("/api/integrations/google/callback", params={"code": "c0de", "state": params["state"][0]},
                   follow_redirects=False)
    assert r.status_code == 303
    assert "google=ok" in r.headers["location"]


def test_google_needs_client_config(client):
    status = client.get("/api/integrations").json()
    assert status["google"]["configured"] is False
    assert status["google"]["redirect_uri"].endswith("/api/integrations/google/callback")
    assert client.get("/api/integrations/google/start").status_code == 422
    bad = client.put("/api/integrations/google/client", json={"client_id": "no-es-de-google", "client_secret": "xxxxxxx"})
    assert bad.status_code == 422


def test_callback_rejects_foreign_state(client, fake_google):
    client.put("/api/integrations/google/client", json={"client_id": CLIENT_ID, "client_secret": "secreto-123"})
    r = client.get("/api/integrations/google/callback", params={"code": "x", "state": "falso"}, follow_redirects=False)
    assert "google=error" in r.headers["location"]
    assert client.get("/api/integrations").json()["google"]["connected"] is False


def test_gmail_inbox_sync_and_actions(client, fake_google, process_all):
    _connect_google(client, fake_google)
    status = client.get("/api/integrations").json()["google"]
    assert status["connected"] and status["account"] == "yo@gmail.com"
    process_all()

    inbox = client.get("/api/inbox", params={"view": "all"}).json()
    assert inbox["connected"] and inbox["counts"]["all"] == 2
    attention = client.get("/api/inbox").json()["emails"]
    assert [e["subject"] for e in attention] == ["Factura de octubre"]
    factura = attention[0]
    assert factura["sender_name"] == "Ana Ruiz" and factura["needs_attention"]
    assert "authuser=yo@gmail.com" in factura["url"]

    # Hoy enseña lo que requiere atención
    today = client.get("/api/today").json()
    assert today["connections"]["google"] == "ok"
    assert today["inbox"]["counts"]["attention"] == 1

    # Convertirlo en tarea lo saca de "requiere atención" y deja el enlace al correo
    task = client.post(f"/api/inbox/{factura['id']}/task", json={}).json()
    assert task["source"] == "gmail" and task["external_url"] == factura["url"]
    assert "Ana Ruiz" in task["title"]
    assert client.get("/api/inbox").json()["counts"]["attention"] == 0

    # Archivar lo quita en Gmail y aquí
    promo = next(e for e in inbox["emails"] if e["category"] == "promotions")
    assert client.post(f"/api/inbox/{promo['id']}/archive").status_code == 204
    assert "t2" not in fake_google.threads
    assert client.get("/api/inbox", params={"view": "all"}).json()["counts"]["all"] == 1

    # Lo encuentra la búsqueda
    process_all()
    hits = client.get("/api/search", params={"q": "factura octubre"}).json()["hits"]
    assert any(h["item"]["kind"] == "email" for h in hits)


def test_gmail_sync_mirrors_inbox(client, fake_google, process_all):
    _connect_google(client, fake_google)
    process_all()
    del fake_google.threads["t1"]  # archivado desde el móvil
    client.post("/api/integrations/google/sync")
    process_all()
    assert client.get("/api/inbox", params={"view": "all"}).json()["counts"]["all"] == 1


def test_google_calendar_two_way(client, fake_google, process_all):
    _connect_google(client, fake_google)
    process_all()

    cals = client.get("/api/calendars").json()
    primary = next(c for c in cals if c["source"] == "google" and c["primary"])
    festivos = next(c for c in cals if c["name"] == "Festivos")
    assert primary["writable"] and not festivos["writable"]
    assert primary["color"] == "cobalt" and festivos["color"] == "moss"

    today = datetime.now(UTC).date()
    events = client.get("/api/events", params={"start": today.isoformat(),
                                                "end": (today + timedelta(days=1)).isoformat()}).json()
    meeting = next(e for e in events if e["title"] == "Reunión de equipo")
    assert meeting["meet_url"] == "https://meet.google.com/abc" and meeting["writable"]

    # Un evento nuevo va al calendario principal de Google
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
    created = client.post("/api/events", json={"title": "Dentista", "starts_at": start.isoformat()})
    assert created.status_code == 201, created.text
    created = created.json()
    assert created["calendar_id"] == primary["id"] and created["source"] == "google"
    remote = next(e for e in fake_google.events["primary"].values() if e.get("summary") == "Dentista")

    # Editarlo cambia el de Google
    r = client.patch(f"/api/events/{created['id']}", json={"title": "Dentista (revisión)"})
    assert r.status_code == 200, r.text
    assert fake_google.events["primary"][remote["id"]]["summary"] == "Dentista (revisión)"

    # La sincronización no lo duplica
    client.post("/api/integrations/google/sync")
    process_all()
    titles = [e["title"] for e in client.get("/api/events", params={
        "start": today.isoformat(), "end": (today + timedelta(days=3)).isoformat()}).json()]
    assert titles.count("Dentista (revisión)") == 1

    # Borrarlo lo borra en Google
    created = next(e for e in client.get("/api/events", params={
        "start": today.isoformat(), "end": (today + timedelta(days=3)).isoformat()}).json()
        if e["title"] == "Dentista (revisión)")
    assert client.delete(f"/api/events/{created['id']}").status_code == 204
    assert remote["id"] not in fake_google.events["primary"]

    # En un calendario de solo lectura no se puede escribir
    r = client.post("/api/events", json={"title": "X", "starts_at": start.isoformat(), "calendar_id": festivos["id"]})
    assert r.status_code == 422


def test_expired_token_is_refreshed(client, fake_google, process_all):
    _connect_google(client, fake_google)
    with SessionLocal() as db:
        row = db.get(Integration, "google")
        row.secret_encrypted = encrypt(json.dumps({
            "access_token": "viejo", "refresh_token": "ref",
            "expires_at": (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
        }))
        db.commit()
    process_all()
    assert fake_google.refreshes >= 1
    assert client.get("/api/inbox", params={"view": "all"}).json()["counts"]["all"] == 2


def test_revoked_access_asks_to_reconnect(client, fake_google, process_all, monkeypatch):
    _connect_google(client, fake_google)
    with SessionLocal() as db:
        row = db.get(Integration, "google")
        row.secret_encrypted = encrypt(json.dumps({"access_token": None, "refresh_token": "revocado"}))
        db.commit()
    monkeypatch.setattr(google, "transport", httpx.MockTransport(
        lambda r: httpx.Response(400, json={"error": "invalid_grant"})))
    process_all()
    status = client.get("/api/integrations").json()["google"]
    assert status["status"] == "reconnect"
    assert client.get("/api/today").json()["connections"]["google"] == "reconnect"


def test_google_disconnect_forgets_mail_and_calendars(client, fake_google, process_all):
    _connect_google(client, fake_google)
    process_all()
    assert client.delete("/api/integrations/google").status_code == 204
    assert client.get("/api/inbox", params={"view": "all"}).json()["counts"]["all"] == 0
    with SessionLocal() as db:
        assert db.query(Calendar).filter(Calendar.source == "google").count() == 0
    # La app de Google sigue configurada para volver a conectar
    assert client.get("/api/integrations").json()["google"]["configured"] is True


# --- GitHub -------------------------------------------------------------------------

def _issue(number, title, pr=False, repo="jlclosada/second-brain"):
    data = {
        "number": number, "title": title, "html_url": f"https://github.com/{repo}/{'pull' if pr else 'issues'}/{number}",
        "repository_url": f"https://api.github.com/repos/{repo}",
    }
    if pr:
        data["pull_request"] = {}
    return data


@pytest.fixture
def fake_github(monkeypatch):
    state = {"review": [_issue(7, "Añadir Gmail", pr=True)], "assigned": [_issue(3, "Arreglar el móvil")]}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["authorization"] != "Bearer ghp_bueno_123456":
            return httpx.Response(401, json={"message": "Bad credentials"})
        if request.url.path == "/user":
            return httpx.Response(200, json={"login": "jlclosada"})
        q = request.url.params["q"]
        items = state["review"] if "review-requested" in q else state["assigned"]
        return httpx.Response(200, json={"items": items})

    monkeypatch.setattr(github, "transport", httpx.MockTransport(handler))
    return state


def test_github_issues_become_tasks(client, fake_github, process_all):
    assert client.put("/api/integrations/github", json={"token": "ghp_malo_1234567"}).status_code == 422
    r = client.put("/api/integrations/github", json={"token": "ghp_bueno_123456"})
    assert r.status_code == 200 and r.json()["account"] == "jlclosada"
    process_all()

    gh = client.get("/api/today").json()["github"]
    assert gh["connected"]
    assert [t["title"] for t in gh["reviews"]] == ["Revisar: Añadir Gmail"]
    assert [t["title"] for t in gh["assigned"]] == ["Arreglar el móvil"]
    assert gh["reviews"][0]["external_url"].endswith("/pull/7")

    # Cerrado en GitHub → la tarea se marca hecha
    fake_github["assigned"] = []
    client.post("/api/integrations/github/sync")
    process_all()
    gh = client.get("/api/today").json()["github"]
    assert gh["assigned"] == [] and len(gh["reviews"]) == 1

    # Sin duplicados al volver a sincronizar
    client.post("/api/integrations/github/sync")
    process_all()
    assert len(client.get("/api/tasks", params={"view": "all"}).json()) >= 1
    assert len(client.get("/api/today").json()["github"]["reviews"]) == 1

    assert client.delete("/api/integrations/github").status_code == 204
    assert client.get("/api/today").json()["github"]["connected"] is False
