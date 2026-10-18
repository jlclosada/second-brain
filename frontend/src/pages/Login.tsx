import { useState, type FormEvent } from "react";

import { motion } from "motion/react";

import Orb from "../components/Orb";
import { Button, Input } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { capitalize, fmt } from "../lib/dates";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const now = new Date();

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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6 py-12">
      <div className="aurora" aria-hidden />
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="flex w-full max-w-sm flex-col items-center text-center"
      >
        <Orb state={busy ? "thinking" : "idle"} size={190} />
        <p className="eyebrow mt-2">{capitalize(fmt(now, "EEEE d 'de' MMMM · HH:mm"))}</p>
        <h1 className="text-glow mt-3 font-display text-4xl font-semibold">Jarvis</h1>
        <p className="mt-1 text-muted">{needsCode ? "Escribe el código de tu app de autenticación." : "Tu segundo cerebro. Entra con tu contraseña."}</p>

        <div className="mt-8 flex w-full flex-col gap-3">
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
            className="glass h-12 rounded-2xl text-center"
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
                className="glass h-12 rounded-2xl text-center text-xl tracking-[0.3em] tabular"
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-clay">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy || !password} className="mt-2 h-12 rounded-2xl">
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </div>
      </motion.form>
    </div>
  );
}
