"""Jarvis en directo: streaming de texto y acciones, con Claude simulado."""

import json
from contextlib import contextmanager
from types import SimpleNamespace

from app.services import assistant
from tests.test_memory import brain_dirs  # noqa: F401  (fixture)


def _block(**kw):
    return SimpleNamespace(**kw, to_dict=lambda: {k: v for k, v in kw.items()})


class FakeClaude:
    """Primero pide crear una nota; luego responde con texto a trozos."""

    def __init__(self):
        self.calls = 0
        self.messages = SimpleNamespace(stream=self.stream)

    @contextmanager
    def stream(self, **params):
        self.calls += 1
        if self.calls == 1:
            msg = SimpleNamespace(stop_reason="tool_use", content=[
                _block(type="tool_use", id="t1", name="crear_nota",
                       input={"titulo": "Ideas viaje Japón", "contenido": "Kioto en otoño. [[Viajes]]"}),
            ])
            yield SimpleNamespace(text_stream=iter([]), get_final_message=lambda: msg)
        else:
            parts = ["Listo, ", "lo he guardado ", "en tu Bandeja."]
            msg = SimpleNamespace(stop_reason="end_turn", content=[_block(type="text", text="".join(parts))])
            yield SimpleNamespace(text_stream=iter(parts), get_final_message=lambda: msg)


def test_stream_shows_text_and_actions_live(client, brain_dirs, monkeypatch):  # noqa: F811
    monkeypatch.setattr(assistant, "_client", lambda: FakeClaude())
    with client.stream("POST", "/api/assistant/stream", json={"message": "Apunta ideas para Japón"}) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]

    kinds = [e["type"] for e in events]
    assert kinds[0] == "start" and kinds[-1] == "done"
    assert "".join(e["delta"] for e in events if e["type"] == "text") == "Listo, lo he guardado en tu Bandeja."
    action = next(e["action"] for e in events if e["type"] == "action")
    assert action["tool"] == "crear_nota" and action["link"].startswith("obsidian://open?vault=Segundo-Cerebro&file=00-Bandeja")
    assert any("Kioto" in p.read_text() for p in (brain_dirs[0] / "00-Bandeja").glob("*.md"))

    conv_id = events[-1]["conversation_id"]
    history = client.get(f"/api/assistant/conversations/{conv_id}").json()["messages"]
    assert [m["role"] for m in history] == ["user", "assistant"]


def test_stream_reports_missing_key(client):
    with client.stream("POST", "/api/assistant/stream", json={"message": "hola"}) as r:
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    assert events[-1]["type"] == "error" and "ANTHROPIC_API_KEY" in events[-1]["message"]
