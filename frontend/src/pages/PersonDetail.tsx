import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarPlus,
  Cake,
  Check,
  Gem,
  History,
  Loader2,
  Mail,
  Paperclip,
  Pencil,
  Phone,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { EventSheet, eventToDraft, newEventDraft, type EventDraft } from "../components/EventParts";
import { Markdown } from "../components/NoteEditor";
import { Badge, Button, cx, Empty, Field, IconButton, Input, Loading, Segmented, Sheet, Textarea } from "../components/ui";
import { api, type CalEvent, type Person, type PersonEntry, type PersonSection } from "../lib/api";
import { capitalize, dayFromIso, eventRange, fmt, isoDay, relativeDay } from "../lib/dates";
import { GoLink, Page, Shared } from "../lib/nav";
import { Avatar, entryDay } from "./People";

// La ficha de una persona: arriba, apuntar algo nuevo (con la fecha de hoy por defecto); a la
// izquierda, su historial por meses; a la derecha, lo que hay que tener presente antes de verla:
// próximas reuniones, cómo tratarle, pendientes, quién es y dónde más aparece.

const SECTIONS: { value: PersonSection; label: string; placeholder: (n: string) => string }[] = [
  { value: "Historial", label: "Ha pasado", placeholder: (n) => `¿Qué ha hecho o ha pasado con ${n}?` },
  { value: "Cómo tratarle", label: "Cómo tratarle", placeholder: () => "Preferencias, tono, temas a evitar…" },
  { value: "Pendiente", label: "Pendiente", placeholder: () => "Algo que le debes o queda por hacer" },
  { value: "Quién es", label: "Quién es", placeholder: () => "Cargo, cómo os conocisteis, familia…" },
];

function useSave(id: string) {
  const queryClient = useQueryClient();
  return async (fn: () => Promise<Person>, ok?: string) => {
    try {
      const p = await fn();
      queryClient.setQueryData(["person", id], p);
      queryClient.invalidateQueries({ queryKey: ["people"] });
      if (ok) toast(ok);
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      if ((err as { status?: number }).status === 409) queryClient.invalidateQueries({ queryKey: ["person", id] });
      return false;
    }
  };
}

function Composer({ person }: { person: Person }) {
  const save = useSave(person.id);
  const [section, setSection] = useState<PersonSection>("Historial");
  const [text, setText] = useState("");
  const [day, setDay] = useState(isoDay(new Date()));
  const [busy, setBusy] = useState(false);
  const first = person.name.split(" ")[0];
  const current = SECTIONS.find((s) => s.value === section)!;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await save(
      () => api.addPersonEntry(person.id, { text: text.trim(), section, date: section === "Historial" ? day : undefined }),
      section === "Historial" ? `Apuntado en el historial de ${first}` : `Apuntado en «${current.label}»`,
    );
    setBusy(false);
    if (ok) {
      setText("");
      setDay(isoDay(new Date()));
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <form onSubmit={submit} className="glass mb-8 rounded-xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Nueva entrada</p>
        <Segmented label="Dónde apuntarlo" value={section} onChange={setSection} options={SECTIONS.map(({ value, label }) => ({ value, label }))} />
      </div>
      <label className="sr-only" htmlFor="entry-text">
        Texto del apunte
      </label>
      <Textarea
        id="entry-text"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={current.placeholder(first)}
        maxLength={4000}
        className="resize-none text-[0.95rem]"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {section === "Historial" && (
          <>
            <label htmlFor="entry-date" className="text-sm text-muted">
              Fecha
            </label>
            <Input id="entry-date" type="date" value={day} max="2100-12-31" onChange={(e) => setDay(e.target.value || isoDay(new Date()))} className="h-9" style={{ width: "10.5rem" }} />
            {day !== isoDay(new Date()) && (
              <Button size="sm" variant="ghost" onClick={() => setDay(isoDay(new Date()))}>
                Hoy
              </Button>
            )}
          </>
        )}
        <span className="ml-auto hidden text-xs text-faint sm:inline">⌘↵ para guardar</span>
        <Button type="submit" variant="primary" size="sm" disabled={!text.trim() || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Apuntar
        </Button>
      </div>
    </form>
  );
}

/** Un apunte con sus acciones: editar (texto y fecha), completar si es pendiente, borrar. */
function EntryRow({ person, entry, dated, done }: { person: Person; entry: PersonEntry; dated?: boolean; done?: boolean }) {
  const save = useSave(person.id);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState(entry.text);
  const [day, setDay] = useState(entry.date ?? isoDay(new Date()));

  const commit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await save(() => api.editPersonEntry(person.id, entry.id, { text: text.trim(), date: dated ? day : undefined }))) setEditing(false);
  };

  if (editing) {
    return (
      <form onSubmit={commit} className="flex flex-col gap-2 py-2">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} autoFocus aria-label="Texto" />
        <div className="flex items-center gap-2">
          {dated && <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-9" style={{ width: "10.5rem" }} aria-label="Fecha" />}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
          <Button size="sm" type="submit" variant="primary">
            Guardar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="group flex items-start gap-2">
      {done && (
        <button
          type="button"
          onClick={() => save(() => api.completePersonEntry(person.id, entry.id), "Hecho: pasa al historial con fecha de hoy")}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-line-strong text-transparent transition-colors hover:border-moss hover:text-moss"
          aria-label={`Marcar como hecho: ${entry.text}`}
        >
          <Check size={13} strokeWidth={3} />
        </button>
      )}
      <p className="min-w-0 flex-1 text-[0.95rem] leading-relaxed break-words">
        {entry.text}
        {entry.attachments.length > 0 && (
          <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-xs text-faint">
            <Paperclip size={12} /> {entry.attachments.length}
          </span>
        )}
      </p>
      <div className={cx("flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100", confirm && "sm:opacity-100")}>
        {confirm ? (
          <>
            <Button size="sm" variant="danger" onClick={() => save(() => api.deletePersonEntry(person.id, entry.id), "Apunte borrado")}>
              Borrar
            </Button>
            <IconButton label="No borrar" onClick={() => setConfirm(false)} className="size-8">
              <X size={15} />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton label="Editar" onClick={() => setEditing(true)} className="size-8">
              <Pencil size={14} />
            </IconButton>
            <IconButton label="Borrar" onClick={() => setConfirm(true)} className="size-8 hover:text-clay">
              <Trash2 size={14} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

function Timeline({ person }: { person: Person }) {
  const groups = useMemo(() => {
    const out: { key: string; label: string; entries: PersonEntry[] }[] = [];
    for (const e of person.history) {
      const key = e.date ? e.date.slice(0, 7) : "sin-fecha";
      const label = e.date ? capitalize(fmt(dayFromIso(e.date), "MMMM yyyy")) : "Sin fecha";
      if (out.at(-1)?.key !== key) out.push({ key, label, entries: [] });
      out.at(-1)!.entries.push(e);
    }
    return out;
  }, [person.history]);

  if (!person.history.length)
    return (
      <Empty icon={<History size={22} />} title="Aún no hay nada en su historial">
        Apunta lo que vaya pasando: un ascenso, un cumpleaños, un acuerdo… Jarvis te lo recordará antes de veros.
      </Empty>
    );

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h3 className="eyebrow mb-2">{g.label}</h3>
          <ol className="relative ml-1.5 border-l border-line">
            {g.entries.map((e) => (
              <li key={e.id} className="relative pb-4 pl-5 last:pb-0">
                <span aria-hidden className="absolute top-2 -left-[5px] size-[9px] rounded-full bg-cobalt ring-4 ring-paper" />
                <p className="mb-0.5 text-xs font-medium text-faint tabular">
                  {e.date ? capitalize(fmt(dayFromIso(e.date), "EEEE d")) : "Sin fecha"}
                  {e.date && ["hoy", "ayer"].includes(relativeDay(e.date)) ? ` · ${relativeDay(e.date)}` : ""}
                </p>
                <EntryRow person={person} entry={e} dated />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Panel({ title, icon, children, action }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="glass rounded-xl p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {icon && <span className="text-faint">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EntryList({ person, entries, empty, done }: { person: Person; entries: PersonEntry[]; empty: string; done?: boolean }) {
  if (!entries.length) return <p className="text-sm text-faint">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((e) => (
        <li key={e.id}>
          <EntryRow person={person} entry={e} done={done} />
        </li>
      ))}
    </ul>
  );
}

function Meetings({ events, onOpen }: { events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {events.map((e) => (
        <li key={`${e.id}-${e.starts_at}`}>
          <button type="button" onClick={() => onOpen(e)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: `var(--${e.color || "cobalt"})` }} />
            <span className="min-w-0">
              <span className="block truncate text-[0.95rem]">{e.title}</span>
              <span className="block text-xs text-muted">
                {capitalize(relativeDay(e.starts_at))} · {eventRange(e.starts_at, e.ends_at, e.all_day)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EditPersonSheet({ person, open, onClose }: { person: Person; open: boolean; onClose: () => void }) {
  const save = useSave(person.id);
  const [form, setForm] = useState({
    relation: person.relation ?? "",
    company: person.company ?? "",
    role: person.role ?? "",
    email: person.email ?? "",
    phone: person.phone ?? "",
    birthday: person.birthday ?? "",
    aliases: person.aliases.join(", "),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await save(
      () =>
        api.updatePerson(person.id, {
          relation: form.relation.trim() || null,
          company: form.company.trim() || null,
          role: form.role.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          birthday: form.birthday || null,
          aliases: form.aliases
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
        }),
      "Ficha actualizada",
    );
    if (ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Datos de ${person.name}`} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Relación">{(id) => <Input id={id} value={form.relation} onChange={set("relation")} maxLength={60} placeholder="cliente, equipo…" />}</Field>
          <Field label="Empresa">{(id) => <Input id={id} value={form.company} onChange={set("company")} maxLength={200} />}</Field>
          <Field label="Cargo">{(id) => <Input id={id} value={form.role} onChange={set("role")} maxLength={200} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">{(id) => <Input id={id} type="email" value={form.email} onChange={set("email")} maxLength={200} />}</Field>
          <Field label="Teléfono">{(id) => <Input id={id} type="tel" value={form.phone} onChange={set("phone")} maxLength={40} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cumpleaños">{(id) => <Input id={id} type="date" value={form.birthday} onChange={set("birthday")} />}</Field>
          <Field label="También le llamas" hint="Separados por comas. Así Jarvis le reconoce en tus eventos.">
            {(id) => <Input id={id} value={form.aliases} onChange={set("aliases")} placeholder="Samu, Sam" />}
          </Field>
        </div>
        <p className="text-xs text-faint">El nombre se cambia renombrando la nota en Obsidian, para no romper los enlaces.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary">
            Guardar
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function Brief({ person, onClose }: { person: Person; onClose: () => void }) {
  const brief = useQuery({ queryKey: ["person-brief", person.id], queryFn: () => api.personBrief(person.id), staleTime: 5 * 60_000, retry: false });
  const fallback = [
    person.about[0] && `**Quién es:** ${person.about.map((e) => e.text).join(" ")}`,
    person.history.length && `**Lo último:**\n${person.history.slice(0, 3).map((e) => `- ${entryDay(e.date)}: ${e.text}`).join("\n")}`,
    person.how_to.length && `**Ten en cuenta:**\n${person.how_to.map((e) => `- ${e.text}`).join("\n")}`,
    person.todo.length && `**Pendiente:**\n${person.todo.map((e) => `- ${e.text}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return (
    <section className="mb-8 rounded-xl border border-cobalt/30 bg-cobalt-soft/40 p-4" aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-cobalt">
          <Sparkles size={15} /> Chuleta para tu próxima conversación
        </h2>
        <IconButton label="Cerrar la chuleta" onClick={onClose} className="size-8">
          <X size={15} />
        </IconButton>
      </div>
      {brief.isPending ? (
        <Loading label="Jarvis está repasando todo lo que sabes" />
      ) : brief.data?.markdown ? (
        <Markdown body={brief.data.markdown} />
      ) : (
        <>
          {brief.isError && <p className="mb-2 text-sm text-clay">{(brief.error as Error).message}</p>}
          {!brief.isError && !brief.data?.ai && <p className="mb-2 text-xs text-faint">Sin clave de Claude: resumen directo de la ficha.</p>}
          {fallback ? <Markdown body={fallback} /> : <p className="text-sm text-muted">Aún no hay nada apuntado sobre {person.name}.</p>}
        </>
      )}
    </section>
  );
}

export default function PersonPage() {
  const { id = "" } = useParams();
  const person = useQuery({ queryKey: ["person", id], queryFn: () => api.person(id) });
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(false);
  const [event, setEvent] = useState<EventDraft | null>(null);

  if (person.isPending) return <Loading />;
  if (!person.data) return <Empty title="Esta persona no existe" />;
  const p = person.data;
  const sub = [p.role, p.company].filter(Boolean).join(" · ");
  const next = p.upcoming[0];

  const scheduleMeeting = () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    setEvent({ ...newEventDraft(tomorrow, 10), title: `Reunión con ${p.name}` });
  };

  return (
    <Page>
      <GoLink to="/personas" type="nav-back" className="mb-4 inline-flex items-center gap-1.5 text-muted hover:text-ink">
        <ArrowLeft size={17} /> Personas
      </GoLink>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={p.name} size={56} />
          <div className="min-w-0">
            <Shared name={`person-${p.id}`}>
              <h1 className="text-[1.6rem] leading-tight font-semibold sm:text-[1.85rem]">{p.name}</h1>
            </Shared>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-muted">
              {sub || "Sin cargo ni empresa"}
              {p.relation && <Badge>{capitalize(p.relation)}</Badge>}
              {p.aliases.length > 0 && <span className="text-sm text-faint">También «{p.aliases.join("», «")}»</span>}
            </p>
            {next && (
              <p className="mt-1.5 text-sm text-cobalt">
                Os veis {relativeDay(next.starts_at)}, {eventRange(next.starts_at, next.ends_at, next.all_day).toLowerCase()} · {next.title}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setBrief(true)}>
            <Sparkles size={16} /> Preparar reunión
          </Button>
          <Button variant="quiet" onClick={scheduleMeeting}>
            <CalendarPlus size={16} /> Agendar
          </Button>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Editar
          </Button>
          <a href={p.obsidian_url} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 font-medium text-muted hover:bg-sunken hover:text-ink">
            <Gem size={16} /> Obsidian
          </a>
        </div>
      </header>

      {brief && <Brief person={p} onClose={() => setBrief(false)} />}
      <Composer person={p} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)]">
        <section aria-labelledby="historial">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="historial" className="text-base font-semibold">
              Historial
            </h2>
            <span className="text-sm text-faint">
              {p.history.length} {p.history.length === 1 ? "apunte" : "apuntes"}
            </span>
          </div>
          <Timeline person={p} />
        </section>

        <aside className="flex flex-col gap-4">
          {p.upcoming.length > 0 && (
            <Panel title="Próximas reuniones" icon={<CalendarPlus size={15} />}>
              <Meetings events={p.upcoming} onOpen={(e) => setEvent(eventToDraft(e))} />
            </Panel>
          )}
          <Panel title="Cómo tratarle">
            <EntryList person={p} entries={p.how_to} empty="Preferencias, tono, temas a evitar… apúntalo arriba en «Cómo tratarle»." />
          </Panel>
          <Panel title="Pendiente" action={p.todo.length ? <Badge tone="warning">{p.todo.length}</Badge> : undefined}>
            <EntryList person={p} entries={p.todo} empty="Nada pendiente con esta persona." done />
          </Panel>
          <Panel title="Quién es">
            <EntryList person={p} entries={p.about} empty="Cargo, cómo os conocisteis, familia…" />
            {(p.email || p.phone || p.birthday) && (
              <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
                {p.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="text-faint" />
                    <dt className="sr-only">Email</dt>
                    <dd className="min-w-0 truncate">
                      <a href={`mailto:${p.email}`} className="hover:text-cobalt">
                        {p.email}
                      </a>
                    </dd>
                  </div>
                )}
                {p.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={14} className="text-faint" />
                    <dt className="sr-only">Teléfono</dt>
                    <dd>
                      <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="hover:text-cobalt">
                        {p.phone}
                      </a>
                    </dd>
                  </div>
                )}
                {p.birthday && (
                  <div className="flex items-center gap-2">
                    <Cake size={14} className="text-faint" />
                    <dt className="sr-only">Cumpleaños</dt>
                    <dd>{fmt(dayFromIso(p.birthday), "d 'de' MMMM")}</dd>
                  </div>
                )}
              </dl>
            )}
          </Panel>
          {Object.entries(p.other_sections).map(([title, entries]) => (
            <Panel key={title} title={title}>
              <EntryList person={p} entries={entries} empty="" />
            </Panel>
          ))}
          {p.past_meetings.length > 0 && (
            <Panel title="Reuniones anteriores">
              <Meetings events={p.past_meetings.slice(0, 5)} onOpen={(e) => setEvent(eventToDraft(e))} />
            </Panel>
          )}
          {p.mentions.length > 0 && (
            <Panel title="Aparece en tus notas" icon={<Gem size={15} />}>
              <ul className="flex flex-col gap-2.5">
                {p.mentions.map((m) => (
                  <li key={m.id}>
                    <a href={m.obsidian_url} className="group block">
                      <span className="flex items-center gap-1 text-[0.95rem] font-medium group-hover:text-cobalt">
                        {m.title} <ArrowUpRight size={13} className="text-faint" />
                      </span>
                      <span className="line-clamp-2 text-sm text-muted">{m.snippet}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {p.emails.length > 0 && (
            <Panel title="Sus últimos correos" icon={<Mail size={15} />}>
              <ul className="flex flex-col gap-2">
                {p.emails.map((e) => (
                  <li key={e.id}>
                    <GoLink to={`/bandeja?correo=${e.id}`} className="group block">
                      <span className="block truncate text-[0.95rem] group-hover:text-cobalt">{e.subject}</span>
                      <span className="block text-xs text-muted">{capitalize(relativeDay(e.received_at))}</span>
                    </GoLink>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>

      {editing && <EditPersonSheet person={p} open onClose={() => setEditing(false)} />}
      <EventSheet draft={event} onClose={() => setEvent(null)} />
    </Page>
  );
}
