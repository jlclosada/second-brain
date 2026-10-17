"""Repeticiones (RFC 5545) para eventos y tareas.

Las reglas se evalúan en la hora local para que "todos los lunes a las 9"
siga siendo a las 9 cuando cambia el horario de verano.
"""

from datetime import UTC, date, datetime, timedelta

from dateutil.rrule import rrule, rrulestr

from app.config import get_settings

MAX_OCCURRENCES = 1000


def _rule(rule: str, dtstart: datetime) -> rrule:
    return rrulestr(rule, dtstart=dtstart)  # type: ignore[return-value]


def occurrences(rule: str, starts_at: datetime, ends_at: datetime,
                window_start: datetime, window_end: datetime) -> list[tuple[datetime, datetime]]:
    """Ocurrencias (inicio, fin) que se solapan con la ventana."""
    tz = get_settings().tz
    local_start = starts_at.astimezone(tz).replace(tzinfo=None)
    duration = ends_at - starts_at
    r = _rule(rule, local_start)
    lo = (window_start - duration).astimezone(tz).replace(tzinfo=None)
    hi = window_end.astimezone(tz).replace(tzinfo=None)
    result = []
    for occ in r.between(lo, hi, inc=True)[:MAX_OCCURRENCES]:
        start = occ.replace(tzinfo=tz).astimezone(UTC)
        end = start + duration
        if end > window_start and start < window_end:
            result.append((start, end))
    return result


def repeat_until(rule: str | None, starts_at: datetime) -> datetime | None:
    """Fin de la serie (para filtrar en SQL) o None si se repite siempre."""
    if not rule:
        return None
    upper = rule.upper()
    if "UNTIL=" not in upper and "COUNT=" not in upper:
        return None
    tz = get_settings().tz
    r = _rule(rule, starts_at.astimezone(tz).replace(tzinfo=None))
    last = None
    for last in r:  # noqa: B007  la serie es finita por UNTIL o COUNT
        pass
    if last is None:
        return starts_at
    return last.replace(tzinfo=tz).astimezone(UTC) + timedelta(days=1)


def next_date(rule: str, current: date) -> date | None:
    """Siguiente fecha de una tarea que se repite, después de `current`."""
    r = _rule(rule, datetime.combine(current, datetime.min.time()))
    nxt = r.after(datetime.combine(current, datetime.min.time()), inc=False)
    return nxt.date() if nxt else None


def describe(rule: str | None) -> str | None:
    """Texto corto en español para las reglas más habituales."""
    if not rule:
        return None
    parts = dict(p.split("=", 1) for p in rule.upper().split(";") if "=" in p)
    freq = parts.get("FREQ")
    interval = int(parts.get("INTERVAL", "1"))
    names = {"DAILY": ("cada día", "días"), "WEEKLY": ("cada semana", "semanas"),
             "MONTHLY": ("cada mes", "meses"), "YEARLY": ("cada año", "años")}
    if freq not in names:
        return "se repite"
    single, plural = names[freq]
    return single if interval == 1 else f"cada {interval} {plural}"
