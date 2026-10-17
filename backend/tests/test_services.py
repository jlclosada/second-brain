from types import SimpleNamespace

from app.services import classify as classify_module
from app.services.chunking import CHUNK_CHARS, split_text
from app.services.classify import DocumentInfo, classify
from app.services.search import parse_query


def test_parse_query_extracts_years():
    parsed = parse_query("seguro de coche 2024")
    assert parsed.text == "seguro de coche"
    assert parsed.years == [2024]
    assert parse_query("factura luz").years == []


def test_split_text_respects_size():
    text = "\n\n".join(f"Párrafo {i} " + "palabra " * 60 for i in range(40))
    chunks = split_text(text)
    assert len(chunks) > 1
    assert all(len(c) <= CHUNK_CHARS + 250 for c in chunks)
    assert split_text("   ") == []


def test_classify_uses_claude_when_key_present(monkeypatch):
    expected = DocumentInfo(
        title="Póliza seguro coche Mapfre 2024",
        doc_type="póliza",
        category="Vehículo",
        summary="Seguro a todo riesgo del Seat León.",
        year=2024,
    )
    calls = {}

    class FakeMessages:
        def parse(self, **kwargs):
            calls.update(kwargs)
            return SimpleNamespace(stop_reason="end_turn", parsed_output=expected)

    class FakeClient:
        def __init__(self, api_key):
            self.messages = FakeMessages()

    monkeypatch.setattr(classify_module.anthropic, "Anthropic", FakeClient)
    monkeypatch.setattr(classify_module.get_settings(), "anthropic_api_key", "sk-test")

    assert classify("texto de la póliza", "scan.pdf") == expected
    assert calls["model"] == "claude-haiku-5-5"
    assert calls["output_format"] is DocumentInfo


def test_classify_falls_back_to_rules_on_refusal(monkeypatch):
    class FakeClient:
        def __init__(self, api_key):
            self.messages = SimpleNamespace(
                parse=lambda **_: SimpleNamespace(stop_reason="refusal", parsed_output=None)
            )

    monkeypatch.setattr(classify_module.anthropic, "Anthropic", FakeClient)
    monkeypatch.setattr(classify_module.get_settings(), "anthropic_api_key", "sk-test")
    info = classify("Factura de la luz de Iberdrola 2024", "factura.pdf")
    assert info.doc_type == "factura"
    assert info.year == 2024
