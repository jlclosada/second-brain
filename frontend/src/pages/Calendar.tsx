import { useQuery } from "@tanstack/react-query";
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DayThread, EventSheet, eventToDraft, layoutLanes, newEventDraft, type EventDraft } from "../components/EventParts";
import { Button, colorVar, cx, Empty, IconButton, Loading, Segmented } from "../components/ui";
import { api, type CalEvent } from "../lib/api";
import { capitalize, dayFromIso, eventRange, fmt, isoDay, time } from "../lib/dates";
import { GoLink, Page } from "../lib/nav";

type View = "mes" | "semana" | "dia" | "agenda";
const WEEK = { weekStartsOn: 1 as const };
const HOUR = 48;

function range(view: View, anchor: Date): [Date, Date] {
  switch (view) {
    case "mes":
      return [startOfWeek(startOfMonth(anchor), WEEK), endOfWeek(endOfMonth(anchor), WEEK)];
    case "semana":
      return [startOfWeek(anchor, WEEK), endOfWeek(anchor, WEEK)];
    case "dia":
      return [anchor, anchor];
    case "agenda":
      return [anchor, addDays(anchor, 41)];
  }
}

const onDay = (events: CalEvent[], day: Date) =>
  events.filter((e) => {
    const s = parseISO(e.starts_at);
    const end = parseISO(e.ends_at);
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return s < addDays(dayStart, 1) && end > dayStart;
  });

function Chip({ e, onOpen }: { e: CalEvent; onOpen: (e: CalEvent) => void }) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(e);
      }}
      className="flex w-full items-center gap-1.5 truncate rounded px-1 text-left text-[0.78rem] leading-5 hover:bg-sunken"
      style={e.all_day ? { background: `color-mix(in srgb, ${colorVar(e.color)} 16%, transparent)` } : undefined}
    >
      {!e.all_day && <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorVar(e.color) }} />}
      {!e.all_day && <span className="text-muted tabular">{time(e.starts_at)}</span>}
      <span className="truncate">{e.title}</span>
    </button>
  );
}

function MonthView({
  anchor,
  events,
  onDayOpen,
  onOpen,
  onNew,
}: {
  anchor: Date;
  events: CalEvent[];
  onDayOpen: (d: Date) => void;
  onOpen: (e: CalEvent) => void;
  onNew: (d: Date) => void;
}) {
  const [start, end] = range("mes", anchor);
  const days = eachDayOfInterval({ start, end });
  const today = new Date();
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
        {["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const list = onDay(events, day);
          const current = isSameMonth(day, anchor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              onDoubleClick={() => onNew(day)}
              className={cx("min-h-[5.5rem] border-r border-b border-line p-1 last:border-r-0 sm:min-h-[7.5rem]", !current && "bg-sunken/50")}
            >
              <button
                type="button"
                onClick={() => onDayOpen(day)}
                aria-label={fmt(day, "EEEE d 'de' MMMM")}
                className={cx(
                  "mb-0.5 flex size-7 items-center justify-center rounded-full text-sm tabular",
                  isToday ? "bg-ochre font-semibold text-ink" : current ? "hover:bg-sunken" : "text-faint",
                )}
              >
                {day.getDate()}
              </button>
              {/* En móvil solo puntos; en escritorio, títulos */}
              <div className="flex flex-wrap gap-0.5 px-1 sm:hidden">
                {list.slice(0, 4).map((e) => (
                  <span key={`${e.id}-${e.starts_at}`} className="size-1.5 rounded-full" style={{ background: colorVar(e.color) }} />
                ))}
              </div>
              <div className="hidden flex-col gap-px sm:flex">
                {list.slice(0, 3).map((e) => (
                  <Chip key={`${e.id}-${e.starts_at}`} e={e} onOpen={onOpen} />
                ))}
                {list.length > 3 && (
                  <button type="button" onClick={() => onDayOpen(day)} className="px-1 text-left text-xs text-muted hover:text-ink">
                    {list.length - 3} más
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  anchor,
  events,
  onOpen,
  onNew,
}: {
  anchor: Date;
  events: CalEvent[];
  onOpen: (e: CalEvent) => void;
  onNew: (d: Date, hour: number) => void;
}) {
  const [start] = range("semana", anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const now = new Date();
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-[3.2rem_repeat(7,minmax(0,1fr))] border-b border-line">
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className="border-l border-line px-2 py-2 text-center">
            <div className="text-xs text-muted">{fmt(d, "EEE")}</div>
            <div
              className={cx(
                "mx-auto flex size-8 items-center justify-center rounded-full font-display text-lg tabular",
                isSameDay(d, now) && "bg-ochre font-semibold text-ink",
              )}
            >
              {d.getDate()}
            </div>
            <div className="mt-1 flex flex-col gap-px">
              {onDay(events, d)
                .filter((e) => e.all_day)
                .map((e) => (
                  <Chip key={`${e.id}-${e.starts_at}`} e={e} onOpen={onOpen} />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div
        className="scrollbar-thin relative max-h-[68vh] overflow-y-auto"
        ref={(el) => {
          if (el && el.scrollTop === 0) el.scrollTop = HOUR * 7.5;
        }}
      >
        <div className="grid grid-cols-[3.2rem_repeat(7,minmax(0,1fr))]" style={{ height: HOUR * 24 }}>
          <div className="relative">
            {hours.map((h) => (
              <span key={h} className="absolute right-2 text-[0.7rem] text-faint tabular" style={{ top: h * HOUR - 7 }}>
                {h ? `${String(h).padStart(2, "0")}:00` : ""}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const timed = onDay(events, d).filter((e) => !e.all_day);
            const lanes = layoutLanes(timed);
            const isToday = isSameDay(d, now);
            return (
              <div key={d.toISOString()} className="relative border-l border-line">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`Nuevo evento el ${fmt(d, "EEEE d")} a las ${h}:00`}
                    onClick={() => onNew(d, h)}
                    className="absolute inset-x-0 border-t border-line/60 hover:bg-sunken/60"
                    style={{ top: h * HOUR, height: HOUR }}
                  />
                ))}
                {timed.map((e) => {
                  const s = parseISO(e.starts_at);
                  const end = parseISO(e.ends_at);
                  const startH = isSameDay(s, d) ? s.getHours() + s.getMinutes() / 60 : 0;
                  const endH = isSameDay(end, d) ? end.getHours() + end.getMinutes() / 60 : 24;
                  const { lane, lanes: n } = lanes.get(e)!;
                  return (
                    <button
                      key={`${e.id}-${e.starts_at}`}
                      type="button"
                      onClick={() => onOpen(e)}
                      className="absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs"
                      style={{
                        top: startH * HOUR + 1,
                        height: Math.max(20, (endH - startH) * HOUR - 2),
                        left: `calc(${(lane / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                        borderColor: colorVar(e.color),
                        background: `color-mix(in srgb, ${colorVar(e.color)} 15%, var(--surface))`,
                      }}
                    >
                      <span className="block truncate font-medium">{e.title}</span>
                      <span className="block truncate text-muted tabular">{time(s)}</span>
                    </button>
                  );
                })}
                {isToday && (
                  <div
                    className="pointer-events-none absolute inset-x-0 flex items-center"
                    style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR - 4 }}
                  >
                    <span className="now-dot -ml-1 size-2 rounded-full bg-ochre" />
                    <span className="h-[2px] flex-1 bg-ochre" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgendaView({ anchor, events, onOpen }: { anchor: Date; events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  const days = eachDayOfInterval({ start: anchor, end: addDays(anchor, 41) })
    .map((d) => ({ d, list: onDay(events, d) }))
    .filter((x) => x.list.length);
  if (!days.length)
    return <Empty title="Nada en las próximas seis semanas">Añade un evento o conecta tu calendario de Google, iCloud u Outlook en Ajustes.</Empty>;
  return (
    <ol className="flex flex-col">
      {days.map(({ d, list }) => (
        <li key={d.toISOString()} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 border-t border-line py-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <div className={cx(isSameDay(d, new Date()) && "text-ochre")}>
            <div className="font-display text-2xl leading-none font-semibold tabular">{d.getDate()}</div>
            <div className="text-sm text-muted">{fmt(d, "EEE, MMM")}</div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {list.map((e) => (
              <li key={`${e.id}-${e.starts_at}`}>
                <button type="button" onClick={() => onOpen(e)} className="flex w-full items-baseline gap-3 rounded-lg px-2 py-1 text-left hover:bg-sunken">
                  <span className="mt-1.5 size-2 shrink-0 self-start rounded-full" style={{ background: colorVar(e.color) }} />
                  <span className="w-24 shrink-0 text-sm text-muted tabular">{eventRange(e.starts_at, e.ends_at, e.all_day)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.title}</span>
                    {e.location && <span className="block truncate text-sm text-muted">{e.location}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  const view = (params.get("vista") as View) || (isMobile ? "agenda" : "semana");
  const anchor = params.get("fecha") ? dayFromIso(params.get("fecha")!) : new Date(new Date().setHours(0, 0, 0, 0));
  const [draft, setDraft] = useState<EventDraft | null>(null);

  const [start, end] = range(view, anchor);
  const events = useQuery({
    queryKey: ["events", isoDay(start), isoDay(end)],
    queryFn: () => api.events(isoDay(start), isoDay(end)),
    placeholderData: (prev) => prev,
  });

  // Abrir un evento desde un enlace (?evento=id), p. ej. desde la búsqueda o un aviso.
  const linked = params.get("evento");
  useEffect(() => {
    if (!linked) return;
    api.event(linked).then(
      (e) => setDraft(eventToDraft(e)),
      () => undefined,
    );
  }, [linked]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const step = (dir: 1 | -1) => {
    const next =
      view === "mes" ? addMonths(anchor, dir) : view === "semana" ? addWeeks(anchor, dir) : view === "dia" ? addDays(anchor, dir) : addDays(anchor, dir * 14);
    set({ fecha: isoDay(next) });
  };

  const title = useMemo(() => {
    if (view === "mes") return capitalize(fmt(anchor, "MMMM yyyy"));
    if (view === "dia") return capitalize(fmt(anchor, "EEEE d 'de' MMMM"));
    if (view === "agenda") return "Próximas semanas";
    const [s, e] = range("semana", anchor);
    return s.getMonth() === e.getMonth() ? `${s.getDate()}–${e.getDate()} de ${fmt(e, "MMMM")}` : `${fmt(s, "d MMM")} – ${fmt(e, "d MMM")}`;
  }, [view, anchor]);

  const list = events.data ?? [];
  const open = (e: CalEvent) => setDraft(eventToDraft(e));

  return (
    <Page>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h1 className="mr-2 text-[1.9rem] leading-tight font-semibold sm:text-[2.2rem]">{title}</h1>
          <IconButton label="Anterior" onClick={() => step(-1)}>
            <ChevronLeft size={20} />
          </IconButton>
          <IconButton label="Siguiente" onClick={() => step(1)}>
            <ChevronRight size={20} />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={() => set({ fecha: null })}>
            Hoy
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<View>
            label="Vista"
            value={view}
            onChange={(v) => set({ vista: v })}
            options={[
              { value: "dia", label: "Día" },
              { value: "semana", label: "Semana" },
              { value: "mes", label: "Mes" },
              { value: "agenda", label: "Agenda" },
            ]}
          />
          <Button variant="primary" onClick={() => setDraft(newEventDraft(anchor, Math.min(new Date().getHours() + 1, 20)))}>
            <Plus size={17} /> Evento
          </Button>
        </div>
      </header>

      {events.isPending ? (
        <Loading />
      ) : view === "mes" ? (
        <MonthView
          anchor={anchor}
          events={list}
          onOpen={open}
          onDayOpen={(d) => set({ vista: "dia", fecha: isoDay(d) })}
          onNew={(d) => setDraft(newEventDraft(d))}
        />
      ) : view === "semana" ? (
        <WeekView anchor={anchor} events={list} onOpen={open} onNew={(d, h) => setDraft(newEventDraft(d, h))} />
      ) : view === "dia" ? (
        <div className="max-w-2xl">
          <DayThread events={list} day={anchor} onOpen={open} startHour={0} endHour={24} />
        </div>
      ) : (
        <AgendaView anchor={anchor} events={list} onOpen={open} />
      )}

      <p className="mt-6 text-sm text-faint">
        ¿Usas Google Calendar, iCloud u Outlook?{" "}
        <GoLink to="/ajustes#calendarios" className="text-cobalt">
          Conéctalos en Ajustes
        </GoLink>{" "}
        y sus eventos aparecerán aquí.
      </p>

      <EventSheet
        draft={draft}
        onClose={() => {
          setDraft(null);
          if (linked) set({ evento: null });
        }}
      />
    </Page>
  );
}
