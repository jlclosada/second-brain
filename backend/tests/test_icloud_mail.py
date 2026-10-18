"""iCloud (CalDAV) en los dos sentidos y responder correos con borrador + confirmación."""

import base64
import json
import re
from datetime import UTC, datetime, timedelta
from email import message_from_bytes

import httpx
import pytest

from app.services import github, google, icloud
from tests.test_integrations import FakeGoogle, _connect_google

CAL = "https://p42-caldav.icloud.com/123/calendars/home/"


def _vevent(uid, summary, start, end, rrule=None):
    fmt = "%Y%m%dT%H%M%SZ"
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple//ES\r\nBEGIN:VEVENT\r\n"
        f"UID:{uid}\r\nSUMMARY:{summary}\r\nDTSTART:{start.strftime(fmt)}\r\nDTEND:{end.strftime(fmt)}\r\n"
        + (f"RRULE:{rrule}\r\n" if rrule else "")
        + "DTSTAMP:20260101T000000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    )


class FakeICloud:
    def __init__(self):
        now = datetime.now(UTC).replace(microsecond=0, second=0)
        self.objects = {
            f"{CAL}cena.ics": _vevent("cena-1", "Cena con Laura", now + timedelta(days=1), now + timedelta(days=1, hours=2)),
            f"{CAL}gym.ics": _vevent("gym-1", "Gimnasio", now + timedelta(hours=3), now + timedelta(hours=4), "FREQ=DAILY;COUNT=3"),
        }
        self.etag = 1

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != "Basic " + base64.b64encode(b"yo@icloud.com:abcd-efgh-ijkl-mnop").decode():
            return httpx.Response(401)
        url, method = str(request.url), request.method
        if method == "PROPFIND" and url == icloud.BASE:
            return self._xml('<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal>'
                             '<d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>')
        if method == "PROPFIND" and url.endswith("/123/principal/"):
            return self._xml('<d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><c:calendar-home-set>'
                             '<d:href>https://p42-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set>'
                             '</d:prop></d:propstat></d:response>')
        if method == "PROPFIND" and url.endswith("/123/calendars/"):
            return self._xml(
                '<d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/>'
                '</d:resourcetype></d:prop></d:propstat></d:response>'
                '<d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:displayname>Casa</d:displayname>'
                '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><a:calendar-color>#FF2968FF</a:calendar-color>'
                '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>'
                '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege>'
                '</d:current-user-privilege-set></d:prop></d:propstat></d:response>'
                '<d:response><d:href>/123/calendars/tasks/</d:href><d:propstat><d:prop><d:displayname>Recordatorios</d:displayname>'
                '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>'
                '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'
                '</d:prop></d:propstat></d:response>'
            )
        if method == "REPORT" and url == CAL:
            body = "".join(
                f'<d:response><d:href>{href.replace("https://p42-caldav.icloud.com", "")}</d:href><d:propstat><d:prop>'
                f'<d:getetag>"e{self.etag}"</d:getetag><c:calendar-data>{ics.replace("&", "&amp;").replace("<", "&lt;")}'
                '</c:calendar-data></d:prop></d:propstat></d:response>'
                for href, ics in self.objects.items()
            )
            return self._xml(body)
        if method == "PUT" and url.startswith(CAL):
            if request.headers.get("if-none-match") == "*" and url in self.objects:
                return httpx.Response(412)
            self.objects[url] = request.content.decode()
            self.etag += 1
            return httpx.Response(201, headers={"etag": f'"e{self.etag}"'})
        if method == "DELETE" and url in self.objects:
            del self.objects[url]
            return httpx.Response(204)
        return httpx.Response(404)

    @staticmethod
    def _xml(inner: str) -> httpx.Response:
        return httpx.Response(207, content=(
            '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" '
            f'xmlns:a="http://apple.com/ns/ical/">{inner}</d:multistatus>'
        ).encode())


@pytest.fixture
def fake_icloud(monkeypatch):
    fake = FakeICloud()
    monkeypatch.setattr(icloud, "transport", httpx.MockTransport(fake.handler))
    return fake


def _events(client, days=3):
    today = datetime.now(UTC).date()
    return client.get("/api/events", params={"start": (today - timedelta(days=1)).isoformat(),
                                             "end": (today + timedelta(days=days)).isoformat()}).json()


def test_icloud_two_way(client, fake_icloud, process_all):
    bad = client.put("/api/integrations/icloud", json={"apple_id": "yo@icloud.com", "password": "mala-mala-mala"})
    assert bad.status_code == 422 and "contraseña de app" in bad.json()["detail"]
    ok = client.put("/api/integrations/icloud", json={"apple_id": "yo@icloud.com", "password": "abcd-efgh-ijkl-mnop"})
    assert ok.status_code == 200 and ok.json()["account"] == "yo@icloud.com"
    process_all()

    cals = [c for c in client.get("/api/calendars").json() if c["source"] == "icloud"]
    assert [c["name"] for c in cals] == ["Casa"]  # los recordatorios (VTODO) no son un calendario de eventos
    assert cals[0]["color"] == "rose"

    events = _events(client)
    cena = next(e for e in events if e["title"] == "Cena con Laura")
    gym = [e for e in events if e["title"] == "Gimnasio"]
    assert cena["writable"] and cena["source"] == "icloud"
    assert len(gym) == 3 and not gym[0]["writable"]  # las series se editan en el iPhone

    # Editar uno suelto lo cambia en iCloud
    r = client.patch(f"/api/events/{cena['id']}", json={"title": "Cena con Laura y Pablo"})
    assert r.status_code == 200, r.text
    assert "Cena con Laura y Pablo" in fake_icloud.objects[f"{CAL}cena.ics"]

    # Crear uno nuevo en iCloud
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
    created = client.post("/api/events", json={"title": "Dentista", "starts_at": start.isoformat(), "calendar_id": cals[0]["id"]})
    assert created.status_code == 201, created.text
    assert any("SUMMARY:Dentista" in ics for ics in fake_icloud.objects.values())

    # La sincronización no lo duplica y borrarlo lo borra en iCloud
    client.post("/api/integrations/icloud/sync")
    process_all()
    dentista = [e for e in _events(client) if e["title"] == "Dentista"]
    assert len(dentista) == 1
    assert client.delete(f"/api/events/{dentista[0]['id']}").status_code == 204
    assert not any("SUMMARY:Dentista" in ics for ics in fake_icloud.objects.values())

    assert client.patch(f"/api/events/{gym[0]['id']}", json={"title": "x"}).status_code == 422
    assert client.get("/api/today").json()["connections"]["icloud"] == "ok"


# --- Correo: leer, redactar respuesta y enviar solo al confirmar --------------------------------

class MailGoogle(FakeGoogle):
    def __init__(self):
        super().__init__()
        self.drafts: dict[str, dict] = {}
        self.sent: list[dict] = []
        body = base64.urlsafe_b64encode("Hola José,\n¿Me envías los certificados?\n\n> cita anterior".encode()).decode()
        m = self.threads["t1"]["messages"][0]
        m["payload"]["headers"] += [{"name": "Message-ID", "value": "<abc@gestoria.es>"}]
        m["payload"]["parts"] = [{"mimeType": "text/plain", "body": {"data": body}}]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/gmail/v1/users/me/drafts" and request.method == "POST":
            did = f"d{len(self.drafts) + 1}"
            self.drafts[did] = json.loads(request.content)["message"]
            return httpx.Response(200, json={"id": did})
        if path.startswith("/gmail/v1/users/me/drafts/") and request.method == "PUT":
            did = path.rsplit("/", 1)[1]
            self.drafts[did] = json.loads(request.content)["message"]
            return httpx.Response(200, json={"id": did})
        if path == "/gmail/v1/users/me/drafts/send":
            did = json.loads(request.content)["id"]
            self.sent.append(self.drafts.pop(did))
            return httpx.Response(200, json={"id": "m-sent"})
        return super().handler(request)


def _decode(message: dict):
    return message_from_bytes(base64.urlsafe_b64decode(message["raw"]))


def test_reply_is_drafted_then_sent_only_on_confirm(client, monkeypatch, process_all):
    fake = MailGoogle()
    monkeypatch.setattr(google, "transport", httpx.MockTransport(fake.handler))
    _connect_google(client, fake)
    process_all()
    email = client.get("/api/inbox").json()["emails"][0]

    from app.db import SessionLocal
    from app.models import Email
    from app.services.assistant import Toolbox

    with SessionLocal() as db:
        tools = Toolbox(db)
        thread = tools.run("leer_correo", {"id": email["id"]})
        assert "certificados" in thread["mensajes"][0]["texto"] and "cita anterior" not in thread["mensajes"][0]["texto"]
        out = tools.run("redactar_respuesta", {"id": email["id"], "texto": "Hola Ana,\nTe los envío hoy.\nUn saludo,\nJosé Luis"})
        action = tools.actions[-1]
        assert out["ok"] and not fake.sent  # solo borrador
        assert action.data["draft_id"] == out["borrador"] and action.data["to"] == "ana@ejemplo.com"
        assert db.get(Email, email["id"]) is not None

    draft = _decode(fake.drafts[out["borrador"]])
    assert draft["Subject"] == "Re: Factura de octubre" and draft["In-Reply-To"] == "<abc@gestoria.es>"
    assert fake.drafts[out["borrador"]]["threadId"] == "t1"

    # Enviar con el texto editado en la interfaz
    r = client.post(f"/api/inbox/drafts/{out['borrador']}/send",
                    json={"email_id": email["id"], "body": "Hola Ana,\nTe los envío mañana.\nJosé Luis"})
    assert r.status_code == 204
    sent = _decode(fake.sent[0])
    assert "mañana" in sent.get_payload(decode=True).decode()


def test_email_task_shows_up_today(client, process_all, monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(google, "transport", httpx.MockTransport(fake.handler))
    _connect_google(client, fake)
    process_all()
    email = client.get("/api/inbox").json()["emails"][0]
    task = client.post(f"/api/inbox/{email['id']}/task", json={}).json()
    assert task["due_date"] == datetime.now(UTC).astimezone(__import__("app.config", fromlist=["x"]).get_settings().tz).date().isoformat()
    assert any(t["id"] == task["id"] for t in client.get("/api/today").json()["due_today"])


def test_github_connects_itself_from_env_token(client, monkeypatch):
    from app.config import get_settings
    from app.db import SessionLocal
    from app.services.github import schedule_github_sync

    monkeypatch.setattr(get_settings(), "github_token", "ghp_bueno_123456")
    monkeypatch.setattr(github, "transport", httpx.MockTransport(
        lambda r: httpx.Response(200, json={"login": "jlclosada"}) if r.url.path == "/user"
        else httpx.Response(200, json={"items": []})))
    with SessionLocal() as db:
        schedule_github_sync(db, datetime.now(UTC))
    status = client.get("/api/integrations").json()["github"]
    assert status["connected"] and status["account"] == "jlclosada"
    assert re.match(r"^\d{4}-", status["connected_at"])


def test_jarvis_moves_and_cancels_google_events(client, monkeypatch, process_all):
    from app.db import SessionLocal
    from app.services.assistant import Toolbox

    fake = FakeGoogle()
    monkeypatch.setattr(google, "transport", httpx.MockTransport(fake.handler))
    _connect_google(client, fake)
    process_all()

    today = datetime.now(UTC).date()
    with SessionLocal() as db:
        tools = Toolbox(db)
        agenda = tools.run("agenda", {"desde": today.isoformat(), "hasta": (today + timedelta(days=1)).isoformat()})
        meeting = next(e for e in agenda["eventos"] if e["titulo"] == "Reunión de equipo")
        assert meeting["se_puede_cambiar"] and meeting["calendario"] == "yo@gmail.com"

        new_start = (datetime.now(UTC) + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        local = new_start.astimezone(__import__("app.config", fromlist=["x"]).get_settings().tz).strftime("%Y-%m-%dT%H:%M")
        moved = tools.run("cambiar_evento", {"id": meeting["id"], "titulo": None, "inicio": local, "fin": None, "lugar": "Sala 2"})
        assert moved["ok"] and moved["inicio"].endswith(local[-5:])
        remote = fake.events["primary"]["e1"]
        assert remote["location"] == "Sala 2" and remote["start"]["dateTime"].startswith(local)
        # Conserva la duración (1 hora)
        assert datetime.fromisoformat(remote["end"]["dateTime"]) - datetime.fromisoformat(remote["start"]["dateTime"]) == timedelta(hours=1)

        out = tools.run("cancelar_evento", {"id": meeting["id"]})
        assert out["cancelado"] == "Reunión de equipo"
        assert "e1" not in fake.events["primary"]
        assert [a.tool for a in tools.actions][-2:] == ["cambiar_evento", "cancelar_evento"]
