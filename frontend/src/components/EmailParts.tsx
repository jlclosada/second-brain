import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckSquare, ExternalLink, Mail, MailOpen, Plug, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api, type ConnectionStatus, type Email } from "../lib/api";
import { fmt, relativeDay } from "../lib/dates";
import { useGo } from "../lib/nav";
import { Button, cx } from "./ui";

export function useInboxRefresh() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["inbox"] });
    queryClient.invalidateQueries({ queryKey: ["today"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
}

function when(value: string) {
  const day = relativeDay(value);
  return day === "hoy" ? fmt(value, "HH:mm") : day;
}

export function EmailRow({ email, dense }: { email: Email; dense?: boolean }) {
  const refresh = useInboxRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const sender = email.sender_name || email.sender_email || "Desconocido";

  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await fn();
      refresh();
      toast(done);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="group flex gap-3 py-3">
      <span
        className={cx("mt-2 size-2 shrink-0 rounded-full", email.unread ? "bg-cobalt" : "bg-transparent")}
        aria-label={email.unread ? "Sin leer" : undefined}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cx("min-w-0 flex-1 truncate", email.unread ? "font-semibold" : "text-muted")}>
            {sender}
            {email.message_count > 1 && <span className="ml-1 text-sm font-normal text-faint tabular">{email.message_count}</span>}
          </p>
          {(email.important || email.starred) && <Star size={13} className="shrink-0 fill-ochre text-ochre" aria-label="Importante" />}
          <span className="shrink-0 text-sm text-faint tabular">{when(email.received_at)}</span>
        </div>
        <a href={email.url} target="_blank" rel="noreferrer" className="block hover:text-cobalt">
          <p className={cx("truncate", email.unread && "font-medium")}>{email.subject}</p>
          {!dense && <p className="line-clamp-2 text-sm text-muted">{email.snippet}</p>}
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {email.task_id ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-moss">
              <CheckSquare size={14} /> En tus tareas
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={!!busy}
              onClick={() => run("task", () => api.emailToTask(email.id), "Tarea creada a partir del correo")}
            >
              <CheckSquare size={14} /> Crear tarea
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("archive", () => api.archiveEmail(email.id), "Archivado en Gmail")}>
            <Archive size={14} /> Archivar
          </Button>
          {email.unread && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("read", () => api.readEmail(email.id), "Marcado como leído")}>
              <MailOpen size={14} /> <span className="hidden sm:inline">Marcar leído</span>
            </Button>
          )}
          <a
            href={email.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted hover:bg-sunken hover:text-ink"
          >
            <ExternalLink size={14} /> <span className="hidden sm:inline">Abrir en Gmail</span>
          </a>
        </div>
      </div>
    </li>
  );
}

/** Abre la conexión con Google: directa si la app ya está configurada, si no lleva a Ajustes. */
export function useConnectGoogle() {
  const go = useGo();
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, staleTime: 30_000 });
  return async () => {
    const google = integrations.data?.google ?? (await api.integrations()).google;
    if (!google.configured) return go("/ajustes?seccion=conexiones", "nav-forward");
    try {
      const { url } = await api.googleStart();
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
}

export function ConnectGoogleCard({ status, what = "tu correo y tu calendario" }: { status: ConnectionStatus; what?: string }) {
  const connect = useConnectGoogle();
  const reconnect = status === "reconnect";
  return (
    <div
      className={cx("flex flex-wrap items-center gap-4 rounded-2xl border p-4 sm:p-5", reconnect ? "border-clay/40 bg-clay-soft" : "border-line bg-surface")}
    >
      <div className={cx("flex size-11 shrink-0 items-center justify-center rounded-xl", reconnect ? "bg-clay text-paper" : "bg-cobalt-soft text-cobalt")}>
        {reconnect ? <Plug size={20} /> : <Mail size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{reconnect ? "Google se ha desconectado" : `Conecta Google para ver ${what}`}</p>
        <p className="text-sm text-muted">
          {reconnect
            ? "El permiso caducó o se retiró. Vuelve a conectar para seguir sincronizando Gmail y Calendar."
            : "Los correos que requieren respuesta y tus eventos de Google Calendar aparecerán aquí. Lo que crees se guarda también en Google."}
        </p>
      </div>
      <Button variant="primary" onClick={connect}>
        {reconnect ? "Volver a conectar" : "Conectar Google"}
      </Button>
    </div>
  );
}
