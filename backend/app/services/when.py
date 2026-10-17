"""Fechas y horas en español escritas como se dicen: "el martes a las 10",
"mañana por la tarde", "5 de noviembre", "en 2 horas", "de 10 a 12"…

Devuelve qué se encontró y el texto sin esa parte, para usarlo de título.
"""

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

WEEKDAYS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6}
MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
UNITS = {"minuto": "minutes", "minutos": "minutes", "min": "minutes", "hora": "hours", "horas": "hours",
         "dia": "days", "dias": "days", "semana": "weeks", "semanas": "weeks"}
PARTS_OF_DAY = {"manana": time(9), "mediodia": time(13), "tarde": time(17), "noche": time(21)}


@dataclass
class When:
    day: date | None = None
    at: time | None = None
    end_at: time | None = None
    rest: str = ""

    @property
    def found(self) -> bool:
        return self.day is not None or self.at is not None


def fold(text: str) -> str:
    """Minúsculas sin tildes, conservando la longitud para poder recortar el original."""
    out = []
    for ch in text:
        base = unicodedata.normalize("NFKD", ch)
        out.append(base[0].lower() if base else ch)
    return "".join(out)


def _hour(h: int, minute: int, suffix: str | None, bare: bool) -> time | None:
    if suffix in ("tarde", "noche", "pm") and h < 12:
        h += 12
    elif suffix in ("manana", "am") and h == 12:
        h = 0
    elif bare and suffix is None and 1 <= h <= 7:
        # "a las 5" casi siempre es por la tarde.
        h += 12
    if not (0 <= h <= 23 and 0 <= minute <= 59):
        return None
    return time(h, minute)


_TIME_SUFFIX = r"(?:\s*(?:h|hrs?|horas)\b)?(?:\s+de\s+la\s+(manana|tarde|noche)|\s*(am|pm)\b)?"
_RANGE_RE = re.compile(rf"\b(?:de|desde)\s+(?:las\s+)?(\d{{1,2}})(?::(\d{{2}}))?\s+(?:a|hasta)\s+(?:las\s+)?(\d{{1,2}})(?::(\d{{2}}))?{_TIME_SUFFIX}")
_AT_RE = re.compile(rf"\ba\s+las?\s+(\d{{1,2}})(?:[:.](\d{{2}}))?(?:\s+y\s+(media|cuarto))?{_TIME_SUFFIX}")
_CLOCK_RE = re.compile(r"\b(\d{1,2})[:.](\d{2})\b(?:\s*h\b)?")
_H_RE = re.compile(r"\b(\d{1,2})\s?h\b")
_PART_RE = re.compile(r"\b(?:por|a)\s+la\s+(manana|tarde|noche)\b|\ba\s+mediodia\b")
_IN_RE = re.compile(r"\b(?:en|dentro\s+de)\s+(\d{1,3}|un|una|media)\s+(minutos?|min|horas?|dias?|semanas?)\b")
_REL_RE = re.compile(r"\b(pasado\s+manana|manana|hoy|esta\s+noche|esta\s+tarde)\b")
_NEXT_WEEK_RE = re.compile(r"\b(?:la\s+)?(?:proxima\s+semana|semana\s+que\s+viene)\b")
_WEEKDAY_RE = re.compile(r"\b(?:el\s+)?(?:(proximo|este|que\s+viene)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+que\s+viene)?\b")
_DMY_RE = re.compile(r"\b(?:el\s+)?(?:dia\s+)?(\d{1,2})\s+de\s+(" + "|".join(MONTHS) + r")(?:\s+(?:de|del)\s+(\d{4}))?\b")
_SLASH_RE = re.compile(r"\b(?:el\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
_DAYNUM_RE = re.compile(r"\b(?:el\s+)?dia\s+(\d{1,2})\b")


def parse(text: str, now: datetime) -> When:
    folded = fold(text)
    cuts: list[tuple[int, int]] = []
    result = When()
    today = now.date()

    def take(m: re.Match) -> None:
        cuts.append(m.span())

    # Hora: rango "de 10 a 12", "a las 10:30", "18:00", "21h", "por la tarde"
    if m := _RANGE_RE.search(folded):
        suffix = m.group(5) or m.group(6)
        start = _hour(int(m.group(1)), int(m.group(2) or 0), suffix, True)
        end = _hour(int(m.group(3)), int(m.group(4) or 0), suffix, True)
        if start and end:
            result.at, result.end_at = start, end
            take(m)
    if result.at is None and (m := _AT_RE.search(folded)):
        minute = int(m.group(2) or 0) + {"media": 30, "cuarto": 15}.get(m.group(3) or "", 0)
        result.at = _hour(int(m.group(1)), minute, m.group(4) or m.group(5), True)
        if result.at:
            take(m)
    if result.at is None and (m := _CLOCK_RE.search(folded)):
        result.at = _hour(int(m.group(1)), int(m.group(2)), None, False)
        if result.at:
            take(m)
    if result.at is None and (m := _H_RE.search(folded)):
        result.at = _hour(int(m.group(1)), 0, None, False)
        if result.at:
            take(m)
    part = _PART_RE.search(folded)
    if part:
        if result.at is None:
            result.at = PARTS_OF_DAY[part.group(1) or "mediodia"]
        take(part)

    # Día
    if m := _IN_RE.search(folded):
        n = {"un": 1, "una": 1, "media": 0.5}.get(m.group(1)) or int(m.group(1))
        unit = UNITS[m.group(2)]
        moment = now + timedelta(**{unit: n})
        result.day = moment.date()
        if unit in ("minutes", "hours"):
            result.at = moment.time().replace(second=0, microsecond=0)
        take(m)
    elif (m := _REL_RE.search(folded)) and not (part and part.start() <= m.start() < part.end()):
        # ("mañana" dentro de "por la mañana" ya se usó como parte del día.)
        word = m.group(1)
        offsets = {"hoy": 0, "manana": 1}
        result.day = today + timedelta(days=2 if word.startswith("pasado") else offsets.get(word, 0))
        if word.startswith("esta") and result.at is None:
            result.at = PARTS_OF_DAY["noche" if "noche" in word else "tarde"]
        take(m)
    if result.day is None and (m := _DMY_RE.search(folded)):
        year = int(m.group(3)) if m.group(3) else today.year
        try:
            d = date(year, MONTHS[m.group(2)], int(m.group(1)))
            if not m.group(3) and d < today:
                d = d.replace(year=year + 1)
            result.day = d
            take(m)
        except ValueError:
            pass
    if result.day is None and (m := _SLASH_RE.search(folded)):
        year = int(m.group(3)) if m.group(3) else today.year
        if year < 100:
            year += 2000
        try:
            d = date(year, int(m.group(2)), int(m.group(1)))
            if not m.group(3) and d < today:
                d = d.replace(year=year + 1)
            result.day = d
            take(m)
        except ValueError:
            pass
    if result.day is None and (m := _WEEKDAY_RE.search(folded)):
        target = WEEKDAYS[m.group(2)]
        ahead = (target - today.weekday()) % 7
        # "el viernes" dicho un viernes es el de la semana que viene.
        if ahead == 0:
            ahead = 7
        result.day = today + timedelta(days=ahead)
        take(m)
    if result.day is None and (m := _NEXT_WEEK_RE.search(folded)):
        result.day = today + timedelta(days=7 - today.weekday())
        take(m)
    if result.day is None and (m := _DAYNUM_RE.search(folded)):
        n = int(m.group(1))
        try:
            d = today.replace(day=n)
            if d < today:
                d = (today.replace(day=1) + timedelta(days=32)).replace(day=n)
            result.day = d
            take(m)
        except ValueError:
            pass

    if result.at is not None and result.day is None:
        result.day = today if result.at > now.time() else today + timedelta(days=1)

    rest = text
    for start, end in sorted(cuts, reverse=True):
        rest = rest[:start] + " " + rest[end:]
    rest = re.sub(r"\s+", " ", rest).strip(" ,.;:-")
    rest = re.sub(r"\b(el|la|para|a|de)$", "", rest, flags=re.IGNORECASE).strip(" ,.;:-")
    result.rest = rest
    return result
