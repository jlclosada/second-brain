import { CalendarClock, Loader2, MessageCircleQuestion, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api, type AskResponse, type SearchResponse, type Stats } from "../api";
import ItemCard, { Chip, formatDate } from "../components/ItemCard";

type Mode = "buscar" | "preguntar";

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const mode: Mode = params.get("modo") === "preguntar" ? "preguntar" : "buscar";
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats().then(setStats, () => {});
  }, []);

  useEffect(() => {
    setInput(q);
    setError("");
    if (!q) {
      setResults(null);
      setAnswer(null);
      return;
    }
    setLoading(true);
    const run =
      mode === "buscar"
        ? api.search(q).then((r) => (setResults(r), setAnswer(null)))
        : api.ask(q).then((r) => (setAnswer(r), setResults(null)));
    run.catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, [q, mode]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) setParams({ q: input.trim(), ...(mode === "preguntar" ? { modo: mode } : {}) });
  };

  const switchMode = (m: Mode) => setParams({ ...(q ? { q } : {}), ...(m === "preguntar" ? { modo: m } : {}) });

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="relative">
        {mode === "buscar" ? (
          <Search className="absolute top-3.5 left-3.5 text-slate-400" size={20} />
        ) : (
          <Sparkles className="absolute top-3.5 left-3.5 text-indigo-500" size={20} />
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mode === "buscar" ? "seguro de coche 2024" : "¿Cuándo vence el seguro del coche?"}
          enterKeyHint="search"
          className="w-full rounded-2xl border border-slate-300 bg-white py-3 pr-4 pl-11 text-base shadow-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
      </form>

      <div className="flex gap-2">
        <Chip active={mode === "buscar"} onClick={() => switchMode("buscar")}>
          Buscar
        </Chip>
        <Chip active={mode === "preguntar"} onClick={() => switchMode("preguntar")}>
          <span className="inline-flex items-center gap-1">
            <MessageCircleQuestion size={14} /> Preguntar
          </span>
        </Chip>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> {mode === "buscar" ? "Buscando…" : "Pensando…"}
        </p>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {results && !loading && (
        <section className="space-y-2">
          <p className="text-sm text-slate-500">
            {results.hits.length} resultado{results.hits.length === 1 ? "" : "s"}
            {results.years.length > 0 && ` · año ${results.years.join(", ")}`}
          </p>
          {results.hits.map((h) => (
            <ItemCard key={h.item.id} item={h.item} snippet={h.snippet} />
          ))}
          {results.hits.length === 0 && <p className="text-slate-500">No he encontrado nada. Prueba con otras palabras.</p>}
        </section>
      )}

      {answer && !loading && <Answer answer={answer} />}

      {!q && stats && <Overview stats={stats} />}
    </div>
  );
}

function Answer({ answer }: { answer: AskResponse }) {
  // Convierte las citas [n] en enlaces al documento de origen.
  const parts = answer.answer.split(/(\[\d+\])/g);
  const byN = new Map(answer.sources.map((s) => [s.n, s]));
  return (
    <section className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-4 dark:border-indigo-500/30 dark:bg-slate-900">
      <p className="leading-relaxed whitespace-pre-wrap">
        {parts.map((part, i) => {
          const m = part.match(/^\[(\d+)\]$/);
          const src = m && byN.get(Number(m[1]));
          return src ? (
            <Link key={i} to={`/documentos/${src.item_id}`} className="font-medium text-indigo-600 dark:text-indigo-400">
              {part}
            </Link>
          ) : (
            <span key={i}>{part}</span>
          );
        })}
      </p>
      {answer.sources.length > 0 && (
        <ol className="space-y-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
          {answer.sources.map((s) => (
            <li key={s.n}>
              <Link to={`/documentos/${s.item_id}`} className="text-slate-600 hover:text-indigo-600 dark:text-slate-400">
                [{s.n}] {s.title}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Overview({ stats }: { stats: Stats }) {
  const navigate = useNavigate();
  if (stats.total === 0)
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
        <p className="font-medium">Tu segundo cerebro está vacío</p>
        <p className="mt-1 text-sm text-slate-500">Sube tus primeros documentos y se clasificarán solos.</p>
        <Link to="/subir" className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-white">
          Subir documentos
        </Link>
      </div>
    );
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        {stats.total} documentos
        {stats.pending > 0 && ` · ${stats.pending} procesándose`}
        {stats.errors > 0 && ` · ${stats.errors} con error`}
      </p>
      {stats.expiring.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={16} /> Vence pronto
          </h2>
          {stats.expiring.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              extra={<p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">Vence el {formatDate(item.expires_on)}</p>}
            />
          ))}
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Categorías</h2>
        <div className="flex flex-wrap gap-2">
          {stats.categories.map((c) => (
            <Chip key={c.value} onClick={() => navigate(`/documentos?categoria=${encodeURIComponent(c.value)}`)}>
              {c.value} <span className="text-slate-400">{c.count}</span>
            </Chip>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Años</h2>
        <div className="flex flex-wrap gap-2">
          {stats.years.map((y) => (
            <Chip key={y.value} onClick={() => navigate(`/documentos?anio=${y.value}`)}>
              {y.value} <span className="text-slate-400">{y.count}</span>
            </Chip>
          ))}
        </div>
      </section>
    </div>
  );
}
