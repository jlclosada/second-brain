import { useState, type FormEvent } from "react";

import { BrandMark } from "../components/Shell";
import { Button, Input } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { capitalize, fmt } from "../lib/dates";

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const hour = Math.min(23, Math.max(6, now.getHours() + now.getMinutes() / 60));
  const nowPct = 8 + ((hour - 6) / 17) * 84;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(password, needsCode ? code : undefined);
      onLogin();
    } catch (err) {
      if (err instanceof ApiError && err.message === "totp_required") {
        setNeedsCode(true);
      } else {
        setError(err instanceof Error ? err.message : "No se pudo entrar");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-night text-night-ink lg:block" aria-hidden>
        {/* El hilo del día como ilustración: las horas, lo ya vivido en ocre y el ahora. */}
        <div className="absolute top-[8%] bottom-[8%] left-[22%] w-[2px] bg-night-ink/15" />
        <div className="absolute top-[8%] left-[22%] w-[2px] bg-ochre" style={{ height: `${nowPct - 8}%` }} />
        {HOURS.map((h, i) => (
          <div key={h} className="absolute left-[22%] flex -translate-y-1/2 items-center" style={{ top: `${8 + (i * 84) / (HOURS.length - 1)}%` }}>
            <span className="-ml-16 w-12 text-right text-sm text-night-ink/35 tabular">{String(h).padStart(2, "0")}:00</span>
            <span className="ml-4 h-px w-5 bg-night-ink/20" />
          </div>
        ))}
        <div className="now-dot absolute left-[22%] size-4 -translate-x-[7px] -translate-y-1/2 rounded-full bg-ochre" style={{ top: `${nowPct}%` }} />
        <div className="absolute left-[calc(22%+3rem)] max-w-md -translate-y-1/2" style={{ top: `${nowPct}%` }}>
          <p className="font-display text-[2.6rem] leading-tight font-semibold">{capitalize(fmt(now, "EEEE d 'de' MMMM"))}</p>
          <p className="mt-1 text-night-ink/60">Tu agenda, tus notas y tus papeles, en un solo sitio.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <BrandMark size={44} />
          <h1 className="mt-6 text-3xl font-semibold">Segundo cerebro</h1>
          <p className="mt-1 text-muted">{needsCode ? "Escribe el código de tu app de autenticación." : "Entra con tu contraseña."}</p>

          <div className="mt-8 flex flex-col gap-3">
            <label className="sr-only" htmlFor="password">
              Contraseña
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Contraseña…"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={!needsCode}
              readOnly={needsCode}
              className="h-12"
            />
            {needsCode && (
              <>
                <label className="sr-only" htmlFor="totp">
                  Código de verificación
                </label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                  className="h-12 text-center text-xl tracking-[0.3em] tabular"
                />
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-clay">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy || !password} className="mt-2 h-12">
              {busy ? "Entrando…" : "Entrar"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
