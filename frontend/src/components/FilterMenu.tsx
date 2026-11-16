import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cx } from "./ui";

export type FilterOption = { value: string; label: string; count?: number; hint?: ReactNode };

/** Cierra al pulsar fuera o con Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export const triggerClass = (active: boolean) =>
  cx(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors",
    active ? "border-cobalt/50 bg-cobalt-soft text-ink" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
  );

export const panelClass = "absolute top-full left-0 z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-lift";

/** Filtro de selección múltiple: botón + lista con casillas, recuentos y buscador. */
export default function FilterMenu({
  label,
  icon,
  options,
  selected,
  onChange,
  align = "left",
}: {
  label: string;
  icon?: ReactNode;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  align?: "left" | "right";
}) {
  const { open, setOpen, ref } = usePopover();
  const [find, setFind] = useState("");
  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options;
  }, [find, options]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  const first = options.find((o) => o.value === selected[0]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className={triggerClass(selected.length > 0)} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox">
        {icon && <span className={selected.length ? "text-cobalt" : "text-faint"}>{icon}</span>}
        {label}
        {selected.length === 1 && first && <span className="max-w-28 truncate font-medium text-ink">: {first.label}</span>}
        {selected.length > 1 && <span className="rounded bg-cobalt px-1.5 text-[0.7rem] leading-4 font-semibold text-paper tabular">{selected.length}</span>}
        <ChevronDown size={14} className={cx("text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className={cx(panelClass, align === "right" && "right-0 left-auto")} role="listbox" aria-multiselectable aria-label={label}>
          {options.length > 7 && (
            <label className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search size={14} className="text-faint" />
              <input
                autoFocus
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={`Buscar ${label.toLowerCase()}…`}
                className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-faint focus:outline-none focus-visible:outline-none"
              />
            </label>
          )}
          <ul className="scrollbar-thin max-h-72 overflow-y-auto p-1">
            {shown.map((o) => {
              const on = selected.includes(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-white/[0.05]"
                  >
                    <span
                      className={cx(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-cobalt bg-cobalt text-paper" : "border-line-strong",
                      )}
                    >
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint}
                    {o.count !== undefined && <span className="text-xs text-faint tabular">{o.count}</span>}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-3 py-3 text-sm text-faint">Sin opciones</li>}
          </ul>
          {selected.length > 0 && (
            <div className="border-t border-line p-1">
              <button type="button" onClick={() => onChange([])} className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-muted hover:bg-white/[0.05] hover:text-ink">
                Quitar filtro
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
