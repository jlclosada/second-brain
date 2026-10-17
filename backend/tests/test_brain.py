"""Notas, tareas, calendario, recordatorios, captura y la pantalla de hoy."""

from datetime import UTC, date, datetime, time, timedelta

from app.config import get_settings
from app.db import SessionLocal
from app.models import Calendar, Notification
from app.services.calendar import sync_calendar
from app.services.scheduler import tick
from app.services.when import parse

TZ = get_settings().tz


def local(day: date, hour: int, minute: int = 0) -> str:
    return datetime.combine(day, time(hour, minute), tzinfo=TZ).isoformat()


def today() -> date:
    return datetime.now(TZ).date()


# --- Notas -------------------------------------------------------------------

def test_notes_links_and_backlinks(client, process_all):
    target = client.post("/api/notes", json={"title": "Viaje a Lisboa", "body": "Hotel y vuelos"}).json()
    source = client.post("/api/notes", json={"body": "# Ideas\nMirar [[Viaje a Lisboa]] y [[No existe]]",
                                              "tags": ["#Viajes"]}).json()
    assert source["title"] == "Ideas"
    assert source["tags"] == ["viajes"]
    assert [link["id"] for link in source["links"]] == [target["id"]]

    detail = client.get(f"/api/notes/{target['id']}").json()
    assert [b["title"] for b in detail["backlinks"]] == ["Ideas"]

    process_all()
    hits = client.get("/api/search", params={"q": "Lisboa", "kind": "note"}).json()["hits"]
    assert {h["item"]["id"] for h in hits} == {target["id"], source["id"]}

    client.patch(f"/api/notes/{source['id']}", json={"pinned": True})
    assert client.get("/api/notes").json()[0]["id"] == source["id"]
    assert client.delete(f"/api/notes/{target['id']}").status_code == 204
    assert client.get(f"/api/notes/{source['id']}").json()["links"] == []


def test_journal_is_one_per_day(client):
    first = client.get(f"/api/journal/{today().isoformat()}").json()
    again = client.get(f"/api/journal/{today().isoformat()}").json()
    assert first["id"] == again["id"]
    assert first["title"].startswith("Diario del")
    client.patch(f"/api/notes/{first['id']}", json={"body": "Buen día"})
    assert client.get("/api/notes", params={"journal": True}).json()[0]["body"] == "Buen día"
    assert client.get("/api/notes").json() == []  # el diario no se mezcla con las notas


# --- Tareas ------------------------------------------------------------------

def test_task_views_and_completion(client):
    d = today()
    overdue = client.post("/api/tasks", json={"title": "Pagar IBI", "due_date": (d - timedelta(days=2)).isoformat(),
                                               "priority": 3}).json()
    client.post("/api/tasks", json={"title": "Llamar al taller", "due_date": d.isoformat()})
    client.post("/api/tasks", json={"title": "Renovar DNI", "due_date": (d + timedelta(days=9)).isoformat()})
    client.post("/api/tasks", json={"title": "Leer libro"})

    titles = lambda view: [t["title"] for t in client.get("/api/tasks", params={"view": view}).json()]  # noqa: E731
    assert titles("today") == ["Pagar IBI", "Llamar al taller"]
    assert titles("upcoming") == ["Renovar DNI"]
    assert titles("inbox") == ["Leer libro"]

    done = client.patch(f"/api/tasks/{overdue['id']}", json={"done": True}).json()
    assert done["done_at"] is not None
    assert titles("done") == ["Pagar IBI"]
    assert "Pagar IBI" not in titles("open")


def test_recurring_task_moves_to_next_date(client):
    d = today()
    task = client.post("/api/tasks", json={"title": "Sacar la basura", "due_date": d.isoformat(),
                                            "rrule": "FREQ=WEEKLY"}).json()
    after = client.patch(f"/api/tasks/{task['id']}", json={"done": True}).json()
    assert after["done_at"] is None
    assert after["due_date"] == (d + timedelta(days=7)).isoformat()
    assert client.post("/api/tasks", json={"title": "x", "rrule": "FREQ=NUNCA"}).status_code == 422


# --- Calendario --------------------------------------------------------------

def test_events_with_recurrence_in_range(client):
    d = today()
    client.post("/api/events", json={"title": "Dentista", "starts_at": local(d, 10), "location": "Clínica"})
    client.post("/api/events", json={"title": "Pilates", "starts_at": local(d, 19), "ends_at": local(d, 20),
                                     "rrule": "FREQ=DAILY;COUNT=3"})
    client.post("/api/events", json={"title": "Vacaciones", "starts_at": local(d + timedelta(days=1), 0),
                                     "all_day": True})

    events = client.get("/api/events", params={"start": d.isoformat(),
                                                "end": (d + timedelta(days=6)).isoformat()}).json()
    names = [e["title"] for e in events]
    assert names.count("Pilates") == 3
    assert "Dentista" in names and "Vacaciones" in names
    dentist = next(e for e in events if e["title"] == "Dentista")
    assert datetime.fromisoformat(dentist["ends_at"]) - datetime.fromisoformat(dentist["starts_at"]) == timedelta(hours=1)
    holiday = next(e for e in events if e["title"] == "Vacaciones")
    assert holiday["all_day"] is True

    day_only = client.get("/api/events", params={"start": d.isoformat(), "end": d.isoformat()}).json()
    assert sorted(e["title"] for e in day_only) == ["Dentista", "Pilates"]
    assert client.get("/api/events", params={"start": d.isoformat(),
                                             "end": (d + timedelta(days=400)).isoformat()}).status_code == 422


ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//ES
BEGIN:VEVENT
UID:abc-1
DTSTART:{start}
DTEND:{end}
SUMMARY:Reunión de equipo
LOCATION:Oficina
RRULE:FREQ=WEEKLY;COUNT=2
END:VEVENT
BEGIN:VEVENT
UID:abc-2
DTSTART;VALUE=DATE:{day}
SUMMARY:Festivo
END:VEVENT
END:VCALENDAR
"""


def test_ics_sync_is_idempotent_and_read_only(client):
    d = today() + timedelta(days=1)
    start = datetime.combine(d, time(9), tzinfo=TZ).astimezone(UTC)
    raw = ICS.format(start=start.strftime("%Y%m%dT%H%M%SZ"),
                     end=(start + timedelta(hours=1)).strftime("%Y%m%dT%H%M%SZ"), day=d.strftime("%Y%m%d"))
    with SessionLocal() as db:
        cal = Calendar(name="Trabajo", color="ochre", source="ics")
        db.add(cal)
        db.commit()
        assert sync_calendar(db, cal, raw.encode()) == 3
        db.commit()
        assert sync_calendar(db, cal, raw.encode()) == 3
        db.commit()

    events = client.get("/api/events", params={"start": d.isoformat(),
                                                "end": (d + timedelta(days=8)).isoformat()}).json()
    meetings = [e for e in events if e["title"] == "Reunión de equipo"]
    assert len(meetings) == 2 and meetings[0]["source"] == "ics"
    r = client.patch(f"/api/events/{meetings[0]['id']}", json={"title": "Otra"})
    assert r.status_code == 422


def test_feed_requires_token(client):
    d = today()
    client.post("/api/events", json={"title": "Cena", "starts_at": local(d, 21)})
    path = client.get("/api/calendar/feed").json()["url_path"]
    feed = client.get(path)
    assert feed.status_code == 200
    assert b"SUMMARY:Cena" in feed.content
    assert client.get("/api/calendar/feed/inventado.ics").status_code == 404
    new_path = client.post("/api/calendar/feed/rotate").json()["url_path"]
    assert client.get(path).status_code == 404
    assert client.get(new_path).status_code == 200


# --- Captura y lenguaje natural ----------------------------------------------

def test_when_parser_spanish():
    now = datetime(2026, 10, 17, 22, 0)  # sábado por la noche
    cases = {
        "llamar al taller el martes a las 10": (date(2026, 10, 20), time(10), "llamar al taller"),
        "cena con Laura el viernes 21h": (date(2026, 10, 23), time(21), "cena con Laura"),
        "pagar el IBI el 5 de noviembre": (date(2026, 11, 5), None, "pagar el IBI"),
        "gimnasio mañana por la mañana": (date(2026, 10, 18), time(9), "gimnasio"),
        "dentista el 3/11 a las 9:15": (date(2026, 11, 3), time(9, 15), "dentista"),
        "comprar pan": (None, None, "comprar pan"),
    }
    for text, (day, at, rest) in cases.items():
        w = parse(text, now)
        assert (w.day, w.at, w.rest) == (day, at, rest), text
    w = parse("reunión equipo de 10 a 12 el lunes", now)
    assert (w.day, w.at, w.end_at) == (date(2026, 10, 19), time(10), time(12))


def test_capture_creates_the_right_thing(client):
    event = client.post("/api/capture", json={"text": "Cita con el dentista mañana a las 10"}).json()
    assert event["kind"] == "event" and event["parsed_by"] == "reglas"
    assert client.get(f"/api/events/{event['created_id']}").json()["title"] == "Cita con el dentista"

    task = client.post("/api/capture", json={"text": "Pagar el seguro del coche el 5 de diciembre #coche !"}).json()
    assert task["kind"] == "task" and task["priority"] == 3 and task["tags"] == ["coche"]

    note = client.post("/api/capture", json={"text": "nota: el código del trastero es 4512"}).json()
    assert note["kind"] == "note"

    reminder = client.post("/api/capture", json={"text": "recuérdame sacar la ropa en 2 horas"}).json()
    assert reminder["kind"] == "reminder"
    assert client.get("/api/reminders").json()[0]["title"] == "Sacar la ropa"

    preview = client.post("/api/capture", json={"text": "comprar leche", "commit": False}).json()
    assert preview["created_id"] is None


# --- Hoy y avisos ------------------------------------------------------------

def test_today_dashboard(client, upload, process_all):
    d = today()
    client.post("/api/tasks", json={"title": "Vencida", "due_date": (d - timedelta(days=1)).isoformat()})
    client.post("/api/tasks", json={"title": "Para hoy", "due_date": d.isoformat()})
    client.post("/api/events", json={"title": "Reunión", "starts_at": local(d, 12)})
    expires = (d + timedelta(days=10)).strftime("%d/%m/%Y")
    item = upload("poliza.txt", f"Póliza de hogar. Vence el {expires}.")["created"][0]
    process_all()
    client.patch(f"/api/documents/{item['id']}", json={"expires_on": (d + timedelta(days=10)).isoformat()})

    data = client.get("/api/today").json()
    assert [t["title"] for t in data["overdue"]] == ["Vencida"]
    assert [t["title"] for t in data["due_today"]] == ["Para hoy"]
    assert [e["title"] for e in data["events"]] == ["Reunión"]
    assert data["expiring"][0]["days_left"] == 10
    assert data["counts"]["open_tasks"] == 2


def test_scheduler_sends_each_notice_once(client):
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    client.post("/api/reminders", json={"title": "Tomar la pastilla",
                                        "remind_at": (now - timedelta(minutes=1)).isoformat()})
    client.post("/api/events", json={"title": "Llamada", "starts_at": (now + timedelta(minutes=10)).isoformat(),
                                     "remind_minutes": 10})
    client.post("/api/reminders", json={"title": "Muy antiguo", "remind_at": (now - timedelta(days=2)).isoformat()})
    with SessionLocal() as db:
        tick(db, now)
        tick(db, now)
        titles = sorted(n.title for n in db.query(Notification).all())
    assert "Tomar la pastilla" in titles and "Llamada" in titles
    assert titles.count("Tomar la pastilla") == 1
    assert "Muy antiguo" not in titles
    assert client.get("/api/notifications/unread").json()["count"] == len(titles)
    client.post("/api/notifications/read")
    assert client.get("/api/notifications/unread").json()["count"] == 0


def test_projects_group_items(client):
    project = client.post("/api/projects", json={"name": "Reforma cocina", "color": "ochre"}).json()
    client.post("/api/tasks", json={"title": "Pedir presupuesto", "project_id": project["id"]})
    client.post("/api/notes", json={"title": "Medidas", "body": "3x4", "project_id": project["id"]})
    listed = client.get("/api/projects").json()[0]
    assert (listed["open_tasks"], listed["notes"]) == (1, 1)
    tasks = client.get("/api/tasks", params={"project_id": project["id"]}).json()
    assert [t["title"] for t in tasks] == ["Pedir presupuesto"]
    assert client.post("/api/tasks", json={"title": "x", "project_id": "00000000-0000-0000-0000-000000000000"}).status_code == 422
