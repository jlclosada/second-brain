import { useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInMinutes, parseISO } from "date-fns";
import { BellRing, CalendarPlus, ChevronRight, FileWarning, GitPullRequest, MapPin, Pin, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CaptureBox } from "../components/Capture";
import { ConnectGoogleCard, EmailRow } from "../components/EmailParts";
import { CompactThread, DayThread, EventSheet, eventToDraft, newEventDraft, type EventDraft } from "../components/EventParts";
import { TaskRow, TaskSheet } from "../components/TaskParts";
import { Button, colorVar, cx, Empty, IconButton, Loading, Section } from "../components/ui";
import { api, type CalEvent, type Task } from "../lib/api";
import { capitalize, dayFromIso, fmt, relativeDay, time } from "../lib/dates";
import { GoLink, Page } from "../lib/nav";

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 6) return "Buenas noches";
  if (h < 14) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

function JournalBox({ body, day }: { body: string; day: string }) {
  const [text, setText] = useState(body);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setText(body), [body]);

  const save = (value: string) => {
    setText(value);
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const entry = await api.journal(day);
      await api.updateNote(entry.id, { body: value });
      queryClient.invalidateQueries({ queryKey: ["today"] });
      setState("saved");
    }, 700);
  };

  return (
    <div className="rounded-xl border border-line bg-surface">
      <label htmlFor="diario" className="sr-only">
        Diario de hoy
      </label>
      <textarea
        id="diario"
        value={text}
        onChange={(e) => save(e.target.value)}
        rows={4}
        placeholder="¿Qué ha pasado hoy? ¿Qué no quieres olvidar?"
        className="block w-full resize-y rounded-xl bg-transparent px-4 py-3 leading-relaxed placeholder:text-faint focus:outline-none"
      />
      <div className="flex items-center justify-between border-t border-line px-4 py-1.5 text-xs text-faint">
        <span aria-live="polite">{state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : "Se guarda solo"}</span>
      </div>
    </div>
  );
}

/** Lo que está pasando ahora o lo siguiente que viene hoy, con acceso directo a la videollamada. */
function NextUp({ events, onOpen }: { events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const timed = events.filter((e) => !e.all_day && parseISO(e.ends_at) > now);
  const current = timed.find((e) => parseISO(e.starts_at) <= now);
  const next = current ?? timed[0];
  if (!next) return null;
  const minutes = differenceInMinutes(parseISO(next.starts_at), now);
  const label = current
    ? `Ahora, hasta las ${time(next.ends_at)}`
    : minutes < 1
      ? "Empieza ya"
      : minutes < 60
        ? `En ${minutes} min, a las ${time(next.starts_at)}`
        : `A las ${time(next.starts_at)}`;
  const soon = !!current || minutes <= 15;

  return (
    <div className={cx("mb-8 flex items-stretch gap-4 rounded-2xl border bg-surface p-4", soon ? "border-ochre/60" : "border-line")}>
      <span className="w-1.5 shrink-0 rounded-full" style={{ background: colorVar(next.color) }} aria-hidden />
      <button type="button" onClick={() => onOpen(next)} className="min-w-0 flex-1 text-left">
        <p className={cx("text-sm font-medium", soon ? "text-ochre" : "text-muted")}>{label}</p>
        <p className="truncate text-lg font-semibold">{next.title}</p>
        {next.location && (
          <p className="flex items-center gap-1 truncate text-sm text-muted">
            <MapPin size={13} className="shrink-0" /> {next.location}
          </p>
        )}
      </button>
      {next.meet_url && (
        <a
          href={next.meet_url}
          target="_blank"
          rel="noreferrer"
          className={cx(
            "inline-flex shrink-0 items-center gap-1.5 self-center rounded-lg px-3.5 py-2 text-sm font-medium",
            soon ? "bg-moss text-white dark:text-paper" : "border border-line hover:bg-sunken",
          )}
        >
          <Video size={16} /> Unirse
        </a>
      )}
    </div>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export default function TodayPage() {
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, refetchInterval: 5 * 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const queryClient = useQueryClient();
  const [task, setTask] = useState<Task | null>(null);
  const [event, setEvent] = useState<EventDraft | null>(null);
  const now = new Date();

  const dismiss = async (id: string) => {
    await api.updateReminder(id, { dismissed: true });
    queryClient.invalidateQueries({ queryKey: ["today"] });
    toast("Recordatorio descartado");
  };

  if (today.isPending) return <Loading />;
  if (today.isError || !today.data) return <Empty title="No se pudo cargar el día">{(today.error as Error)?.message}</Empty>;
  const d = today.data;
  const day = dayFromIso(d.date);
  const pending = d.overdue.length + d.due_today.length;
  const mail = d.inbox?.counts.attention ?? 0;
  const reviews = d.github.reviews.length;
  const google = d.connections.google;

  const parts = [
    d.events.length ? plural(d.events.length, "evento", "eventos") : "ningún evento",
    pending ? plural(pending, "tarea", "tareas") : "ninguna tarea pendiente",
  ];
  if (d.inbox) parts.push(mail ? plural(mail, "correo por atender", "correos por atender") : "la bandeja al día");
  if (reviews) parts.push(plural(reviews, "revisión en GitHub", "revisiones en GitHub"));
  const summary = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
  const openEvent = (e: CalEvent) => setEvent(eventToDraft(e));

  return (
    <Page>
      <header className="mb-6">
        <p className="text-muted">{greeting(now)}.</p>
        <h1 className="font-display text-[2.3rem] leading-[1.05] font-semibold sm:text-[3.2rem]">{capitalize(fmt(day, "EEEE d 'de' MMMM"))}</h1>
        <p className="mt-2 text-lg text-muted">Hoy tienes {summary}.</p>
      </header>

      <div className="mb-6">
        <CaptureBox />
      </div>

      {(google === "off" || google === "reconnect") && (
        <div className="mb-8">
          <ConnectGoogleCard status={google} />
        </div>
      )}

      <NextUp events={d.events} onOpen={openEvent} />

      <div className="grid gap-x-12 gap-y-2 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {/* Agenda del día en móvil (en escritorio va en la columna derecha) */}
          <Section title="Agenda" className="xl:hidden" action={<AddEvent onClick={() => setEvent(newEventDraft(day, now.getHours() + 1))} />}>
            {d.events.length ? <CompactThread events={d.events} onOpen={openEvent} /> : <p className="text-muted">Nada en el calendario. Día libre.</p>}
          </Section>

          <Section title={pending ? `Tareas · ${pending}` : "Tareas"} action={<SeeAll to="/tareas" label="Todas las tareas" />}>
            {d.overdue.length > 0 && (
              <>
                <p className="mt-1 mb-1 text-sm font-medium text-clay">Vencidas</p>
                <ul className="divide-y divide-line">
                  {d.overdue.map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={setTask} />
                  ))}
                </ul>
              </>
            )}
            {d.due_today.length > 0 ? (
              <>
                {d.overdue.length > 0 && <p className="mt-4 mb-1 text-sm font-medium text-muted">Para hoy</p>}
                <ul className="divide-y divide-line">
                  {d.due_today.map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={setTask} />
                  ))}
                </ul>
              </>
            ) : (
              !d.overdue.length && (
                <p className="text-muted">
                  {d.counts.done_today
                    ? `Has completado ${d.counts.done_today} hoy. Todo al día.`
                    : "Nada pendiente para hoy. Apunta arriba lo que se te ocurra."}
                </p>
              )
            )}
          </Section>

          {d.inbox && (
            <Section title={mail ? `Correo por atender · ${mail}` : "Correo"} action={<SeeAll to="/bandeja" label="Ir a la bandeja" />}>
              {d.inbox.emails.length ? (
                <ul className="divide-y divide-line">
                  {d.inbox.emails.slice(0, 5).map((e) => (
                    <EmailRow key={e.id} email={e} dense />
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Nada sin leer ni importante en Principal. Bandeja al día.</p>
              )}
              {d.inbox.error && <p className="mt-2 text-sm text-clay">Gmail: {d.inbox.error}</p>}
            </Section>
          )}

          {d.github.connected && (reviews > 0 || d.github.assigned.length > 0) && (
            <Section title="GitHub" action={<SeeAll to="/tareas?etiqueta=github" label="Ver en tareas" />}>
              {reviews > 0 && (
                <>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-ochre">
                    <GitPullRequest size={14} /> Te piden revisión
                  </p>
                  <ul className="mb-3 divide-y divide-line">
                    {d.github.reviews.map((t) => (
                      <TaskRow key={t.id} task={t} onOpen={setTask} />
                    ))}
                  </ul>
                </>
              )}
              {d.github.assigned.length > 0 && (
                <>
                  <p className="mb-1 text-sm font-medium text-muted">Asignado a ti</p>
                  <ul className="divide-y divide-line">
                    {d.github.assigned.slice(0, 6).map((t) => (
                      <TaskRow key={t.id} task={t} onOpen={setTask} />
                    ))}
                  </ul>
                </>
              )}
            </Section>
          )}

          {(d.reminders.length > 0 || d.expiring.length > 0) && (
            <Section title="No lo olvides">
              <ul className="divide-y divide-line">
                {d.reminders.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <BellRing size={17} className={cx("shrink-0", r.sent_at ? "text-ochre" : "text-muted")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{r.title}</p>
                      <p className="text-sm text-muted tabular">
                        {relativeDay(r.remind_at)}, {time(r.remind_at)}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => dismiss(r.id)}>
                      Descartar
                    </Button>
                  </li>
                ))}
                {d.expiring.map((doc) => (
                  <li key={doc.id}>
                    <GoLink to={`/documentos/${doc.id}`} className="flex items-center gap-3 py-2.5 hover:text-cobalt">
                      <FileWarning size={17} className={cx("shrink-0", doc.days_left <= 7 ? "text-clay" : "text-ochre")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{doc.title}</p>
                        <p className="text-sm text-muted">
                          {doc.days_left === 0 ? "Vence hoy" : `Vence ${relativeDay(doc.expires_on)}, en ${doc.days_left} días`}
                        </p>
                      </div>
                    </GoLink>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Diario" action={<SeeAll to={`/diario/${d.date}`} label="Abrir el diario" />}>
            <JournalBox body={d.journal?.body ?? ""} day={d.date} />
          </Section>

          {d.pinned_notes.length > 0 && (
            <Section title="Notas fijadas" action={<SeeAll to="/notas" label="Todas las notas" />}>
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {d.pinned_notes.map((n) => (
                  <li key={n.id} className="border-t border-line">
                    <GoLink to={`/notas/${n.id}`} className="block py-3 hover:text-cobalt">
                      <p className="flex items-center gap-1.5 font-medium">
                        <Pin size={13} className="text-ochre" /> {n.title}
                      </p>
                      <p className="line-clamp-2 text-sm text-muted">{n.excerpt}</p>
                    </GoLink>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <footer className="flex flex-col gap-1 text-sm text-faint">
            {d.connections.github === "off" && (
              <GoLink to="/ajustes?seccion=conexiones" className="hover:text-ink">
                Conecta GitHub para ver aquí los PR que te piden revisar →
              </GoLink>
            )}
            {!me.data?.ai_enabled && <p>Sin clave de Claude: la captura usa reglas y el asistente está apagado. Añade ANTHROPIC_API_KEY en .env.</p>}
          </footer>
        </div>

        {/* El hilo del día (escritorio) */}
        <aside className="hidden xl:block">
          <div className="sticky top-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">El día</h2>
              <AddEvent onClick={() => setEvent(newEventDraft(day, now.getHours() + 1))} />
            </div>
            <DayThread events={d.events} day={day} onOpen={openEvent} />
          </div>
        </aside>
      </div>

      <TaskSheet task={task} onClose={() => setTask(null)} />
      <EventSheet draft={event} onClose={() => setEvent(null)} />
    </Page>
  );
}

function SeeAll({ to, label }: { to: string; label: string }) {
  return (
    <GoLink to={to} className="inline-flex items-center gap-0.5 text-sm text-cobalt">
      {label} <ChevronRight size={14} />
    </GoLink>
  );
}

function AddEvent({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Añadir evento" onClick={onClick}>
      <CalendarPlus size={18} />
    </IconButton>
  );
}
