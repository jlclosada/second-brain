import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, MessageSquarePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, ViewTransition, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Markdown } from "../components/NoteEditor";
import { cx, Empty, IconButton } from "../components/ui";
import { api, type ChatMessage } from "../lib/api";
import { ago } from "../lib/dates";
import { animate, GoLink, Page } from "../lib/nav";

const EXAMPLES = [
  "¿Qué tengo esta semana?",
  "¿Cuándo vence el seguro del coche?",
  "Apúntame dentista el jueves a las 10",
  "Resume lo que escribí en el diario estos días",
];

export default function AssistantPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const [conversationId, setConversationId] = useState<string | undefined>(params.get("c") ?? undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState(params.get("q") ?? "");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    api.conversation(conversationId).then(
      (c) => setMessages(c.messages),
      () => setConversationId(undefined),
    );
  }, [conversationId]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages.length, busy]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    animate(() => setMessages((m) => [...m, { role: "user", text: message, actions: [] }]));
    setBusy(true);
    try {
      const r = await api.chat(message, conversationId);
      animate(() => setMessages((m) => [...m, r.reply]));
      if (!conversationId) {
        setConversationId(r.conversation_id);
        setParams({ c: r.conversation_id }, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (r.reply.actions.some((a) => a.tool.startsWith("crear") || a.tool.startsWith("completar") || a.tool.startsWith("escribir"))) {
        queryClient.invalidateQueries({ queryKey: ["today"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["events"] });
        queryClient.invalidateQueries({ queryKey: ["notes"] });
      }
    } catch (err) {
      toast.error((err as Error).message);
      setMessages((m) => m.slice(0, -1));
      setText(message);
    } finally {
      setBusy(false);
    }
  };

  const select = (id?: string) => {
    setConversationId(id);
    setParams(id ? { c: id } : {}, { replace: true });
  };

  const remove = async (id: string) => {
    await api.deleteConversation(id);
    if (id === conversationId) select(undefined);
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  if (me.data && !me.data.ai_enabled) {
    return (
      <Page>
        <h1 className="mb-4 text-[2.2rem] font-semibold">Asistente</h1>
        <Empty icon={<Bot size={20} />} title="El asistente necesita una clave de Claude">
          Añade <code>ANTHROPIC_API_KEY</code> en el archivo <code>.env</code> y reinicia con <code>docker compose up -d</code>. Podrás preguntarle por tus
          documentos y tu agenda, y pedirle que cree tareas, eventos y notas.
        </Empty>
      </Page>
    );
  }

  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <button
            type="button"
            onClick={() => select(undefined)}
            className="mb-3 flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 hover:bg-sunken"
          >
            <MessageSquarePlus size={17} /> Conversación nueva
          </button>
          <ul className="flex flex-col gap-0.5">
            {conversations.data?.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => select(c.id)}
                  className={cx("min-w-0 flex-1 rounded-lg px-3 py-1.5 text-left", c.id === conversationId ? "bg-sunken" : "hover:bg-sunken")}
                >
                  <span className="block truncate text-sm">{c.title}</span>
                  <span className="block text-xs text-faint">{ago(c.updated_at)}</span>
                </button>
                <IconButton label="Borrar conversación" onClick={() => remove(c.id)} className="size-8 opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex min-h-[calc(100dvh-12rem)] min-w-0 flex-col">
          <div className="flex-1">
            {!messages.length ? (
              <div className="max-w-xl pt-4">
                <h1 className="text-[2.2rem] leading-tight font-semibold">¿En qué te ayudo?</h1>
                <p className="mt-2 text-muted">Conoce tus documentos, notas, tareas y calendario, y puede crear cosas por ti.</p>
                <ul className="mt-6 flex flex-col gap-2">
                  {EXAMPLES.map((ex) => (
                    <li key={ex}>
                      <button type="button" onClick={() => setText(ex)} className="w-full rounded-lg border border-line px-4 py-2.5 text-left hover:bg-surface">
                        {ex}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="flex max-w-3xl flex-col gap-6 pb-4">
                {messages.map((m, i) => (
                  <ViewTransition key={i} enter="rise-in" default="none">
                    <li className={cx(m.role === "user" && "self-end")}>
                      {m.role === "user" ? (
                        <p className="max-w-[36rem] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 whitespace-pre-wrap text-paper">{m.text}</p>
                      ) : (
                        <div className="flex gap-3">
                          <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-ochre-soft text-ochre">
                            <Bot size={16} />
                          </span>
                          <div className="min-w-0">
                            {m.actions.length > 0 && (
                              <ul className="mb-2 flex flex-wrap gap-1.5">
                                {m.actions.map((a, j) => (
                                  <li key={j}>
                                    {a.link ? (
                                      <GoLink
                                        to={a.link}
                                        className="inline-block rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:border-cobalt hover:text-cobalt"
                                      >
                                        {a.summary}
                                      </GoLink>
                                    ) : (
                                      <span className="inline-block rounded-full bg-sunken px-2.5 py-0.5 text-xs text-muted">{a.summary}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <Markdown body={m.text} />
                          </div>
                        </div>
                      )}
                    </li>
                  </ViewTransition>
                ))}
                {busy && (
                  <li className="flex items-center gap-2 text-sm text-muted" role="status">
                    <span className="size-2 animate-pulse rounded-full bg-ochre" /> Pensando y consultando tus datos…
                  </li>
                )}
              </ol>
            )}
            <div ref={bottom} />
          </div>

          <form
            onSubmit={send}
            className="sticky bottom-[calc(70px+env(safe-area-inset-bottom))] mt-4 flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-lift lg:bottom-6"
          >
            <label htmlFor="mensaje" className="sr-only">
              Mensaje
            </label>
            <textarea
              id="mensaje"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="¿Qué tengo mañana?…"
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 placeholder:text-faint focus:outline-none"
            />
            <button
              type="submit"
              disabled={!text.trim() || busy}
              aria-label="Enviar"
              className="flex size-10 items-center justify-center rounded-xl bg-ink text-paper disabled:opacity-40"
            >
              <ArrowUp size={19} />
            </button>
          </form>
        </div>
      </div>
    </Page>
  );
}
