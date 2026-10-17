import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LogOut, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button, colorVar, cx, Field, Input, Loading, PageHeader, Select } from "../components/ui";
import { api, type Color } from "../lib/api";
import { ago, fmt } from "../lib/dates";
import { Page } from "../lib/nav";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../lib/push";
import { ColorPicker } from "./Projects";

function Block({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-8 gap-4 border-t border-line py-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      </div>
      <div className="min-w-0 max-w-2xl">{children}</div>
    </section>
  );
}

function NotificationsBlock() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    currentSubscription().then(
      (s) => setEnabled(!!s),
      () => setEnabled(false),
    );
  }, []);

  const toggle = async () => {
    try {
      if (enabled) await disablePush();
      else await enablePush();
      setEnabled(!enabled);
      toast(enabled ? "Notificaciones desactivadas en este dispositivo" : "Notificaciones activadas en este dispositivo");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const prefs = me.data?.prefs;
  const update = async (patch: Record<string, number>) => {
    const updated = await api.prefs(patch);
    queryClient.setQueryData(["me"], updated);
    toast("Preferencia guardada");
  };

  return (
    <Block id="avisos" title="Avisos" intro="Recordatorios, eventos próximos, vencimientos y un resumen cada mañana, en el móvil y en el ordenador.">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={enabled ? "quiet" : "primary"} onClick={toggle} disabled={enabled === null || !pushSupported()}>
          {enabled ? "Desactivar en este dispositivo" : "Activar notificaciones"}
        </Button>
        {enabled && (
          <Button
            variant="ghost"
            onClick={() => api.pushTest().then((r) => toast(r.subscriptions ? "Aviso de prueba enviado" : "No hay dispositivos suscritos"))}
          >
            Enviar una de prueba
          </Button>
        )}
      </div>
      {!pushSupported() && (
        <p className="mt-2 text-sm text-faint">Este navegador no admite notificaciones. En iPhone, instala primero la app en la pantalla de inicio.</p>
      )}
      <p className="mt-2 text-sm text-faint">Funcionan con HTTPS (por ejemplo con Tailscale) o en este mismo ordenador.</p>
      {prefs && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Aviso de eventos sincronizados">
            {(id) => (
              <Select id={id} value={prefs.default_event_reminder} onChange={(e) => update({ default_event_reminder: Number(e.target.value) })}>
                {[0, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m ? `${m} minutos antes` : "A la hora"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Resumen del día">
            {(id) => (
              <Select id={id} value={prefs.briefing_hour} onChange={(e) => update({ briefing_hour: Number(e.target.value) })}>
                {[6, 7, 8, 9, 10].map((h) => (
                  <option key={h} value={h}>
                    A las {h}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
    </Block>
  );
}

function CalendarsBlock() {
  const queryClient = useQueryClient();
  const calendars = useQuery({ queryKey: ["calendars"], queryFn: api.calendars, refetchInterval: 15_000 });
  const feed = useQuery({ queryKey: ["feed"], queryFn: api.feed });
  const [form, setForm] = useState({ name: "", url: "", color: "ochre" as Color });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["calendars"] });
    queryClient.invalidateQueries({ queryKey: ["events"] });
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.addCalendar({ name: form.name, url: form.url || undefined, color: form.color });
      setForm({ name: "", url: "", color: "ochre" });
      refresh();
      toast(form.url ? "Calendario añadido. Se sincronizará en unos segundos." : "Calendario creado");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const feedUrl = feed.data ? `${location.origin}${feed.data.url_path}` : "";

  return (
    <Block id="calendarios" title="Calendarios" intro="Trae aquí Google Calendar, iCloud u Outlook con su enlace privado iCal. Se actualizan cada 15 minutos.">
      {calendars.isPending ? (
        <Loading />
      ) : (
        <ul className="mb-6 divide-y divide-line rounded-xl border border-line bg-surface">
          {calendars.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="size-3 rounded-full" style={{ background: colorVar(c.color) }} />
              <div className="min-w-0 flex-1">
                <p className={cx("font-medium", !c.enabled && "text-faint line-through")}>{c.name}</p>
                <p className="text-sm text-muted">
                  {c.source === "local" ? (
                    "Propio"
                  ) : c.sync_error ? (
                    <span className="text-clay">Error: {c.sync_error}</span>
                  ) : c.last_synced_at ? (
                    `Sincronizado ${ago(c.last_synced_at)}`
                  ) : (
                    "Sincronizando…"
                  )}
                  {`, ${c.events} eventos`}
                </p>
              </div>
              {c.source === "ics" && (
                <Button size="sm" variant="ghost" onClick={() => api.syncCalendar(c.id).then(refresh)} aria-label={`Sincronizar ${c.name}`}>
                  <RefreshCw size={15} />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => api.updateCalendar(c.id, { enabled: !c.enabled }).then(refresh)}>
                {c.enabled ? "Ocultar" : "Mostrar"}
              </Button>
              <Button
                size="sm"
                variant="danger"
                aria-label={`Eliminar ${c.name}`}
                onClick={() => confirm(`¿Eliminar «${c.name}» y sus eventos?`) && api.deleteCalendar(c.id).then(refresh, (e) => toast.error(e.message))}
              >
                <Trash2 size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-4 rounded-xl border border-line p-4">
        <h3 className="font-semibold">Añadir calendario</h3>
        <Field label="Nombre">
          {(id) => (
            <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Trabajo…" autoComplete="off" />
          )}
        </Field>
        <Field
          label="Enlace iCal (opcional)"
          hint={
            <>
              Google: Configuración del calendario, «Dirección secreta en formato iCal». iCloud: Compartir calendario, «Calendario público». Déjalo vacío para
              crear un calendario propio. El enlace se guarda cifrado.
            </>
          }
        >
          {(id) => (
            <Input
              id={id}
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              inputMode="url"
            />
          )}
        </Field>
        <Field label="Color">{() => <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />}</Field>
        <Button type="submit" variant="primary" className="self-start">
          Añadir
        </Button>
      </form>

      <div className="mt-6">
        <h3 className="font-semibold">Ver tus eventos en el calendario del móvil</h3>
        <p className="mt-1 text-sm text-muted">
          Suscríbete a este enlace desde Google Calendar, Apple Calendar u Outlook. Es privado: quien lo tenga ve tus eventos.
        </p>
        <div className="mt-3 flex gap-2">
          <Input readOnly value={feedUrl} aria-label="Enlace del calendario" onFocus={(e) => e.target.select()} className="font-mono text-sm" />
          <Button onClick={() => navigator.clipboard.writeText(feedUrl).then(() => toast("Enlace copiado"))} aria-label="Copiar enlace">
            <Copy size={16} />
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() =>
            api
              .rotateFeed()
              .then(() => queryClient.invalidateQueries({ queryKey: ["feed"] }))
              .then(() => toast("Enlace cambiado; el anterior ya no funciona"))
          }
        >
          Generar un enlace nuevo
        </Button>
      </div>
    </Block>
  );
}

function SecurityBlock() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const audit = useQuery({ queryKey: ["audit"], queryFn: api.audit });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [setup, setSetup] = useState<{ secret: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [disablePw, setDisablePw] = useState("");

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "" });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast("Contraseña cambiada. Se han cerrado las demás sesiones.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const enable2fa = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.totpEnable(code);
      setSetup(null);
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast("Verificación en dos pasos activada");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const disable2fa = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.totpDisable(code, disablePw);
      setCode("");
      setDisablePw("");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast("Verificación en dos pasos desactivada");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const ACTIONS: Record<string, string> = {
    login: "Inicio de sesión",
    login_failed: "Contraseña incorrecta",
    login_failed_totp: "Código incorrecto",
    logout: "Cierre de sesión",
    password_changed: "Contraseña cambiada",
    password_change_failed: "Intento de cambio de contraseña",
    totp_enabled: "Dos pasos activado",
    totp_disabled: "Dos pasos desactivado",
    session_revoked: "Sesión cerrada a distancia",
    push_subscribed: "Notificaciones activadas",
    calendar_added: "Calendario añadido",
    feed_rotated: "Enlace de calendario renovado",
  };

  return (
    <Block id="seguridad" title="Seguridad" intro="Tus datos solo salen de tu ordenador cuando usas Claude o sincronizas un calendario.">
      <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Contraseña actual">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              required
            />
          )}
        </Field>
        <Field label="Nueva (12 caracteres o más)">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              required
            />
          )}
        </Field>
        <Button type="submit">Cambiar</Button>
      </form>

      <div className="mt-8">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={18} className={me.data?.totp_enabled ? "text-moss" : "text-faint"} />
          Verificación en dos pasos {me.data?.totp_enabled ? "activada" : "desactivada"}
        </h3>
        {me.data?.totp_enabled ? (
          <form onSubmit={disable2fa} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Contraseña">
              {(id) => <Input id={id} type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} required />}
            </Field>
            <Field label="Código actual">
              {(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />}
            </Field>
            <Button type="submit" variant="danger">
              Desactivar
            </Button>
          </form>
        ) : setup ? (
          <form onSubmit={enable2fa} className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-muted">Escanea el código con Google Authenticator, 1Password o similar y escribe el número que aparece.</p>
            <div className="w-fit rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
            <p className="font-mono text-sm break-all text-muted">{setup.secret}</p>
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Código"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                spellCheck={false}
                className="max-w-40"
                required
              />
              <Button type="submit" variant="primary">
                Activar
              </Button>
            </div>
          </form>
        ) : (
          <Button className="mt-3" onClick={() => api.totpSetup().then(setSetup, (e) => toast.error(e.message))}>
            Configurar
          </Button>
        )}
      </div>

      <div className="mt-8">
        <h3 className="font-semibold">Sesiones abiertas</h3>
        <ul className="mt-2 divide-y divide-line">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{s.user_agent?.replace(/\(.*?\)/g, "").slice(0, 80) || "Dispositivo desconocido"}</p>
                <p className="text-xs text-faint">
                  {s.current ? "Esta sesión" : `Activa ${ago(s.last_seen_at)}`}, desde {s.ip}
                </p>
              </div>
              {!s.current && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => api.revokeSession(s.id).then(() => queryClient.invalidateQueries({ queryKey: ["sessions"] }))}
                >
                  Cerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <details className="mt-6">
        <summary className="cursor-pointer font-semibold">Actividad reciente</summary>
        <ul className="mt-2 text-sm">
          {audit.data?.map((a, i) => (
            <li key={i} className="flex justify-between gap-3 border-t border-line py-1.5">
              <span className={cx(a.action.includes("failed") && "text-clay")}>{ACTIONS[a.action] ?? a.action}</span>
              <span className="text-faint tabular">
                {fmt(a.at, "d MMM HH:mm")}
                {a.ip ? `, ${a.ip}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Block>
  );
}

export default function SettingsPage() {
  return (
    <Page>
      <PageHeader title="Ajustes">
        <Button variant="ghost" onClick={() => api.logout().finally(() => window.dispatchEvent(new Event("sb:logout")))}>
          <LogOut size={16} /> Cerrar sesión
        </Button>
      </PageHeader>
      <NotificationsBlock />
      <CalendarsBlock />
      <SecurityBlock />
    </Page>
  );
}
