import { Brain } from "lucide-react";
import { useState } from "react";

import { api } from "../api";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      onLogin();
    } catch {
      setError("Contraseña incorrecta");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="rounded-2xl bg-indigo-600 p-3 text-white">
            <Brain size={32} />
          </div>
          <h1 className="text-xl font-semibold">Segundo Cerebro</h1>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy || !password}
          className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white disabled:opacity-50"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}
