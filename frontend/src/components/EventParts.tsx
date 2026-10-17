import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addHours, parseISO } from "date-fns";
import { MapPin, Repeat, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api, type CalEvent } from "../lib/api";
import { eventRange, fmt, isoDay, time, toLocalInput } from "../lib/dates";
import { REPEAT_OPTIONS } from "./TaskParts";
import { Button, colorVar, cx, Field, Input, Select, Sheet, Textarea } from "./ui";

export type EventDraft = Partial<CalEvent> & { starts_at: string };

const REMIND = [
  { value: "", label: "Sin aviso" },
  { value: "0", label: "A la hora" },
  { value: "10", label: "10 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 día antes" },
];

export function useCalendarRefresh() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["events"] });
    queryClient.invalidateQueries({ queryKey: ["today"] });
  };
}

export function EventSheet({ draft, onClose }: { draft: EventDraft | null; onClose: () => void }) {
  const refresh = useCalendarRefresh();
  const calendars = useQuery({ queryKey: ["calendars"], queryFn: api.calendars, enabled: !!draft });
  const [form, setForm] = useState<EventDraft | null>(draft);
  useEffect(() => setForm(draft), [draft]);

  const readOnly = form?.source === "ics";
  const isNew = !form?.id;
  const set = (patch: Partial<EventDraft>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const toIso = (v: string) => (form.all_day ? new Date(`${v.slice(0, 10)}T00:00:00`) : new Date(v)).toISOString();
    const body = {
      title: form.title ?? "",
      starts_at: toIso(form.starts_at),
      ends_at: form.ends_at ? toIso(form.ends_at) : undefined,
      all_day: !!form.all_day,
      location: form.location || null,
      description: form.description || null,
      rrule: form.rrule || null,
      remind_minutes: form.remind_minutes ?? null,
      calendar_id: form.calendar_id || undefined,
    };
    try {
      if (isNew) await api.createEvent(body);
      else await api.updateEvent(form.id!, body);
      refresh();
      onClose();
      toast(isNew ? "Evento añadido" : "Evento guardado");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!form?.id || !confirm(form.recurring ? "¿Eliminar este evento y todas sus repeticiones?" : "¿Eliminar este evento?")) return;
    await api.deleteEvent(form.id);
    refresh();
    onClose();
    toast("Evento eliminado");
  };

  const local = calendars.data?.filter((c) => c.source === "local") ?? [];

  return (
    <Sheet open={!!draft} onClose={onClose} title={readOnly ? "Evento" : isNew ? "Nuevo evento" : "Editar evento"}>
      {form &&
        (readOnly ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-xl font-semibold">{form.title}</h3>
            <p className="text-muted tabular">
              {fmt(form.starts_at, "EEEE d 'de' MMMM")}, {eventRange(form.starts_at, form.ends_at!, !!form.all_day).toLowerCase()}
            </p>
            {form.location && (
              <p className="flex items-center gap-2">
                <MapPin size={16} className="text-muted" /> {form.location}
              </p>
            )}
            {form.description && <p className="whitespace-pre-wrap text-sm text-muted">{form.description}</p>}
            <p className="text-sm text-faint">Viene de un calendario sincronizado. Para cambiarlo, edítalo en el original.</p>
          </div>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-4">
            <Field label="Título">
              {(id) => <Input id={id} value={form.title ?? ""} onChange={(e) => set({ title: e.target.value })} required autoFocus={isNew} />}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.all_day} onChange={(e) => set({ all_day: e.target.checked })} className="size-4 accent-[var(--cobalt)]" />
              Todo el día
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Empieza">
                {(id) => (
                  <Input
                    id={id}
                    type={form.all_day ? "date" : "datetime-local"}
                    value={form.all_day ? form.starts_at.slice(0, 10) : form.starts_at.slice(0, 16)}
                    onChange={(e) => set({ starts_at: e.target.value })}
                    required
                  />
                )}
              </Field>
              <Field label="Termina">
                {(id) => (
                  <Input
                    id={id}
                    type={form.all_day ? "date" : "datetime-local"}
                    value={form.ends_at ? (form.all_day ? form.ends_at.slice(0, 10) : form.ends_at.slice(0, 16)) : ""}
                    onChange={(e) => set({ ends_at: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field label="Lugar">{(id) => <Input id={id} value={form.location ?? ""} onChange={(e) => set({ location: e.target.value })} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Aviso">
                {(id) => (
                  <Select
                    id={id}
                    value={form.remind_minutes ?? ""}
                    onChange={(e) => set({ remind_minutes: e.target.value === "" ? null : Number(e.target.value) })}
                  >
                    {REMIND.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Repetir">
                {(id) => (
                  <Select id={id} value={form.rrule ?? ""} onChange={(e) => set({ rrule: e.target.value || null })}>
                    {REPEAT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {local.length > 1 && (
              <Field label="Calendario">
                {(id) => (
                  <Select id={id} value={form.calendar_id ?? local[0]?.id} onChange={(e) => set({ calendar_id: e.target.value })}>
                    {local.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Notas">
              {(id) => <Textarea id={id} rows={3} value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} />}
            </Field>
            {form.recurring && <p className="text-sm text-faint">Los cambios se aplican a toda la serie.</p>}
            <div className="flex items-center justify-between pt-2">
              {!isNew ? (
                <Button variant="danger" onClick={remove}>
                  <Trash2 size={16} /> Eliminar
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" variant="primary">
                {isNew ? "Añadir evento" : "Guardar evento"}
              </Button>
            </div>
          </form>
        ))}
    </Sheet>
  );
}

/** Borrador para un evento nuevo en un día y hora (en hora local). */
export function newEventDraft(day: Date, hour = 10): EventDraft {
  const start = new Date(day);
  start.setHours(hour, 0, 0, 0);
  return { title: "", starts_at: toLocalInput(start), ends_at: toLocalInput(addHours(start, 1)), all_day: false, remind_minutes: 30 };
}

/** Evento existente convertido a borrador editable (fechas en local). */
export function eventToDraft(e: CalEvent): EventDraft {
  if (e.all_day) {
    const end = parseISO(e.ends_at);
    end.setDate(end.getDate() - 1);
    return { ...e, starts_at: isoDay(parseISO(e.starts_at)), ends_at: isoDay(end) };
  }
  return { ...e, starts_at: toLocalInput(e.starts_at), ends_at: toLocalInput(e.ends_at) };
}

/** Reparte los eventos que se solapan en columnas: devuelve columna y nº de columnas. */
export function layoutLanes(events: CalEvent[]): Map<CalEvent, { lane: number; lanes: number }> {
  const sorted = [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || b.ends_at.localeCompare(a.ends_at));
  const out = new Map<CalEvent, { lane: number; lanes: number }>();
  let cluster: CalEvent[] = [];
  let laneEnds: string[] = [];
  let clusterEnd = "";
  const flush = () => {
    cluster.forEach((e) => (out.get(e)!.lanes = laneEnds.length));
    cluster = [];
    laneEnds = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.starts_at >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= e.starts_at);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e.ends_at);
    } else laneEnds[lane] = e.ends_at;
    out.set(e, { lane, lanes: 1 });
    cluster.push(e);
    clusterEnd = clusterEnd > e.ends_at && cluster.length > 1 ? clusterEnd : e.ends_at;
  }
  flush();
  return out;
}

/**
 * El hilo del día: una línea vertical de horas con los eventos colgando de
 * ella y el punto ocre del ahora. Es el elemento que identifica la app.
 */
export function DayThread({
  events,
  day,
  onOpen,
  startHour = 7,
  endHour = 23,
}: {
  events: CalEvent[];
  day: Date;
  onOpen: (e: CalEvent) => void;
  startHour?: number;
  endHour?: number;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const timed = events.filter((e) => !e.all_day);
  const allDay = events.filter((e) => e.all_day);
  const hours = (d: Date) => d.getHours() + d.getMinutes() / 60;
  const isToday = isoDay(day) === isoDay(now);
  const first = Math.min(startHour, ...timed.map((e) => Math.floor(hours(parseISO(e.starts_at)))), isToday ? Math.floor(hours(now)) : 24);
  const last = Math.min(24, Math.max(endHour, ...timed.map((e) => Math.ceil(hours(parseISO(e.ends_at)) || 24)), isToday ? Math.ceil(hours(now) + 0.01) : 0));
  const HOUR = 52;
  const nowTop = (hours(now) - first) * HOUR;
  const lanes = layoutLanes(timed);

  return (
    <div>
      {allDay.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {allDay.map((e) => (
            <li key={`${e.id}-${e.starts_at}`}>
              <button
                type="button"
                onClick={() => onOpen(e)}
                className="w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium"
                style={{ background: `color-mix(in srgb, ${colorVar(e.color)} 16%, transparent)` }}
              >
                {e.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative" style={{ height: (last - first) * HOUR }}>
        {Array.from({ length: last - first + 1 }, (_, i) => (
          <div key={i} className="absolute inset-x-0 flex items-center" style={{ top: i * HOUR - 8 }}>
            <span className="w-11 shrink-0 text-xs text-faint tabular">{String((first + i) % 24).padStart(2, "0")}:00</span>
            <span className="h-px flex-1 bg-line/70" />
          </div>
        ))}
        {/* El hilo */}
        <div className="absolute top-0 bottom-0 left-[3.4rem] w-[2px] rounded-full bg-line" />
        {isToday && nowTop >= 0 && nowTop <= (last - first) * HOUR && (
          <>
            <div className="absolute left-[3.4rem] w-[2px] rounded-full bg-ochre" style={{ top: 0, height: nowTop }} />
            <div className="absolute right-0 left-[3.4rem] flex items-center" style={{ top: nowTop - 5 }}>
              <span className="now-dot -ml-[4px] size-2.5 rounded-full bg-ochre" />
              <span className="h-[2px] flex-1 bg-ochre/70" />
              <span className="ml-1 rounded bg-ochre px-1 text-[0.7rem] font-semibold text-ink tabular">{time(now)}</span>
            </div>
          </>
        )}
        {timed.map((e) => {
          const s = parseISO(e.starts_at);
          const end = parseISO(e.ends_at);
          const top = (hours(s) - first) * HOUR;
          const height = Math.max(26, (hours(end) - hours(s) || 1) * HOUR - 4);
          const past = isToday && end < now;
          const { lane, lanes: n } = lanes.get(e)!;
          return (
            <button
              key={`${e.id}-${e.starts_at}`}
              type="button"
              onClick={() => onOpen(e)}
              className={cx(
                "absolute overflow-hidden rounded-lg border-l-[3px] px-2.5 py-1 text-left transition-opacity hover:brightness-95",
                past && "opacity-55",
              )}
              style={{
                top: top + 2,
                height,
                left: `calc(4.1rem + (100% - 4.35rem) * ${lane / n})`,
                width: `calc((100% - 4.35rem) / ${n} - 2px)`,
                borderColor: colorVar(e.color),
                background: `color-mix(in srgb, ${colorVar(e.color)} 13%, var(--surface))`,
              }}
            >
              <span className="block truncate text-sm font-medium">{e.title}</span>
              {height > 40 && (
                <span className="flex items-center gap-1 truncate text-xs text-muted tabular">
                  {time(s)} – {time(end)}
                  {e.location && <>, {e.location}</>}
                  {e.recurring && <Repeat size={11} className="ml-1" />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Versión compacta del hilo (móvil): solo los eventos, con el ahora intercalado. */
export function CompactThread({ events, onOpen }: { events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  const now = new Date();
  const timed = events.filter((e) => !e.all_day);
  const allDay = events.filter((e) => e.all_day);
  const nowIndex = timed.findIndex((e) => parseISO(e.starts_at) > now);
  const rows: (CalEvent | "now")[] = [...timed];
  rows.splice(nowIndex === -1 ? rows.length : nowIndex, 0, "now");

  return (
    <ol className="relative">
      <span aria-hidden className="absolute top-2 bottom-2 left-[3.65rem] w-[2px] rounded-full bg-line" />
      {allDay.map((e) => (
        <li key={`${e.id}-${e.starts_at}`} className="relative flex items-center gap-3 py-1.5">
          <span className="w-12 shrink-0 text-right text-xs text-muted">Todo el día</span>
          <span className="z-[1] size-2.5 shrink-0 rounded-full ring-4 ring-paper" style={{ background: colorVar(e.color) }} />
          <button type="button" onClick={() => onOpen(e)} className="min-w-0 truncate text-left font-medium">
            {e.title}
          </button>
        </li>
      ))}
      {rows.map((row) =>
        row === "now" ? (
          <li key="now" className="relative flex items-center gap-3 py-1.5" aria-label={`Ahora, ${time(now)}`}>
            <span className="w-12 shrink-0 text-right text-xs font-semibold text-ochre tabular">{time(now)}</span>
            <span className="now-dot z-[1] size-2.5 shrink-0 rounded-full bg-ochre ring-4 ring-paper" />
            <span className="h-[2px] flex-1 bg-ochre/60" />
          </li>
        ) : (
          <li key={`${row.id}-${row.starts_at}`} className={cx("relative flex items-start gap-3 py-2", parseISO(row.ends_at) < now && "opacity-50")}>
            <span className="w-12 shrink-0 pt-0.5 text-right text-sm text-muted tabular">{time(row.starts_at)}</span>
            <span className="z-[1] mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-paper" style={{ background: colorVar(row.color) }} />
            <button type="button" onClick={() => onOpen(row)} className="min-w-0 flex-1 text-left">
              <span className="block truncate font-medium">{row.title}</span>
              <span className="block truncate text-sm text-muted">
                hasta las {time(row.ends_at)}
                {row.location && `, ${row.location}`}
              </span>
            </button>
          </li>
        ),
      )}
    </ol>
  );
}
