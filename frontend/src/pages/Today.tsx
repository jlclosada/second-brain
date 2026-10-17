import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarPlus, FileWarning, Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CompactThread, DayThread, EventSheet, eventToDraft, newEventDraft, type EventDraft } from "../components/EventParts";
import { QuickAddTask, TaskRow, TaskSheet } from "../components/TaskParts";
import { Button, cx, Empty, IconButton, Loading, Section } from "../components/ui";
import { api, type Task } from "../lib/api";
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
        <GoLink to={`/diario/${day}`} className="hover:text-ink">
          Abrir el diario
        </GoLink>
      </div>
    </div>
  );
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
  const firstEvent = d.events.find((e) => !e.all_day && new Date(e.ends_at) > now);

  const summary = [
    d.events.length ? `${d.events.length} ${d.events.length === 1 ? "evento" : "eventos"}` : "sin eventos",
    pending ? `${pending} ${pending === 1 ? "tarea" : "tareas"}` : "ninguna tarea pendiente",
  ].join(" y ");

  return (
    <Page>
      <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <header className="mb-8">
            <p className="text-muted">{greeting(now)}.</p>
            <h1 className="font-display text-[2.6rem] leading-[1.05] font-semibold sm:text-[3.4rem]">{capitalize(fmt(day, "EEEE d 'de' MMMM"))}</h1>
            <p className="mt-2 text-lg text-muted">
              Hoy tienes {summary}
              {firstEvent && (
                <>
                  . Lo siguiente: <span className="text-ink">{firstEvent.title}</span> a las {time(firstEvent.starts_at)}
                </>
              )}
              .
            </p>
          </header>

          {/* Agenda del día en móvil (en escritorio va en la columna derecha) */}
          <Section title="Agenda" className="xl:hidden" action={<AddEvent onClick={() => setEvent(newEventDraft(day, now.getHours() + 1))} />}>
            {d.events.length ? (
              <CompactThread events={d.events} onOpen={(e) => setEvent(eventToDraft(e))} />
            ) : (
              <p className="text-muted">Nada en el calendario. Día libre.</p>
            )}
          </Section>

          <Section
            title="Tareas"
            action={
              <GoLink to="/tareas" className="text-sm text-cobalt">
                Ver todas
              </GoLink>
            }
          >
            <QuickAddTask placeholder="Añade una tarea: «llamar al taller el martes»…" />
            {d.overdue.length > 0 && (
              <>
                <p className="mt-4 mb-1 text-sm font-medium text-clay">Vencidas</p>
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
                <p className="mt-3 text-muted">
                  {d.counts.done_today ? `Has completado ${d.counts.done_today} hoy. Todo al día.` : "Nada pendiente para hoy."}
                </p>
              )
            )}
          </Section>

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

          <Section title="Diario">
            <JournalBox body={d.journal?.body ?? ""} day={d.date} />
          </Section>

          {d.pinned_notes.length > 0 && (
            <Section
              title="Notas fijadas"
              action={
                <GoLink to="/notas" className="text-sm text-cobalt">
                  Todas las notas
                </GoLink>
              }
            >
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

          {!me.data?.ai_enabled && (
            <p className="text-sm text-faint">
              Sin clave de Claude: la captura y la clasificación usan reglas. Añade ANTHROPIC_API_KEY para activar el asistente.
            </p>
          )}
        </div>

        {/* El hilo del día (escritorio) */}
        <aside className="hidden xl:block">
          <div className="sticky top-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">El día</h2>
              <AddEvent onClick={() => setEvent(newEventDraft(day, now.getHours() + 1))} />
            </div>
            <DayThread events={d.events} day={day} onOpen={(e) => setEvent(eventToDraft(e))} />
          </div>
        </aside>
      </div>

      <TaskSheet task={task} onClose={() => setTask(null)} />
      <EventSheet draft={event} onClose={() => setEvent(null)} />
    </Page>
  );
}

function AddEvent({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Añadir evento" onClick={onClick}>
      <CalendarPlus size={18} />
    </IconButton>
  );
}
