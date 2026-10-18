import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Copy, ExternalLink, GitPullRequest, Mail, RefreshCw } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { api, type Integration } from "../lib/api";
import { ago } from "../lib/dates";
import { useConnectGoogle } from "./EmailParts";
import { Button, colorVar, cx, Field, Input, Loading, Select } from "./ui";

function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ["integrations", "calendars", "events", "today", "inbox", "tasks"]) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

function Card({ icon, title, status, children }: { icon: ReactNode; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink">{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{title}</h3>
          <div className="text-sm text-muted">{status}</div>
        </div>
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function StatusDot({ tone }: { tone: "ok" | "off" | "bad" }) {
  return <span className={cx("mr-1.5 inline-block size-2 rounded-full", tone === "ok" ? "bg-moss" : tone === "bad" ? "bg-clay" : "bg-faint")} />;
}

function Copyable({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-2 flex gap-2">
      <Input readOnly value={value} onFocus={(e) => e.target.select()} className="font-mono text-sm" aria-label="Dirección de redirección" />
      <Button
        onClick={() =>
          navigator.clipboard.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
        }
        aria-label="Copiar"
      >
        {done ? <Check size={16} /> : <Copy size={16} />}
      </Button>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cobalt underline underline-offset-2">
      {children}
      <ExternalLink size={12} />
    </a>
  );
}

function GoogleSetup({ google, onSaved }: { google: Integration; onSaved: () => void }) {
  const [form, setForm] = useState({ id: "", secret: "" });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.setGoogleClient(form.id, form.secret);
      setForm({ id: "", secret: "" });
      onSaved();
      toast.success("Credenciales guardadas. Ahora pulsa «Conectar con Google».");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Para que la app lea tu Gmail y escriba en tu Google Calendar necesita su propia «llave» de Google. Se crea una sola vez, es gratis y tarda unos 5
        minutos. Tus datos van directamente de Google a tu ordenador.
      </p>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm leading-relaxed marker:font-semibold marker:text-muted">
        <li>
          <Ext href="https://console.cloud.google.com/projectcreate">Crea un proyecto</Ext> en Google Cloud (por ejemplo «Segundo cerebro»).
        </li>
        <li>
          Activa la <Ext href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">API de Gmail</Ext> y la{" "}
          <Ext href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">API de Google Calendar</Ext> (botón «Habilitar»).
        </li>
        <li>
          En <Ext href="https://console.cloud.google.com/auth/overview">Google Auth Platform</Ext> configura la pantalla de consentimiento: tipo <b>Externo</b>{" "}
          y tu correo como contacto. Después, en <b>Público</b>, pulsa <b>Publicar app</b>: si se queda «en prueba», Google corta el permiso cada 7 días.
        </li>
        <li>
          En <Ext href="https://console.cloud.google.com/auth/clients/create">Clientes</Ext> crea un cliente OAuth de tipo <b>Aplicación web</b> y añade este
          URI de redirección autorizado:
          {google.redirect_uri && <Copyable value={google.redirect_uri} />}
          <span className="mt-1 block text-xs text-faint">
            Debe coincidir con la dirección con la que abres la app. Si entras también por Tailscale, añade su dirección o define PUBLIC_URL en .env.
          </span>
        </li>
        <li>Pega aquí el ID de cliente y el secreto que te da Google:</li>
      </ol>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="ID de cliente">
          {(id) => (
            <Input
              id={id}
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="1234…apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
              required
            />
          )}
        </Field>
        <Field label="Secreto del cliente">
          {(id) => (
            <Input
              id={id}
              type="password"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder="GOCSPX-…"
              autoComplete="off"
              required
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary">
            Guardar credenciales
          </Button>
          <p className="mt-2 text-xs text-faint">Se guardan cifradas. También puedes ponerlas en .env como GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.</p>
        </div>
      </form>
    </div>
  );
}

function GoogleCalendars() {
  const queryClient = useQueryClient();
  const calendars = useQuery({ queryKey: ["calendars"], queryFn: api.calendars });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const refresh = useRefreshAll();
  const google = calendars.data?.filter((c) => c.source === "google") ?? [];
  const writable = calendars.data?.filter((c) => c.enabled && (c.source === "local" || (c.source === "google" && c.writable))) ?? [];
  if (!google.length) return <p className="text-sm text-muted">Trayendo tus calendarios…</p>;

  const setDefault = async (value: string) => {
    const updated = await api.prefs({ default_calendar_id: value });
    queryClient.setQueryData(["me"], updated);
    toast("Guardado");
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {google.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="size-3 shrink-0 rounded-full" style={{ background: colorVar(c.color) }} />
            <div className="min-w-0 flex-1">
              <p className={cx("truncate", !c.enabled && "text-faint")}>
                {c.name}
                {c.primary && <span className="ml-1.5 text-xs text-muted">principal</span>}
              </p>
              <p className="text-xs text-faint">
                {c.writable ? "Lectura y escritura" : "Solo lectura"}
                {c.enabled && `, ${c.events} eventos`}
                {c.sync_error && <span className="text-clay"> · {c.sync_error}</span>}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={() => api.updateCalendar(c.id, { enabled: !c.enabled }).then(refresh)}
                className="size-4 accent-[var(--cobalt)]"
              />
              Mostrar
            </label>
          </li>
        ))}
      </ul>
      <Field label="Los eventos nuevos van a" hint="También lo que apuntas con la captura rápida o le pides a Jarvis.">
        {(id) => (
          <Select id={id} value={me.data?.prefs.default_calendar_id ?? ""} onChange={(e) => setDefault(e.target.value)} className="max-w-sm">
            <option value="">Automático (el principal de Google)</option>
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.source === "google" ? `${c.name} (Google)` : `${c.name} (solo en esta app)`}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

function GoogleCard({ google }: { google: Integration }) {
  const refresh = useRefreshAll();
  const connect = useConnectGoogle();
  const parts: [string, string | undefined, string | undefined][] = [
    ["Gmail", google.state.gmail_synced_at, google.state.gmail_error],
    ["Calendar", google.state.calendar_synced_at, google.state.calendar_error],
  ];

  const status = google.connected ? (
    google.status === "reconnect" ? (
      <span className="text-clay">
        <StatusDot tone="bad" />
        Hay que volver a conectar
      </span>
    ) : (
      <span>
        <StatusDot tone="ok" />
        Conectado como {google.account}
      </span>
    )
  ) : (
    <span>
      <StatusDot tone="off" />
      {google.configured ? "Listo para conectar" : "Sin configurar"}
    </span>
  );

  return (
    <Card icon={<Mail size={19} />} title="Google: Gmail y Calendar" status={status}>
      {!google.configured ? (
        <GoogleSetup google={google} onSaved={refresh} />
      ) : !google.connected || google.status === "reconnect" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">
            Al conectar, Google te pedirá permiso para leer tu bandeja (y archivar o marcar como leído) y para ver y editar tus calendarios. Si avisa de que la
            app no está verificada, es la tuya: pulsa «Configuración avanzada» y continúa.
          </p>
          {google.error && <p className="text-sm text-clay">{google.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={connect}>
              {google.status === "reconnect" ? "Volver a conectar" : "Conectar con Google"}
            </Button>
            {!google.client_from_env && (
              <Button variant="ghost" onClick={() => confirm("¿Borrar las credenciales de la app de Google?") && api.googleDisconnect(true).then(refresh)}>
                Cambiar credenciales
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {parts.map(([label, at, error]) => (
              <div key={label} className="rounded-lg bg-sunken px-3 py-2">
                <dt className="font-medium">{label}</dt>
                <dd className={cx("text-muted", error && "text-clay")}>{error ? error : at ? `Sincronizado ${ago(at)}` : "Sincronizando…"}</dd>
              </div>
            ))}
          </dl>
          {google.error && <p className="text-sm text-ochre">{google.error}</p>}
          <div>
            <h4 className="mb-2 flex items-center gap-2 font-medium">
              <CalendarDays size={16} /> Tus calendarios de Google
            </h4>
            <GoogleCalendars />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button
              onClick={() =>
                api
                  .syncIntegration("google")
                  .then(() => toast("Sincronizando…"))
                  .then(() => setTimeout(refresh, 4000))
              }
            >
              <RefreshCw size={15} /> Sincronizar ahora
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                confirm("¿Desconectar Google? Se quitan de aquí tus correos y eventos de Google (en Google no se borra nada).") &&
                api.googleDisconnect().then(() => {
                  refresh();
                  toast("Google desconectado");
                })
              }
            >
              Desconectar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function GitHubCard({ github }: { github: Integration }) {
  const refresh = useRefreshAll();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.githubConnect(token);
      setToken("");
      refresh();
      toast.success(`GitHub conectado como ${r.account}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const status = github.connected ? (
    github.status === "reconnect" ? (
      <span className="text-clay">
        <StatusDot tone="bad" />
        El token ya no vale
      </span>
    ) : (
      <span>
        <StatusDot tone="ok" />
        Conectado como {github.account}
      </span>
    )
  ) : (
    <span>
      <StatusDot tone="off" />
      Sin conectar
    </span>
  );

  return (
    <Card icon={<GitPullRequest size={19} />} title="GitHub" status={status}>
      {github.connected && github.status !== "reconnect" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Los PR en los que te piden revisión y los issues asignados aparecen en Hoy y en Tareas. Cuando se cierran en GitHub, se marcan como hechos aquí.
            {github.state.synced_at && ` Sincronizado ${ago(github.state.synced_at)}.`}
          </p>
          {github.error && <p className="text-sm text-clay">{github.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => api.syncIntegration("github").then(() => setTimeout(refresh, 3000))}>
              <RefreshCw size={15} /> Sincronizar ahora
            </Button>
            <Button variant="danger" onClick={() => confirm("¿Desconectar GitHub?") && api.githubDisconnect().then(refresh)}>
              Desconectar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={connect} className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Crea un <Ext href="https://github.com/settings/tokens/new?description=Segundo%20cerebro&scopes=repo">token de acceso</Ext> con el permiso{" "}
            <b>repo</b> (para ver también los repositorios privados) y pégalo aquí. Solo se usa para leer; se guarda cifrado.
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_…"
              aria-label="Token de GitHub"
              autoComplete="off"
              required
            />
            <Button type="submit" variant="primary" disabled={saving}>
              Conectar
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export default function Connections() {
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, refetchInterval: 15_000 });
  if (integrations.isPending) return <Loading />;
  if (!integrations.data) return <p className="text-clay">No se pudieron cargar las conexiones.</p>;
  return (
    <div className="flex flex-col gap-5">
      <GoogleCard google={integrations.data.google} />
      <GitHubCard github={integrations.data.github} />
    </div>
  );
}
