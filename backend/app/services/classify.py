"""Clasificación de documentos: Claude Haiku si hay clave de API, reglas sencillas si no."""

import logging
import re
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

from app.config import get_settings
from app.models import CATEGORIES

log = logging.getLogger(__name__)

# Para clasificar basta con el principio del documento: título, partes,
# fechas e importes suelen estar en las primeras páginas. El texto completo
# se indexa igualmente para la búsqueda.
CLASSIFY_CHARS = 15_000

Category = Literal[
    "Vehículo", "Hogar", "Salud", "Finanzas", "Impuestos", "Trabajo",
    "Educación", "Legal", "Viajes", "Compras", "Personal", "Otros",
]


class Entity(BaseModel):
    type: str = Field(description="persona, empresa, vehículo, vivienda, cuenta…")
    name: str
    role: str | None = Field(default=None, description="aseguradora, titular, emisor…")


class DocumentInfo(BaseModel):
    title: str = Field(description="Título corto y legible, p. ej. 'Póliza seguro coche Mapfre 2024'")
    doc_type: str = Field(description="póliza, factura, nómina, contrato, recibo, informe médico…")
    category: Category
    summary: str = Field(description="Resumen de 1 o 2 frases")
    doc_date: str | None = Field(default=None, description="Fecha principal del documento, AAAA-MM-DD")
    expires_on: str | None = Field(default=None, description="Fecha de vencimiento o fin de vigencia, AAAA-MM-DD")
    year: int | None = Field(default=None, description="Año al que corresponde el documento")
    tags: list[str] = Field(default_factory=list, description="3 a 6 etiquetas en minúsculas")
    entities: list[Entity] = Field(default_factory=list)


SYSTEM_PROMPT = f"""Eres el archivero de un "segundo cerebro" personal en español.
Recibes el texto de un documento (puede venir de OCR y tener errores) y su nombre de archivo.
Devuelve sus metadatos para poder encontrarlo después buscando cosas como "seguro de coche 2024".

- category: elige la más útil de {", ".join(CATEGORIES)}. Un seguro de coche es Vehículo; uno de hogar, Hogar.
- year: el año al que se refiere el documento (periodo de la póliza, ejercicio fiscal, fecha de la factura).
- title: claro y específico, con la entidad y el año cuando existan.
- Las fechas en formato AAAA-MM-DD. Si un dato no aparece, déjalo vacío; no lo inventes."""


def classify(text: str, filename: str) -> DocumentInfo:
    settings = get_settings()
    if settings.anthropic_api_key and text.strip():
        try:
            return _classify_with_claude(text, filename)
        except anthropic.APIError as exc:
            log.warning("Clasificación con Claude fallida, se usan reglas: %s", exc)
    return classify_with_rules(text, filename)


def _classify_with_claude(text: str, filename: str) -> DocumentInfo:
    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.parse(
        model=settings.classify_model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": f"Archivo: {filename}\n\n<documento>\n{text[:CLASSIFY_CHARS]}\n</documento>",
        }],
        output_format=DocumentInfo,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        log.warning("Claude no clasificó %s (stop_reason=%s)", filename, response.stop_reason)
        return classify_with_rules(text, filename)
    return response.parsed_output


# --- Clasificación por reglas (sin IA) -------------------------------------

_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Vehículo": ["coche", "automovil", "vehiculo", "matricula", "itv", "moto", "taller", "carburante", "dgt"],
    "Hogar": ["hogar", "vivienda", "alquiler", "hipoteca", "comunidad de propietarios", "luz", "gas", "agua", "ibi"],
    "Salud": ["medico", "clinica", "hospital", "receta", "analitica", "diagnostico", "paciente", "dental"],
    "Finanzas": ["banco", "cuenta", "transferencia", "prestamo", "extracto", "tarjeta", "inversion", "iban"],
    "Impuestos": ["hacienda", "irpf", "renta", "aeat", "modelo 100", "iva", "tributaria"],
    "Trabajo": ["nomina", "empresa", "contrato laboral", "salario", "seguridad social", "vida laboral"],
    "Educación": ["universidad", "curso", "titulo", "certificado", "matricula academica", "colegio"],
    "Legal": ["notario", "escritura", "juzgado", "poder notarial", "testamento", "demanda"],
    "Viajes": ["vuelo", "hotel", "reserva", "billete", "pasaporte", "embarque"],
    "Compras": ["pedido", "ticket", "garantia", "amazon", "compra"],
}

_TYPE_KEYWORDS: list[tuple[str, str]] = [
    ("poliza", "póliza"),
    ("factura", "factura"),
    ("nomina", "nómina"),
    ("recibo", "recibo"),
    ("contrato", "contrato"),
    ("informe", "informe"),
    ("certificado", "certificado"),
    ("extracto", "extracto"),
    ("presupuesto", "presupuesto"),
]

_YEAR_RE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
_DATE_RE = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower())
    return "".join(c for c in value if not unicodedata.combining(c))


def _count(haystack: str, needle: str) -> int:
    return len(re.findall(rf"\b{re.escape(needle)}\b", haystack))


def classify_with_rules(text: str, filename: str) -> DocumentInfo:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ").strip()
    norm = normalize(f"{stem}\n{text}")

    scores = {cat: sum(_count(norm, k) for k in kws) for cat, kws in _CATEGORY_KEYWORDS.items()}
    category = max(scores, key=scores.get) if any(scores.values()) else "Otros"
    doc_type = next((label for key, label in _TYPE_KEYWORDS if key in norm), "documento")

    years = Counter(int(y) for y in _YEAR_RE.findall(norm))
    year = years.most_common(1)[0][0] if years else None

    doc_date = None
    for d, m, y in _DATE_RE.findall(text):
        try:
            doc_date = date(int(y), int(m), int(d)).isoformat()
            break
        except ValueError:
            continue

    first_line = next((line.strip() for line in text.splitlines() if len(line.strip()) > 3), "")
    # "scan_0032" o "IMG 2041" no dicen nada; "poliza hogar 2026" sí.
    generic = re.fullmatch(r"(?i)(scan|escaneo|img|image|imagen|foto|photo|doc|documento|file|archivo|whatsapp image)?[\s\d_-]*", stem)
    title = stem.capitalize() if len(re.sub(r"[\W\d_]", "", stem)) > 3 and not generic else first_line[:80] or stem
    summary = " ".join(text.split())[:240] or None

    tags = [doc_type] + ([str(year)] if year else [])
    return DocumentInfo(
        title=title or "Documento",
        doc_type=doc_type,
        category=category,
        summary=summary or "",
        doc_date=doc_date,
        year=year,
        tags=tags,
    )
