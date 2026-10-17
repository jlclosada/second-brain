import { addDays, differenceInCalendarDays, format, formatDistanceToNowStrict, isSameDay, isToday, isTomorrow, isYesterday, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export const fmt = (date: Date | string, pattern: string) => format(typeof date === "string" ? parseISO(date) : date, pattern, { locale: es });

/** "2026-10-17" en hora local (no UTC). */
export const isoDay = (date: Date) => format(date, "yyyy-MM-dd");

/** Las fechas sin hora se interpretan en local, no en UTC. */
export const dayFromIso = (value: string) => parseISO(value.length === 10 ? `${value}T00:00:00` : value);

export const time = (value: string | Date) => fmt(value, "HH:mm");

export function relativeDay(value: string | Date): string {
  const d = typeof value === "string" ? dayFromIso(value) : value;
  if (isToday(d)) return "hoy";
  if (isTomorrow(d)) return "mañana";
  if (isYesterday(d)) return "ayer";
  const diff = differenceInCalendarDays(d, new Date());
  if (diff > 1 && diff < 7) return fmt(d, "EEEE");
  if (diff < -1 && diff > -7) return `el ${fmt(d, "EEEE")} pasado`;
  return fmt(d, d.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy");
}

export function dueLabel(dueDate: string | null, dueTime: string | null): string | null {
  if (!dueDate) return null;
  const day = relativeDay(dueDate);
  return dueTime ? `${day}, ${dueTime.slice(0, 5)}` : day;
}

export function isOverdue(dueDate: string | null): boolean {
  return !!dueDate && differenceInCalendarDays(dayFromIso(dueDate), new Date()) < 0;
}

export function ago(value: string) {
  return formatDistanceToNowStrict(parseISO(value), { locale: es, addSuffix: true });
}

export function eventRange(startsAt: string, endsAt: string, allDay: boolean) {
  const s = parseISO(startsAt);
  const e = parseISO(endsAt);
  if (allDay) {
    const last = addDays(e, -1);
    return isSameDay(s, last) ? "Todo el día" : `${fmt(s, "d MMM")} – ${fmt(last, "d MMM")}`;
  }
  return isSameDay(s, e) ? `${time(s)} – ${time(e)}` : `${fmt(s, "d MMM HH:mm")} – ${fmt(e, "d MMM HH:mm")}`;
}

/** Para <input type="datetime-local">: "2026-10-17T10:30" en hora local. */
export const toLocalInput = (value: string | Date) => format(typeof value === "string" ? parseISO(value) : value, "yyyy-MM-dd'T'HH:mm");

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
