import { useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInMinutes, parseISO } from "date-fns";
import {
  ArrowUp,
  Check,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  FolderSync,
  GitPullRequest,
  Inbox,
  MapPin,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  Video,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import { useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { describeCapture } from "../components/Capture";
import { ConnectGoogleCard, EmailRow } from "../components/EmailParts";
import { CompactThread, EventSheet, eventToDraft, newEventDraft, type EventDraft } from "../components/EventParts";
import Orb, { type OrbState } from "../components/Orb";
import { TaskRow, TaskSheet } from "../components/TaskParts";
import { colorVar, cx } from "../components/ui";
import { api, streamChat, type CalEvent, type ChatAction, type PersonCard, type Task } from "../lib/api";
import { ago, capitalize, fmt, time } from "../lib/dates";
import { GoLink, Page } from "../lib/nav";
import { readAloudPref, setReadAloudPref, useVoice } from "../lib/voice";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions: ChatAction[];
  working?: string | null;
  streaming?: boolean;
  error?: boolean;
  // Miniaturas de lo adjuntado (solo durante esta visita)
  images?: string[];
};
type Pending = { file: File; preview: string; id?: string; uploading: boolean };

const TOOL_LABEL: Record<string, string> = {
  buscar: "Buscando en tu memoria",
  leer_nota: "Leyendo una nota",
  ver_elemento: "Abriendo un documento",
  agenda: "Mirando tu agenda",
  correo_pendiente: "Revisando tu correo",
  tareas_pendientes: "Repasando tus tareas",
  crear_tarea: "Creando la tarea",
  completar_tarea: "Marcando la tarea",
  crear_evento: "Añadiendo a tu calendario",
  crear_nota: "Guardando en tu vault",
  crear_recordatorio: "Programando el aviso",
  leer_correo: "Leyendo el correo",
  cambiar_evento: "Cambiando el evento",
  cancelar_evento: "Cancelando el evento",
  borrar_tarea: "Borrando la tarea",
  redactar_respuesta: "Redactando la respuesta",
  escribir_en_diario: "Escribiendo en tu diario",
};

const SUGGESTIONS = ["¿Qué tengo hoy?", "Resume los correos que debo contestar", "Ponme el dentista el jueves a las 10", "¿Qué tengo pendiente en Verifactu?"];

const STORE = "jarvis:conversacion";
const load = (): { id?: string; messages: Message[] } => {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) || "") as { id?: string; messages: Message[] };
  } catch {
    return { messages: [] };
  }
};

function greeting(now: Date) {
  const h = now.getHours();
  return h < 6 ? "Buenas noches" : h < 14 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// --- La conversación ----------------------------------------------------------------------

function ActionChip({ action, i }: { action: ChatAction; i: number }) {
  const body = (
    <>
      <Sparkles size={12} className="shrink-0 text-cobalt" />
      <span className="truncate">{action.summary}</span>
      {action.link && <ChevronRight size={12} className="shrink-0 opacity-60" />}
    </>
  );
  const cls = "glass inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[0.8rem] text-muted transition-colors hover:text-ink";
  const external = action.link && /^(https?:|obsidian:)/.test(action.link);
  return (
    <motion.span initial={{ opacity: 0, y: 6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.05 }}>
      {action.link && external ? (
        <a href={action.link} target={action.link.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cls}>
          {body}
        </a>
      ) : action.link ? (
        <GoLink to={action.link} className={cls}>
          {body}
        </GoLink>
      ) : (
        <span className={cls}>{body}</span>
      )}
    </motion.span>
  );
}

/** La respuesta que redactó Jarvis: la revisas, la cambias si quieres y la envías tú. */
function DraftCard({ data }: { data: Record<string, string> }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState(data.body ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const send = async () => {
    setState("sending");
    try {
      await api.sendDraft(data.draft_id, { email_id: data.email_id, body: body !== data.body ? body : undefined });
      setState("sent");
      toast.success(`Enviado a ${data.to}`);
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["today"] });
    } catch (e) {
      setState("idle");
      toast.error((e as Error).message);
    }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass mt-3 overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 text-sm">
        <span className="eyebrow">Borrador</span>
        <span className="text-muted">
          Para <span className="text-ink">{data.to}</span>
        </span>
        <span className="min-w-0 truncate text-muted">{data.subject}</span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={state !== "idle"}
        aria-label="Texto de la respuesta"
        className="block w-full resize-none bg-transparent px-4 py-3 leading-relaxed focus:outline-none focus-visible:outline-none disabled:opacity-70"
        style={{ fieldSizing: "content", minHeight: "6rem" } as React.CSSProperties}
      />
      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <a href="https://mail.google.com/mail/#drafts" target="_blank" rel="noreferrer" className="px-1 text-xs text-faint hover:text-ink">
          También está en tus borradores de Gmail
        </a>
        {state === "sent" ? (
          <span className="inline-flex items-center gap-1.5 px-2 text-sm text-moss">
            <Check size={15} /> Enviado
          </span>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={state === "sending" || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
          >
            <Send size={14} /> {state === "sending" ? "Enviando…" : "Enviar"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function Bubble({ m }: { m: Message }) {
  if (m.role === "user")
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end gap-1.5">
        {!!m.images?.length && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {m.images.map((src) => (
              <img key={src} src={src} alt="" className="size-24 rounded-xl object-cover ring-1 ring-line" />
            ))}
          </div>
        )}
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-cobalt-soft px-4 py-2.5 whitespace-pre-wrap text-ink">{m.text}</p>
      </motion.div>
    );
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <span
        aria-hidden
        className="mt-1.5 size-3 shrink-0 rounded-full shadow-[0_0_14px_rgba(122,167,255,0.9)]"
        style={{ background: "radial-gradient(circle at 35% 35%, #dfe8ff, #7aa7ff 45%, #8b5cf6)" }}
      />
      <div className="min-w-0 flex-1">
        {m.text ? (
          <div className={cx("prose-brain text-[1.02rem]", m.streaming && "caret", m.error && "text-clay")}>
            <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
          </div>
        ) : (
          m.streaming && (
            <p className="flex items-center gap-2 text-muted">
              <span className="pulse-dot size-1.5 rounded-full bg-cobalt text-cobalt" />
              {m.working ?? "Pensando…"}
            </p>
          )
        )}
        {m.text && m.streaming && m.working && <p className="mt-1 text-sm text-faint">{m.working}…</p>}
        {m.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.actions.map((a, i) => (
              <ActionChip key={i} action={a} i={i} />
            ))}
          </div>
        )}
        {m.actions
          .filter((a) => a.tool === "redactar_respuesta" && a.data?.draft_id)
          .map((a) => (
            <DraftCard key={a.data!.draft_id} data={a.data!} />
          ))}
      </div>
    </motion.div>
  );
}

// --- Las tarjetas del día ----------------------------------------------------------------------

function Card({
  title,
  icon,
  action,
  className,
  children,
  i = 0,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  i?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + i * 0.06, type: "spring", stiffness: 140, damping: 20 }}
      className={cx("glass glass-hover flex min-w-0 flex-col rounded-3xl p-5", className)}
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="text-faint">{icon}</span>
        <h2 className="eyebrow flex-1">{title}</h2>
        {action}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </motion.section>
  );
}

function SeeAll({ to, label = "Ver todo" }: { to: string; label?: string }) {
  return (
    <GoLink to={to} className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-ink">
      {label} <ChevronRight size={13} />
    </GoLink>
  );
}

/** «Con Óscar Martín»: lo último que pasó y cómo tratarle, para llegar preparado. */
function PeopleHint({ cards }: { cards: PersonCard[] }) {
  return (
    <div className="flex flex-col gap-2">
      {cards.slice(0, 2).map((p) => (
        <a key={p.ruta} href={p.obsidian_url} className="block rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-sm transition-colors hover:bg-white/[0.07]">
          <p className="flex items-center gap-1.5 font-medium">
            <UserRound size={14} className="text-cobalt" /> {p.nombre}
            {(p.empresa || p.relacion) && <span className="font-normal text-faint">· {[p.relacion, p.empresa].filter(Boolean).join(", ")}</span>}
          </p>
          {p.ultimo[0] && <p className="mt-0.5 line-clamp-2 text-muted">Último: {p.ultimo[0]}</p>}
          {p.como_tratarle[0] && <p className="line-clamp-1 text-muted">Ten en cuenta: {p.como_tratarle[0]}</p>}
          {p.pendiente[0] && <p className="line-clamp-1 text-ochre">Pendiente: {p.pendiente[0]}</p>}
        </a>
      ))}
    </div>
  );
}

function NowCard({ events, people, onOpen }: { events: CalEvent[]; people: Record<string, PersonCard[]>; onOpen: (e: CalEvent) => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const timed = events.filter((e) => !e.all_day && parseISO(e.ends_at) > now);
  const current = timed.find((e) => parseISO(e.starts_at) <= now);
  const next = current ?? timed[0];
  if (!next) return <p className="text-muted">Nada más en tu agenda hoy. Tiempo libre.</p>;
  const minutes = differenceInMinutes(parseISO(next.starts_at), now);
  const label = current ? `Ahora · hasta las ${time(next.ends_at)}` : minutes < 60 ? `En ${Math.max(minutes, 0)} min` : `A las ${time(next.starts_at)}`;
  const soon = !!current || minutes <= 15;
  const progress = current ? (now.getTime() - parseISO(next.starts_at).getTime()) / (parseISO(next.ends_at).getTime() - parseISO(next.starts_at).getTime()) : 0;
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <button type="button" onClick={() => onOpen(next)} className="text-left">
        <p className={cx("mono text-sm", soon ? "text-ochre" : "text-muted")}>{label}</p>
        <p className="mt-1 font-display text-2xl leading-tight font-semibold">{next.title}</p>
        {next.location && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted">
            <MapPin size={13} /> {next.location}
          </p>
        )}
      </button>
      {people[next.id]?.length ? <PeopleHint cards={people[next.id]} /> : null}
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <motion.div
            className="h-full rounded-full"
            style={{ background: colorVar(next.color) }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        {next.meet_url && (
          <a
            href={next.meet_url}
            target="_blank"
            rel="noreferrer"
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium",
              soon ? "bg-moss text-paper" : "glass text-ink",
            )}
          >
            <Video size={15} /> Unirse
          </a>
        )}
      </div>
    </div>
  );
}

// --- La página -----------------------------------------------------------------------------------

export default function JarvisPage() {
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, refetchInterval: 2 * 60_000 });
  const memory = useQuery({ queryKey: ["memory-status"], queryFn: api.memoryStatus, refetchInterval: 20_000 });
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => api.activity(6), refetchInterval: 20_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  const initial = useMemo(load, []);
  const [messages, setMessages] = useState<Message[]>(initial.messages.map((m) => ({ ...m, streaming: false, working: null, images: undefined })));
  const [convId, setConvId] = useState<string | undefined>(initial.id);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [aloud, setAloud] = useState(readAloudPref);
  const [task, setTask] = useState<Task | null>(null);
  const [event, setEvent] = useState<EventDraft | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const aiEnabled = memory.data?.ai_enabled ?? me.data?.ai_enabled ?? false;

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ id: convId, messages: messages.slice(-30) }));
    } catch {
      /* sin almacenamiento */
    }
  }, [messages, convId]);

  const ask = useCallback(
    async (raw: string, spoken = false) => {
      const ready = files.filter((f) => f.id);
      const question = raw.trim() || (ready.length ? "Mira esto." : "");
      if (!question || busy || files.some((f) => f.uploading)) return;
      setText("");
      setFiles([]);
      const attachmentIds = ready.map((f) => f.id!);
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        text: question,
        actions: [],
        images: ready.filter((f) => f.file.type.startsWith("image/")).map((f) => f.preview),
      };
      const replyId = crypto.randomUUID();
      setMessages((ms) => [...ms, userMsg, { id: replyId, role: "assistant", text: "", actions: [], streaming: true, working: null }]);
      requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
      const patch = (fn: (m: Message) => Message) => setMessages((ms) => ms.map((m) => (m.id === replyId ? fn(m) : m)));

      if (!aiEnabled) {
        // Sin clave de Claude, Jarvis al menos apunta lo que le dices.
        try {
          const r = await api.capture(question);
          patch((m) => ({
            ...m,
            streaming: false,
            text: `Apuntado como **${r.kind === "event" ? "evento" : r.kind === "reminder" ? "aviso" : r.kind === "note" ? "nota en tu vault" : "tarea"}**: ${r.title || question} (${describeCapture(r)}).\n\nPara conversar conmigo de verdad, añade tu clave de Claude en \`.env\`.`,
          }));
          queryClient.invalidateQueries();
        } catch (e) {
          patch((m) => ({ ...m, streaming: false, error: true, text: (e as Error).message }));
        }
        return;
      }

      setBusy(true);
      abort.current = new AbortController();
      let stepHadTools = false;
      let finalText = "";
      try {
        await streamChat(
          question,
          convId,
          (e) => {
            if (e.type === "start") setConvId(e.conversation_id);
            else if (e.type === "step") {
              // El texto de un paso que acabó usando herramientas era «pensar en voz alta»: se sustituye.
              if (stepHadTools) patch((m) => ({ ...m, text: "" }));
              stepHadTools = false;
            } else if (e.type === "text") patch((m) => ({ ...m, text: m.text + e.delta, working: null }));
            else if (e.type === "tool") {
              stepHadTools = true;
              patch((m) => ({ ...m, working: TOOL_LABEL[e.tool] ?? "Trabajando" }));
            } else if (e.type === "action") {
              patch((m) => ({ ...m, actions: [...m.actions, e.action] }));
            } else if (e.type === "done") {
              finalText = e.reply.text;
              patch((m) => ({ ...m, text: e.reply.text, actions: e.reply.actions, streaming: false, working: null }));
              if (e.reply.actions.some((a) => /^(crear|completar|cambiar|cancelar|borrar)/.test(a.tool) || a.tool === "escribir_en_diario"))
                queryClient.invalidateQueries();
            } else if (e.type === "error") {
              patch((m) => ({ ...m, text: e.message, error: true, streaming: false, working: null }));
            }
          },
          abort.current.signal,
          attachmentIds,
        );
        if (finalText && (aloud || spoken)) voice.speak(finalText);
      } catch (e) {
        if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, text: (e as Error).message, error: true, streaming: false }));
        else patch((m) => ({ ...m, streaming: false, working: null, text: m.text || "_Interrumpido._" }));
      } finally {
        setBusy(false);
        abort.current = null;
        requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, convId, aiEnabled, aloud, queryClient, files],
  );

  const voice = useVoice({ onFinal: (t) => ask(t, true) });

  // Mantén pulsada la barra espaciadora (fuera de un campo de texto) para hablar.
  useEffect(() => {
    if (!voice.supported) return;
    const typing = (el: EventTarget | null) => (el as HTMLElement)?.closest?.("input, textarea, select, [contenteditable=true]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e.target) || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      voice.start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target)) voice.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [voice]);

  useEffect(() => {
    if (!voice.error) return;
    toast.error(voice.error, { duration: 8000 });
    // Siempre queda escribir (o dictar con el micro del teclado del móvil).
    input.current?.focus();
  }, [voice.error]);

  // /?q=… llega desde otras pantallas («Preguntar a Jarvis sobre esta nota»).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const q = params.get("q");
    if (q && !memory.isPending) {
      setParams({}, { replace: true });
      ask(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, memory.isPending]);

  const orbState: OrbState = voice.listening ? "listening" : busy ? "thinking" : voice.speaking ? "speaking" : "idle";
  const talking = messages.length > 0;

  const attach = async (picked: File[]) => {
    const valid = picked.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf").slice(0, 8 - files.length);
    if (!valid.length) return;
    const pending: Pending[] = valid.map((file) => ({ file, preview: URL.createObjectURL(file), uploading: true }));
    setFiles((fs) => [...fs, ...pending]);
    try {
      const uploaded = await api.chatAttach(valid);
      setFiles((fs) =>
        fs.map((f) => {
          const i = pending.findIndex((p) => p.preview === f.preview);
          return i === -1 ? f : { ...f, id: uploaded[i]?.id, uploading: false };
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
      setFiles((fs) => fs.filter((f) => !pending.some((p) => p.preview === f.preview)));
    }
    input.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };

  const newConversation = () => {
    abort.current?.abort();
    voice.silence();
    setMessages([]);
    setConvId(undefined);
    input.current?.focus();
  };

  // El parte del día, en una frase.
  const d = today.data;
  const now = new Date();
  const briefing = useMemo(() => {
    if (!d) return "";
    const parts: string[] = [];
    const next = d.events.find((e) => !e.all_day && parseISO(e.ends_at) > now);
    if (next) parts.push(`lo siguiente es «${next.title}» a las ${time(next.starts_at)}`);
    else if (d.events.length) parts.push(`no te quedan más eventos hoy`);
    else parts.push("tu agenda está libre");
    const pending = d.overdue.length + d.due_today.length;
    if (pending)
      parts.push(
        `${plural(pending, "tarea", "tareas")} por hacer${d.overdue.length ? ` (${d.overdue.length} vencida${d.overdue.length > 1 ? "s" : ""})` : ""}`,
      );
    const mail = d.inbox?.counts.attention ?? 0;
    if (mail) parts.push(plural(mail, "correo espera respuesta", "correos esperan respuesta"));
    if (d.github.reviews.length) parts.push(plural(d.github.reviews.length, "revisión pendiente en GitHub", "revisiones pendientes en GitHub"));
    const first = capitalize(parts[0]);
    return parts.length > 1 ? `${first}; ${parts.slice(1, -1).join(", ")}${parts.length > 2 ? " y " : ""}${parts.at(-1)}.` : `${first}.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const name = me.data?.prefs.name;
  const pending = d ? [...d.overdue, ...d.due_today] : [];
  const google = d?.connections.google;
  const filedToday = activity.data?.filter((a) => a.title.startsWith("Archivado") && Date.now() - new Date(a.at).getTime() < 86_400_000).length ?? 0;

  return (
    <Page>
      {/* El núcleo y la conversación */}
      <section
        className={cx("relative mx-auto flex max-w-3xl flex-col items-center text-center transition-[padding] duration-700", talking ? "pt-0" : "pt-[4vh]")}
      >
        <motion.div layout transition={{ type: "spring", stiffness: 90, damping: 18 }}>
          <button
            type="button"
            onClick={() => (voice.listening ? voice.stop() : voice.supported ? voice.start() : input.current?.focus())}
            aria-label={voice.listening ? "Dejar de escuchar" : "Hablar con Jarvis"}
            className="rounded-full focus-visible:outline-offset-8"
          >
            <Orb state={orbState} level={voice.level} size={talking ? 132 : 250} />
          </button>
        </motion.div>

        <p className="eyebrow mt-2 flex items-center gap-2">
          <span
            className={cx("size-1.5 rounded-full", busy ? "pulse-dot bg-violet text-violet" : voice.listening ? "pulse-dot bg-cyan text-cyan" : "bg-moss")}
          />
          Jarvis · {voice.listening ? "escuchando" : busy ? "pensando" : voice.speaking ? "hablando" : aiEnabled ? "en línea" : "modo básico"} ·{" "}
          <span className="tabular">{fmt(now, "HH:mm")}</span>
        </p>

        <AnimatePresence initial={false}>
          {!talking && (
            <motion.div
              key="hello"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              className="mt-4"
            >
              <h1 className="text-glow font-display text-[2.2rem] leading-[1.05] font-semibold sm:text-[3.1rem]">
                {greeting(now)}
                {name ? `, ${name}` : ""}.
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-lg text-muted">{briefing || "Preparando tu día…"}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {talking && (
        <div className="mx-auto mt-6 flex max-w-3xl flex-col gap-5" aria-live="polite">
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          <div ref={end} />
        </div>
      )}

      {/* La caja para hablarle */}
      <div className={cx("z-20 mx-auto mt-6 max-w-3xl", talking && "sticky bottom-[calc(80px+env(safe-area-inset-bottom))] lg:bottom-6")}>
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-2">
            {files.map((f) => (
              <div key={f.preview} className="relative">
                {f.file.type.startsWith("image/") ? (
                  <img src={f.preview} alt={f.file.name} className={cx("size-16 rounded-xl object-cover ring-1 ring-line", f.uploading && "opacity-50")} />
                ) : (
                  <span className="glass flex h-16 max-w-40 items-center gap-1.5 rounded-xl px-3 text-xs text-muted">
                    <Paperclip size={13} /> <span className="truncate">{f.file.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setFiles((fs) => fs.filter((x) => x.preview !== f.preview))}
                  aria-label={`Quitar ${f.file.name}`}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-paper"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={submit}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            attach([...e.dataTransfer.files]);
          }}
          className="glass flex items-end gap-2 rounded-[1.75rem] p-2 pl-2 focus-within:border-line-strong"
        >
          <input ref={filePicker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => attach([...(e.target.files ?? [])])} />
          <button
            type="button"
            onClick={() => filePicker.current?.click()}
            aria-label="Adjuntar imagen o PDF"
            title="Adjuntar (o pega una captura)"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-ink"
          >
            <Paperclip size={19} />
          </button>
          <label htmlFor="jarvis" className="sr-only">
            Pregunta o pide algo a Jarvis
          </label>
          <textarea
            id="jarvis"
            ref={input}
            rows={1}
            value={voice.listening ? voice.interim : text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                attach(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(text);
              }
            }}
            placeholder={voice.listening ? "Te escucho…" : aiEnabled ? "Pregúntame o pídeme algo…" : "Dime qué apunto: «dentista el martes a las 10»"}
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[1.05rem] placeholder:text-faint focus:outline-none focus-visible:outline-none"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          {voice.canSpeak && (
            <button
              type="button"
              onClick={() => {
                setAloud(!aloud);
                setReadAloudPref(!aloud);
                if (aloud) voice.silence();
              }}
              aria-label={aloud ? "No leer las respuestas en voz alta" : "Leer las respuestas en voz alta"}
              title={aloud ? "Respuestas en voz alta: sí" : "Respuestas en voz alta: no"}
              className="hidden size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-ink sm:flex"
            >
              {aloud ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
          )}
          {voice.supported && (
            <button
              type="button"
              onClick={() => (voice.listening ? voice.stop() : voice.start())}
              aria-label={voice.listening ? "Dejar de escuchar" : "Hablar"}
              title="Hablar (o mantén la barra espaciadora)"
              className={cx(
                "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors",
                voice.listening ? "bg-cyan text-paper" : "text-muted hover:bg-white/5 hover:text-ink",
              )}
            >
              {voice.listening ? <MicOff size={19} /> : <Mic size={19} />}
            </button>
          )}
          {busy ? (
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              aria-label="Detener"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper"
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={(!text.trim() && !files.length) || files.some((f) => f.uploading)}
              aria-label="Enviar"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cobalt text-paper transition-opacity disabled:opacity-25"
            >
              <ArrowUp size={20} />
            </button>
          )}
        </form>
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
          {talking ? (
            <button type="button" onClick={newConversation} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-faint hover:text-ink">
              <Plus size={13} /> Nueva conversación
            </button>
          ) : (
            SUGGESTIONS.map((s, i) => (
              <motion.button
                key={s}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.07 }}
                onClick={() => ask(s)}
                className="glass rounded-full px-3.5 py-1.5 text-sm text-muted transition-colors hover:text-ink"
              >
                {s}
              </motion.button>
            ))
          )}
        </div>
        {!talking && voice.supported && <p className="mt-2 text-center text-xs text-faint">Mantén pulsada la barra espaciadora para hablar.</p>}
      </div>

      {/* Tu día */}
      {d && (
        <div className={cx("mt-12 grid gap-4 md:grid-cols-6", talking && "opacity-90")}>
          {(google === "off" || google === "reconnect") && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="md:col-span-6">
              <ConnectGoogleCard status={google} />
            </motion.div>
          )}

          <Card title="Ahora" icon={<CalendarDays size={15} />} className="md:col-span-3" i={0}>
            <NowCard events={d.events} people={d.people ?? {}} onOpen={(e) => setEvent(eventToDraft(e))} />
          </Card>

          <Card title="Lo que he hecho" icon={<FolderSync size={15} />} className="md:col-span-3" i={1}>
            <ActivityCard filedToday={filedToday} />
          </Card>

          <Card
            title={`Agenda · ${fmt(now, "EEEE d")}`}
            icon={<CalendarDays size={15} />}
            className="md:col-span-2"
            i={2}
            action={
              <button type="button" onClick={() => setEvent(newEventDraft(now, now.getHours() + 1))} className="text-xs text-muted hover:text-ink">
                + Evento
              </button>
            }
          >
            {d.events.length ? <CompactThread events={d.events} onOpen={(e) => setEvent(eventToDraft(e))} /> : <p className="text-muted">Día libre.</p>}
          </Card>

          <Card
            title={pending.length ? `Tareas · ${pending.length}` : "Tareas"}
            icon={<CheckSquare size={15} />}
            className="md:col-span-2"
            i={3}
            action={<SeeAll to="/tareas" />}
          >
            {pending.length ? (
              <ul className="divide-y divide-line">
                {pending.slice(0, 6).map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setTask} />
                ))}
              </ul>
            ) : (
              <p className="text-muted">{d.counts.done_today ? `Has completado ${d.counts.done_today} hoy.` : "Nada pendiente para hoy."}</p>
            )}
          </Card>

          <Card
            title={d.inbox ? `Correo · ${d.inbox.counts.attention}` : "Correo"}
            icon={<Inbox size={15} />}
            className="md:col-span-2"
            i={4}
            action={d.inbox ? <SeeAll to="/bandeja" /> : undefined}
          >
            {!d.inbox ? (
              <p className="text-muted">Conecta Google para ver aquí lo que requiere respuesta.</p>
            ) : d.inbox.emails.length ? (
              <ul className="divide-y divide-line">
                {d.inbox.emails.slice(0, 3).map((e) => (
                  <EmailRow key={e.id} email={e} dense />
                ))}
              </ul>
            ) : (
              <p className="text-muted">Bandeja al día.</p>
            )}
          </Card>

          {d.github.connected && d.github.reviews.length + d.github.assigned.length > 0 && (
            <Card title="GitHub" icon={<GitPullRequest size={15} />} className="md:col-span-6" i={5} action={<SeeAll to="/tareas?etiqueta=github" />}>
              <ul className="grid gap-x-8 divide-y divide-line md:grid-cols-2 md:divide-y-0">
                {[...d.github.reviews, ...d.github.assigned].slice(0, 6).map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setTask} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <TaskSheet task={task} onClose={() => setTask(null)} />
      <EventSheet draft={event} onClose={() => setEvent(null)} />
    </Page>
  );
}

function ActivityCard({ filedToday }: { filedToday: number }) {
  const memory = useQuery({ queryKey: ["memory-status"], queryFn: api.memoryStatus, refetchInterval: 20_000 });
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => api.activity(6), refetchInterval: 20_000 });
  const m = memory.data;
  if (!m) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat value={m.downloads.filed} label="documentos de Descargas ordenados" />
        <Stat value={m.downloads.processing} label="leyendo ahora" live={m.downloads.processing > 0} />
      </div>
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className={cx("size-1.5 rounded-full", m.downloads.enabled ? "pulse-dot bg-moss text-moss" : "bg-faint")} />
        {m.downloads.enabled
          ? `Vigilando Descargas${filedToday ? ` · ${filedToday} ordenados hoy` : ""}`
          : m.downloads.waiting_for_ai
            ? "Descargas: esperando la clave de Claude para ordenarla"
            : "Descargas no está conectada"}
      </p>
      {activity.data && activity.data.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
          {activity.data.slice(0, 4).map((a) => (
            <li key={a.id} className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={a.body ?? undefined}>
                {a.title}
              </span>
              <span className="mono shrink-0 text-xs text-faint">{ago(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ value, label, live }: { value: number; label: string; live?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] px-3 py-2.5">
      <motion.p
        key={value}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={cx("mono text-2xl font-semibold tabular", live && "text-cobalt")}
      >
        {value}
      </motion.p>
      <p className="text-xs leading-tight text-faint">{label}</p>
    </div>
  );
}
