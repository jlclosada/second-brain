import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, CheckSquare, CornerDownLeft, NotebookPen, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api, itemPath, type CaptureKind, type CaptureResult, type Kind } from "../lib/api";
import { dueLabel, relativeDay, time } from "../lib/dates";
import { useGo } from "../lib/nav";
import { cx, Sheet } from "./ui";

// Captura rápida: escribes como hablas y se ve, antes de guardar, en qué se va a
// convertir. Si se equivoca, eliges tú el tipo con un toque.

export const CAPTURE_KINDS: { kind: CaptureKind; label: string; icon: typeof CheckSquare }[] = [
  { kind: "task", label: "Tarea", icon: CheckSquare },
  { kind: "event", label: "Evento", icon: CalendarDays },
  { kind: "reminder", label: "Aviso", icon: Bell },
  { kind: "note", label: "Nota", icon: NotebookPen },
];
const SAVED = { task: "Tarea guardada", event: "Evento guardado", reminder: "Aviso programado", note: "Nota guardada" };
const EXAMPLES = [
  "Dentista el martes a las 10",
  "Pagar el IBI el 5 de noviembre #casa",
  "Recuérdame llamar a mamá en 2 horas",
  "nota: el código del trastero es 4512",
];

/** El valor tras `ms` sin cambios: así no se interpreta cada tecla (con Claude, cada una costaría). */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function describeCapture(c: CaptureResult): string {
  if (c.kind === "event" && c.starts_at)
    return c.all_day ? `${relativeDay(c.starts_at)}, todo el día` : `${relativeDay(c.starts_at)} a las ${time(c.starts_at)}`;
  if (c.kind === "reminder" && c.remind_at) return `te aviso ${relativeDay(c.remind_at)} a las ${time(c.remind_at)}`;
  if (c.kind === "task") return dueLabel(c.due_date, c.due_time) ?? "sin fecha";
  return "en tus notas";
}

export function CaptureBox({ autoFocus, onSaved, compact }: { autoFocus?: boolean; onSaved?: () => void; compact?: boolean }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<CaptureKind | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const query = useDebounced(text.trim(), 400);
  const queryClient = useQueryClient();
  const go = useGo();
  const [example, setExample] = useState(0);
  // En el móvil el ejemplo va solo, sin el «Apunta lo que sea», para que quepa.
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

  useEffect(() => {
    if (text) return;
    const id = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3500);
    return () => clearInterval(id);
  }, [text]);

  // Al borrar el texto se vuelve a la detección automática.
  useEffect(() => {
    if (!text) setKind(null);
  }, [text]);

  const preview = useQuery({
    queryKey: ["capture-preview", query, kind],
    queryFn: () => api.capture(query, false, kind ?? undefined),
    enabled: query.length > 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const c = query.length > 2 ? preview.data : undefined;
  const shown: CaptureKind | null = kind ?? c?.kind ?? null;

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      const r = await api.capture(value, true, kind ?? undefined);
      setText("");
      queryClient.invalidateQueries();
      toast.success(`${SAVED[r.kind]}: ${r.title || value}`, {
        description: describeCapture(r),
        action:
          r.created_id && r.kind !== "reminder" ? { label: "Abrir", onClick: () => go(itemPath(r.kind as Kind, r.created_id!), "nav-forward") } : undefined,
      });
      onSaved?.();
      input.current?.focus();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className={cx("rounded-2xl border border-line bg-surface shadow-lift transition-colors focus-within:border-cobalt", compact && "shadow-none")}
    >
      <div className="flex items-center gap-3 px-4">
        <Sparkles size={19} className="shrink-0 text-ochre" aria-hidden />
        <label htmlFor="captura" className="sr-only">
          Apunta algo
        </label>
        <input
          id="captura"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && text && (e.stopPropagation(), setText(""))}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={narrow ? EXAMPLES[example] : `Apunta lo que sea: «${EXAMPLES[example]}»`}
          className="h-14 min-w-0 flex-1 bg-transparent text-[1.05rem] placeholder:text-faint focus:outline-none focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || saving}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-paper transition-opacity disabled:opacity-30"
        >
          Guardar <CornerDownLeft size={14} aria-hidden className="hidden sm:inline" />
        </button>
      </div>
      {text.trim().length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5">
          <div role="radiogroup" aria-label="Guardar como" className="flex flex-wrap gap-1.5">
            {CAPTURE_KINDS.map(({ kind: k, label, icon: Icon }) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={shown === k}
                onClick={() => setKind(kind === k ? null : k)}
                className={cx(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                  shown === k ? "border-cobalt bg-cobalt-soft font-medium text-cobalt" : "border-line text-muted hover:text-ink",
                )}
              >
                <Icon size={14} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <p className="min-w-0 text-sm text-muted" aria-live="polite">
            {query.length <= 2 ? (
              "Sigue escribiendo…"
            ) : c ? (
              <>
                <span className="font-medium text-ink">{c.title || text.trim()}</span>, {describeCapture(c)}
                {c.tags.length > 0 && <span className="text-faint"> · #{c.tags.join(" #")}</span>}
                {kind && <span className="text-faint"> · elegido por ti</span>}
              </>
            ) : (
              "Interpretando…"
            )}
          </p>
        </div>
      )}
    </form>
  );
}

/** La captura como ventana: se abre con el botón + o con la tecla C. */
export function CaptureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Apuntar algo" wide>
      <CaptureBox autoFocus compact onSaved={onClose} />
      <p className="mt-3 text-sm text-faint">
        Fechas en español: «mañana por la tarde», «el 3/11 a las 9:15», «en 2 horas». Añade #etiquetas y «!» para urgente.
      </p>
    </Sheet>
  );
}
