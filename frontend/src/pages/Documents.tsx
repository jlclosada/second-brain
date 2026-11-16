import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  Files,
  FolderOpen,
  Hash,
  Loader2,
  Search,
  Shapes,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import FilterMenu, { panelClass, triggerClass, usePopover, type FilterOption } from "../components/FilterMenu";
import { Badge, Button, cx, Empty, Stat } from "../components/ui";
import { api, type Item } from "../lib/api";
import { capitalize, dayFromIso, fmt, relativeDay } from "../lib/dates";
import { GoLink, Page, useGo } from "../lib/nav";

// Tus papeles como en cualquier gestor documental: una tabla con todo, filtros por categoría,
// tipo, año, estado, etiquetas y vencimiento, orden por cualquier columna y una vista previa a
// la derecha. La caja de búsqueda entiende frases («nómina de junio 2023», «seguro del coche»)
// y combina sus resultados con los filtros. Todo se guarda en la dirección: se puede volver atrás.

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const STATUS: Record<Item["status"], { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  ready: { label: "Listo", tone: "success" },
  pending: { label: "En cola", tone: "neutral" },
  processing: { label: "Leyendo", tone: "accent" },
  error: { label: "Error", tone: "danger" },
};

const EXPIRY: FilterOption[] = [
  { value: "soon", label: "Vence en 60 días" },
  { value: "expired", label: "Ya vencido" },
  { value: "any", label: "Con fecha de vencimiento" },
];

type SortKey = "relevance" | "title" | "type" | "category" | "date" | "expires" | "size" | "added";
type ColumnId = "type" | "category" | "date" | "expires" | "tags" | "size" | "added";

const COLUMNS: { id: ColumnId; label: string; sort?: SortKey; className?: string }[] = [
  { id: "type", label: "Tipo", sort: "type", className: "w-[11rem]" },
  { id: "category", label: "Categoría", sort: "category", className: "w-[9.5rem]" },
  { id: "date", label: "Fecha", sort: "date", className: "w-[8rem]" },
  { id: "expires", label: "Vence", sort: "expires", className: "w-[8rem]" },
  { id: "tags", label: "Etiquetas", className: "w-[13rem]" },
  { id: "size", label: "Tamaño", sort: "size", className: "w-[6rem] text-right" },
  { id: "added", label: "Añadido", sort: "added", className: "w-[8rem]" },
];

const DEFAULT_COLUMNS: ColumnId[] = ["type", "category", "date", "expires", "tags", "added"];
const PAGE_SIZES = [25, 50, 100];

// ── Utilidades ──────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function readColumns(): ColumnId[] {
  try {
    const raw = JSON.parse(localStorage.getItem("docs.columns") ?? "null");
    if (Array.isArray(raw)) return raw.filter((c) => COLUMNS.some((col) => col.id === c));
  } catch {
    /* sin almacenamiento: columnas por defecto */
  }
  return DEFAULT_COLUMNS;
}

const bytes = (n?: number | null) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
};

const daysUntil = (iso: string) => Math.round((dayFromIso(iso).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);

const typeLabel = (item: Item) => (item.doc_type ? capitalize(item.doc_type) : null);

function compare(a: Item, b: Item, key: SortKey): number {
  const str = (x: string | null | undefined) => x ?? "";
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, "es", { sensitivity: "base" });
    case "type":
      return str(a.doc_type).localeCompare(str(b.doc_type), "es");
    case "category":
      return str(a.category).localeCompare(str(b.category), "es");
    case "date":
      return str(a.doc_date ?? (a.year ? `${a.year}` : null)).localeCompare(str(b.doc_date ?? (b.year ? `${b.year}` : null)));
    case "expires":
      return str(a.expires_on || "9999").localeCompare(str(b.expires_on || "9999"));
    case "size":
      return (a.document?.size ?? 0) - (b.document?.size ?? 0);
    case "added":
    default:
      return a.created_at.localeCompare(b.created_at);
  }
}

function exportCsv(rows: Item[]) {
  const head = ["Título", "Tipo", "Categoría", "Fecha", "Vence", "Etiquetas", "Archivo", "Tamaño (bytes)", "Estado", "Añadido"];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.title, r.doc_type, r.category, r.doc_date ?? r.year, r.expires_on, r.tags.join(" "), r.document?.filename, r.document?.size, STATUS[r.status].label, r.created_at.slice(0, 10)]
      .map(cell)
      .join(";"),
  );
  const blob = new Blob([`﻿${[head.map(cell).join(";"), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `documentos-${fmt(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function DocIcon({ item, size = "md" }: { item: Item; size?: "sm" | "md" | "lg" }) {
  const mime = item.document?.mime ?? "";
  const image = mime.startsWith("image/");
  const sheet = /sheet|csv|excel/.test(mime);
  const Icon = image ? FileImage : sheet ? FileSpreadsheet : FileText;
  const tone = image ? "text-violet bg-violet/10" : sheet ? "text-moss bg-moss-soft" : mime.includes("pdf") ? "text-clay bg-clay-soft" : "text-cobalt bg-cobalt-soft";
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-lg", tone, size === "sm" ? "size-8" : size === "md" ? "size-9" : "size-11")}>
      <Icon size={size === "lg" ? 20 : 16} />
    </span>
  );
}

function Expiry({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-faint">—</span>;
  const days = daysUntil(iso);
  const tone = days < 0 ? "danger" : days <= 30 ? "warning" : "neutral";
  return (
    <Badge tone={tone} className="tabular">
      {days < 0 ? "Vencido" : relativeDay(iso)}
    </Badge>
  );
}

function SortHeader({ label, k, sort, dir, onSort, className }: { label: string; k?: SortKey; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; className?: string }) {
  if (!k) return <th className={cx("px-3 py-2.5 text-left font-medium", className)}>{label}</th>;
  const on = sort === k;
  const Icon = !on ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cx("px-3 py-2.5 text-left font-medium", className)} aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cx("inline-flex items-center gap-1 rounded transition-colors hover:text-ink", on && "text-ink", className?.includes("text-right") && "flex-row-reverse")}
      >
        {label}
        <Icon size={12} className={on ? "text-cobalt" : "opacity-40"} />
      </button>
    </th>
  );
}

function ColumnsMenu({ visible, onChange }: { visible: ColumnId[]; onChange: (c: ColumnId[]) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button type="button" className={triggerClass(false)} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Columns3 size={15} className="text-faint" /> Columnas
      </button>
      {open && (
        <div className={cx(panelClass, "right-0 left-auto w-52 p-1")}>
          {COLUMNS.map((c) => {
            const on = visible.includes(c.id);
            return (
              <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/[0.05]">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? visible.filter((v) => v !== c.id) : COLUMNS.map((x) => x.id).filter((x) => x === c.id || visible.includes(x)))}
                  className="size-4 accent-[var(--cobalt)]"
                />
                {c.label}
              </label>
            );
          })}
          <button type="button" onClick={() => onChange(DEFAULT_COLUMNS)} className="mt-1 w-full rounded-lg border-t border-line px-2.5 py-1.5 text-left text-sm text-muted hover:text-ink">
            Restablecer
          </button>
        </div>
      )}
    </div>
  );
}

function UploadButtons({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const send = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const r = await api.upload(files);
      if (r.created.length)
        toast(`${r.created.length === 1 ? "Documento subido" : `${r.created.length} documentos subidos`}. Lo leo y lo ordeno en un momento.`);
      if (r.duplicates.length) toast(`Ya tenías ${r.duplicates.join(", ")}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input ref={input} type="file" multiple hidden onChange={(e) => send([...(e.target.files ?? [])])} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => send([...(e.target.files ?? [])])} />
      <Button className="sm:hidden" onClick={() => camera.current?.click()} aria-label="Hacer una foto de un documento">
        <Camera size={16} />
      </Button>
      <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        Subir documentos
      </Button>
    </>
  );
}

function Preview({ item, snippet, onClose, onTag }: { item: Item; snippet?: string; onClose: () => void; onTag: (t: string) => void }) {
  const mime = item.document?.mime ?? "";
  const rows: [string, ReactNode][] = [
    ["Tipo", typeLabel(item) ?? "—"],
    ["Categoría", item.category ?? "—"],
    ["Fecha", item.doc_date ? fmt(item.doc_date, "d 'de' MMMM yyyy") : item.year ?? "—"],
    ["Vence", <Expiry key="e" iso={item.expires_on} />],
    ["Estado", <Badge key="s" tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>],
    ["Archivo", <span key="f" className="break-all">{item.document?.filename ?? "—"}</span>],
    ["Tamaño", `${bytes(item.document?.size)}${item.document?.pages ? ` · ${item.document.pages} pág.` : ""}`],
    ["Añadido", fmt(item.created_at, "d MMM yyyy, HH:mm")],
  ];
  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      aria-label={`Vista previa: ${item.title}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-line-strong bg-surface shadow-[-24px_0_60px_-20px_rgb(0_0_0/0.7)]"
    >
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <DocIcon item={item} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-snug font-semibold">{item.title}</h2>
          <p className="mt-0.5 text-sm text-muted">{[typeLabel(item), item.category].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar vista previa" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-ink">
          <X size={18} />
        </button>
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
        {item.status === "ready" && (mime.includes("pdf") || mime.startsWith("image/")) && (
          <div className="mb-5 overflow-hidden rounded-xl border border-line bg-sunken">
            {mime.startsWith("image/") ? (
              <img src={api.fileUrl(item.id)} alt={item.title} className="max-h-72 w-full object-contain" />
            ) : (
              <iframe src={`${api.fileUrl(item.id)}#toolbar=0&view=FitH`} title={item.title} className="h-72 w-full bg-white" />
            )}
          </div>
        )}

        {snippet && (
          <div className="mb-5 rounded-xl border border-cobalt/30 bg-cobalt-soft px-3.5 py-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-cobalt">
              <Search size={12} /> Coincidencia
            </p>
            <p className="text-muted" dangerouslySetInnerHTML={{ __html: snippet }} />
          </div>
        )}

        {item.summary && (
          <section className="mb-5">
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">Resumen</h3>
            <p className="text-sm leading-relaxed text-muted">{item.summary}</p>
          </section>
        )}

        <section className="mb-5">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">Detalles</h3>
          <dl className="divide-y divide-line rounded-xl border border-line">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 px-3.5 py-2 text-sm">
                <dt className="text-faint">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {item.tags.length > 0 && (
          <section className="mb-5">
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">Etiquetas</h3>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onTag(t)}
                  className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-muted ring-1 ring-line ring-inset hover:bg-cobalt-soft hover:text-cobalt"
                >
                  #{t}
                </button>
              ))}
            </div>
          </section>
        )}

        {item.error && (
          <p className="flex items-start gap-2 rounded-xl border border-clay/30 bg-clay-soft px-3.5 py-3 text-sm text-clay">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {item.error}
          </p>
        )}
      </div>

      <footer className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-line px-5 py-3.5 pb-safe">
        <GoLink to={`/documentos/${item.id}`} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-3.5 text-sm font-medium hover:border-line-strong">
          <FolderOpen size={15} /> Ver ficha completa
        </GoLink>
        <a href={api.fileUrl(item.id, true)} className="inline-flex size-10 items-center justify-center rounded-lg border border-line text-muted hover:text-ink" aria-label="Descargar" title="Descargar">
          <Download size={16} />
        </a>
        <a
          href={api.fileUrl(item.id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-cobalt px-3.5 text-sm font-semibold text-paper hover:brightness-110"
        >
          Abrir <ArrowUpRight size={15} />
        </a>
      </footer>
    </motion.aside>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const go = useGo();
  const searchBox = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(params.get("q") ?? "");
  const q = useDebounced(text.trim(), 160);
  const [over, setOver] = useState(false);
  const [columns, setColumnsState] = useState<ColumnId[]>(readColumns);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Estado en la dirección
  const list = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);
  const cats = list("cat");
  const types = list("tipo");
  const years = list("anio");
  const statuses = list("estado");
  const tags = list("tag");
  const expiry = list("vence");
  const recent = params.get("recientes") === "1";
  const sort = (params.get("orden") as SortKey) || (q ? "relevance" : "added");
  const dir = (params.get("dir") as "asc" | "desc") || (sort === "title" || sort === "expires" ? "asc" : "desc");
  const pageSize = PAGE_SIZES.includes(Number(params.get("por"))) ? Number(params.get("por")) : 25;
  const page = Math.max(1, Number(params.get("pag")) || 1);

  const update = (patch: Record<string, string | string[] | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          const value = Array.isArray(v) ? v.join(",") : v;
          if (value) next.set(k, value);
          else next.delete(k);
        }
        if (!("pag" in patch)) next.delete("pag");
        next.delete("subir");
        return next;
      },
      { replace: true },
    );
  };

  const setColumns = (c: ColumnId[]) => {
    setColumnsState(c);
    try {
      localStorage.setItem("docs.columns", JSON.stringify(c));
    } catch {
      /* sin almacenamiento */
    }
  };

  useEffect(() => {
    if ((params.get("q") ?? "") !== q) update({ q: q || null, orden: null, dir: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) searchBox.current?.focus();
    if (params.get("subir")) toast("Pulsa «Subir documentos» o arrastra los archivos a esta pantalla");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docs = useQuery({
    queryKey: ["documents", "all"],
    queryFn: () => api.documents({ limit: 2000 }),
    refetchInterval: (s) => (s.state.data?.items.some((i) => i.status === "pending" || i.status === "processing") ? 3000 : false),
  });
  const results = useQuery({
    queryKey: ["doc-search", q],
    queryFn: () => api.search(q, { kind: "document", limit: 100 }),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["archive"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };

  const all = useMemo(() => docs.data?.items ?? [], [docs.data]);
  const today = new Date().toDateString();

  // Opciones de cada filtro, con recuentos sobre todos los documentos
  const facets = useMemo(() => {
    const count = (values: (string | null | undefined)[]) => {
      const m = new Map<string, number>();
      for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
      return m;
    };
    const opts = (m: Map<string, number>, label = (v: string) => v) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).map(([value, n]) => ({ value, label: label(value), count: n }));
    return {
      cat: opts(count(all.map((i) => i.category))),
      tipo: opts(count(all.map((i) => i.doc_type)), capitalize),
      anio: [...count(all.map((i) => (i.year ? String(i.year) : null))).entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([value, n]) => ({ value, label: value, count: n })),
      estado: (Object.keys(STATUS) as Item["status"][])
        .map((s) => ({ value: s, label: STATUS[s].label, count: all.filter((i) => i.status === s).length }))
        .filter((o) => o.count > 0),
      tag: opts(count(all.flatMap((i) => i.tags)), (t) => `#${t}`),
    };
  }, [all]);

  const hits = results.data && q ? results.data : undefined;
  const hitIndex = useMemo(() => new Map(hits?.hits.map((h, i) => [h.item.id, i]) ?? []), [hits]);
  const snippets = useMemo(() => new Map(hits?.hits.map((h) => [h.item.id, h.snippet]) ?? []), [hits]);

  const rows = useMemo(() => {
    const nq = norm(q);
    const parsedDates = !!hits && (hits.months.length > 0 || hits.years.length > 0);
    const textMatch = (i: Item) =>
      !parsedDates && norm([i.title, i.document?.filename, i.doc_type, i.category, i.tags.join(" ")].join(" ")).includes(nq);
    const now = new Date(today).getTime();
    const filtered = all.filter((i) => {
      if (q && !hitIndex.has(i.id) && !textMatch(i)) return false;
      if (cats.length && !cats.includes(i.category ?? "")) return false;
      if (types.length && !types.includes(i.doc_type ?? "")) return false;
      if (years.length && !years.includes(String(i.year ?? ""))) return false;
      if (statuses.length && !statuses.includes(i.status)) return false;
      if (tags.length && !tags.every((t) => i.tags.includes(t))) return false;
      if (recent && now - new Date(i.created_at).getTime() > 30 * 86_400_000) return false;
      if (expiry.length) {
        const d = i.expires_on ? daysUntil(i.expires_on) : null;
        const ok =
          (expiry.includes("any") && d !== null) || (expiry.includes("soon") && d !== null && d >= 0 && d <= 60) || (expiry.includes("expired") && d !== null && d < 0);
        if (!ok) return false;
      }
      return true;
    });
    const sign = dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort === "relevance") {
        const ra = hitIndex.get(a.id) ?? 1e6;
        const rb = hitIndex.get(b.id) ?? 1e6;
        return ra - rb || b.created_at.localeCompare(a.created_at);
      }
      return sign * compare(a, b, sort) || b.created_at.localeCompare(a.created_at);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, hits, hitIndex, params, today]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const pageRows = rows.slice((current - 1) * pageSize, current * pageSize);
  const preview = previewId ? all.find((i) => i.id === previewId) : undefined;

  // Métricas
  const total = all.length;
  const busy = all.filter((i) => i.status === "pending" || i.status === "processing").length;
  const errors = all.filter((i) => i.status === "error").length;
  const soon = all.filter((i) => i.expires_on && daysUntil(i.expires_on) >= 0 && daysUntil(i.expires_on) <= 60).length;
  const added30 = all.filter((i) => Date.now() - new Date(i.created_at).getTime() <= 30 * 86_400_000).length;

  const activeFilters: { key: string; label: string; clear: () => void }[] = [
    ...cats.map((v) => ({ key: `cat${v}`, label: `Categoría: ${v}`, clear: () => update({ cat: cats.filter((x) => x !== v) }) })),
    ...types.map((v) => ({ key: `t${v}`, label: `Tipo: ${capitalize(v)}`, clear: () => update({ tipo: types.filter((x) => x !== v) }) })),
    ...years.map((v) => ({ key: `y${v}`, label: `Año: ${v}`, clear: () => update({ anio: years.filter((x) => x !== v) }) })),
    ...statuses.map((v) => ({ key: `s${v}`, label: `Estado: ${STATUS[v as Item["status"]]?.label ?? v}`, clear: () => update({ estado: statuses.filter((x) => x !== v) }) })),
    ...tags.map((v) => ({ key: `g${v}`, label: `#${v}`, clear: () => update({ tag: tags.filter((x) => x !== v) }) })),
    ...expiry.map((v) => ({ key: `e${v}`, label: EXPIRY.find((e) => e.value === v)?.label ?? v, clear: () => update({ vence: expiry.filter((x) => x !== v) }) })),
    ...(recent ? [{ key: "recent", label: "Añadidos en 30 días", clear: () => update({ recientes: null }) }] : []),
  ];
  const clearAll = () => {
    setText("");
    update({ q: null, cat: null, tipo: null, anio: null, estado: null, tag: null, vence: null, recientes: null, orden: null, dir: null });
  };

  const onSort = (k: SortKey) => {
    if (sort === k) update({ orden: k, dir: dir === "asc" ? "desc" : "asc" });
    else update({ orden: k, dir: k === "title" || k === "expires" || k === "type" || k === "category" ? "asc" : "desc" });
  };

  const addTag = (t: string) => {
    if (!tags.includes(t)) update({ tag: [...tags, t] });
  };

  const drop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    try {
      const r = await api.upload(files);
      toast(`${r.created.length} subidos. Los leo y los ordeno en un momento.`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && rows[0]) setPreviewId(rows[0].id);
    if (e.key === "Escape") setText("");
  };

  useEffect(() => {
    if (!previewId) return;
    const onEsc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && setPreviewId(null);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [previewId]);

  const show = (c: ColumnId) => columns.includes(c);
  const understood = hits && (hits.months.length > 0 || hits.years.length > 0);

  return (
    <Page>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cx("min-h-[70vh] rounded-2xl transition-colors", over && "bg-cobalt-soft outline-2 outline-offset-8 outline-cobalt outline-dashed")}
      >
        {/* Cabecera */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.6rem] leading-tight font-semibold sm:text-[1.85rem]">Documentos</h1>
            <p className="mt-1 text-[0.95rem] text-muted">Todo lo que subes o descargas, leído, clasificado y listo para encontrar.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => exportCsv(rows)} disabled={!rows.length} title="Exportar la vista actual a CSV">
              <Download size={16} /> <span className="hidden sm:inline">Exportar</span>
            </Button>
            <UploadButtons onDone={refresh} />
          </div>
        </header>

        {/* Métricas (también son atajos de filtro) */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total" value={total} hint={`${facets.cat.length} categorías · ${facets.tipo.length} tipos`} icon={<Files size={15} />} tone="accent" onClick={clearAll} />
          <Stat
            label="Añadidos (30 días)"
            value={added30}
            hint="Filtrar los recientes"
            icon={<Sparkles size={15} />}
            tone="success"
            active={recent}
            onClick={() => update({ recientes: recent ? null : "1" })}
          />
          <Stat
            label="Vencen en 60 días"
            value={soon}
            hint={soon ? "Revisa y renueva a tiempo" : "Nada por renovar"}
            icon={<CalendarClock size={15} />}
            tone="warning"
            active={expiry.includes("soon")}
            onClick={() => update({ vence: expiry.includes("soon") ? expiry.filter((x) => x !== "soon") : [...expiry, "soon"], orden: "expires", dir: "asc" })}
          />
          <Stat
            label="Procesando / con error"
            value={
              <span>
                {busy}
                <span className="text-faint"> / </span>
                <span className={errors ? "text-clay" : undefined}>{errors}</span>
              </span>
            }
            hint={busy ? "Leyendo con OCR y clasificando…" : "Todo al día"}
            icon={busy ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />}
            tone={errors ? "danger" : "neutral"}
            active={statuses.length > 0 && statuses.every((s) => s !== "ready")}
            onClick={() => update({ estado: statuses.length ? null : ["pending", "processing", "error"] })}
          />
        </div>

        {/* Búsqueda y filtros */}
        <div className="glass rounded-xl">
          <div className="flex flex-col gap-3 border-b border-line p-3 xl:flex-row xl:items-center">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-line bg-sunken px-3 focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/20">
              <Search size={16} className="shrink-0 text-faint" />
              <input
                ref={searchBox}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder="Buscar por nombre, contenido o frase: «nómina de junio 2023», «seguro del coche»…"
                aria-label="Buscar documentos"
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent text-[0.95rem] placeholder:text-faint focus:outline-none focus-visible:outline-none"
              />
              {results.isFetching && q && <Loader2 size={15} className="animate-spin text-faint" />}
              {text && (
                <button type="button" onClick={() => setText("")} aria-label="Borrar búsqueda" className="text-faint hover:text-ink">
                  <X size={16} />
                </button>
              )}
            </label>
            <div className="scrollbar-none -mx-3 flex items-center gap-2 overflow-x-auto px-3 xl:mx-0 xl:overflow-visible xl:px-0">
              <FilterMenu label="Categoría" icon={<Shapes size={14} />} options={facets.cat} selected={cats} onChange={(v) => update({ cat: v })} />
              <FilterMenu label="Tipo" icon={<FileText size={14} />} options={facets.tipo} selected={types} onChange={(v) => update({ tipo: v })} />
              <FilterMenu label="Año" icon={<CalendarClock size={14} />} options={facets.anio} selected={years} onChange={(v) => update({ anio: v })} />
              <FilterMenu label="Etiquetas" icon={<Hash size={14} />} options={facets.tag} selected={tags} onChange={(v) => update({ tag: v })} />
              <FilterMenu label="Vencimiento" icon={<AlertTriangle size={14} />} options={EXPIRY} selected={expiry} onChange={(v) => update({ vence: v })} />
              <FilterMenu label="Estado" options={facets.estado} selected={statuses} onChange={(v) => update({ estado: v })} align="right" />
              <span className="hidden md:block">
                <ColumnsMenu visible={columns} onChange={setColumns} />
              </span>
            </div>
          </div>

          {(activeFilters.length > 0 || q) && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2.5 text-sm">
              <span className="mr-1 text-muted">
                <span className="font-semibold text-ink tabular">{rows.length}</span> de {total}
              </span>
              {q && (
                <span className="inline-flex h-7 items-center gap-1 rounded-md bg-white/[0.06] pr-1 pl-2 ring-1 ring-line ring-inset">
                  «{hits?.text || q}»
                  <button type="button" onClick={() => setText("")} aria-label="Quitar búsqueda" className="rounded p-0.5 text-faint hover:text-ink">
                    <X size={13} />
                  </button>
                </span>
              )}
              {understood &&
                hits.months.map((m) => (
                  <Badge key={`m${m}`} tone="accent">
                    {MONTHS[m - 1]}
                  </Badge>
                ))}
              {understood &&
                hits.years.map((y) => (
                  <Badge key={`y${y}`} tone="warning">
                    {y}
                  </Badge>
                ))}
              {activeFilters.map((f) => (
                <span key={f.key} className="inline-flex h-7 items-center gap-1 rounded-md bg-cobalt-soft pr-1 pl-2 text-ink ring-1 ring-cobalt/30 ring-inset">
                  {f.label}
                  <button type="button" onClick={f.clear} aria-label={`Quitar ${f.label}`} className="rounded p-0.5 text-muted hover:text-ink">
                    <X size={13} />
                  </button>
                </span>
              ))}
              <button type="button" onClick={clearAll} className="ml-1 text-sm text-cobalt hover:underline">
                Limpiar todo
              </button>
            </div>
          )}

          {/* Tabla (tablet y ordenador) */}
          {docs.isPending ? (
            <div className="space-y-2 p-4" role="status" aria-label="Cargando documentos">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-white/[0.03]" />
              ))}
            </div>
          ) : !total ? (
            <div className="p-6">
              <Empty icon={<FileText size={20} />} title="Aún no hay documentos">
                Lo que descargues se ordena solo aquí. También puedes subirlos o arrastrarlos a esta pantalla.
              </Empty>
            </div>
          ) : !rows.length ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-xl bg-white/[0.05] text-faint">
                <Search size={20} />
              </span>
              <p className="font-medium">Ningún documento coincide</p>
              <p className="max-w-md text-sm text-muted">Quita algún filtro o prueba con otras palabras. Jarvis también puede buscar dentro de los documentos por ti.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={clearAll}>
                  Limpiar filtros
                </Button>
                {q && (
                  <Button size="sm" onClick={() => go(`/?q=${encodeURIComponent(`Busca en mis documentos: ${q}`)}`)}>
                    <Sparkles size={14} /> Preguntar a Jarvis
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="scrollbar-thin hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] table-fixed text-sm">
                  <thead className="border-b border-line bg-sunken/60 text-xs text-faint">
                    <tr>
                      <SortHeader label="Nombre" k="title" sort={sort} dir={dir} onSort={onSort} className="pl-4" />
                      {COLUMNS.filter((c) => show(c.id)).map((c) => (
                        <SortHeader key={c.id} label={c.label} k={c.sort} sort={sort} dir={dir} onSort={onSort} className={c.className} />
                      ))}
                      <th className="w-[5.5rem] px-3 py-2.5">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {pageRows.map((item) => {
                      const selected = item.id === previewId;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setPreviewId(selected ? null : item.id)}
                          className={cx("group cursor-pointer transition-colors", selected ? "bg-cobalt-soft" : "hover:bg-white/[0.025]")}
                        >
                          <td className="py-2.5 pr-3 pl-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <DocIcon item={item} size="sm" />
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  className="block max-w-full truncate text-left font-medium text-ink group-hover:text-cobalt"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewId(item.id);
                                  }}
                                >
                                  {item.title}
                                </button>
                                <p className="flex items-center gap-1.5 truncate text-xs text-faint">
                                  {item.status !== "ready" && <Badge tone={STATUS[item.status].tone} className="h-5 px-1.5 text-[0.68rem]">{STATUS[item.status].label}</Badge>}
                                  {snippets.get(item.id) ? (
                                    <span className="truncate" dangerouslySetInnerHTML={{ __html: snippets.get(item.id)! }} />
                                  ) : (
                                    <span className="truncate">{item.document?.filename}</span>
                                  )}
                                </p>
                              </div>
                            </div>
                          </td>
                          {show("type") && <td className="truncate px-3 py-2.5 text-muted">{typeLabel(item) ?? <span className="text-faint">—</span>}</td>}
                          {show("category") && (
                            <td className="px-3 py-2.5">{item.category ? <Badge>{item.category}</Badge> : <span className="text-faint">—</span>}</td>
                          )}
                          {show("date") && (
                            <td className="px-3 py-2.5 text-muted tabular">{item.doc_date ? fmt(item.doc_date, "d MMM yyyy") : item.year ?? <span className="text-faint">—</span>}</td>
                          )}
                          {show("expires") && (
                            <td className="px-3 py-2.5">
                              <Expiry iso={item.expires_on} />
                            </td>
                          )}
                          {show("tags") && (
                            <td className="px-3 py-2.5">
                              <div className="flex gap-1 overflow-hidden">
                                {item.tags.slice(0, 3).map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      addTag(t);
                                    }}
                                    className="shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 text-[0.72rem] text-muted hover:bg-cobalt-soft hover:text-cobalt"
                                  >
                                    #{t}
                                  </button>
                                ))}
                                {item.tags.length > 3 && <span className="shrink-0 py-0.5 text-[0.72rem] text-faint">+{item.tags.length - 3}</span>}
                              </div>
                            </td>
                          )}
                          {show("size") && <td className="px-3 py-2.5 text-right text-muted tabular">{bytes(item.document?.size)}</td>}
                          {show("added") && <td className="px-3 py-2.5 text-muted tabular">{fmt(item.created_at, "d MMM yyyy")}</td>}
                          <td className="px-3 py-2.5">
                            <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                              <a
                                href={api.fileUrl(item.id, true)}
                                onClick={(e) => e.stopPropagation()}
                                className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white/[0.07] hover:text-ink"
                                aria-label={`Descargar ${item.title}`}
                                title="Descargar"
                              >
                                <Download size={15} />
                              </a>
                              <a
                                href={api.fileUrl(item.id)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white/[0.07] hover:text-ink"
                                aria-label={`Abrir ${item.title}`}
                                title="Abrir"
                              >
                                <ArrowUpRight size={15} />
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Lista (móvil) */}
              <ul className="divide-y divide-line md:hidden">
                {pageRows.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => setPreviewId(item.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left">
                      <DocIcon item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {[typeLabel(item), item.doc_date ? fmt(item.doc_date, "d MMM yyyy") : item.year].filter(Boolean).join(" · ")}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {item.category && <Badge className="h-5 text-[0.68rem]">{item.category}</Badge>}
                          {item.status !== "ready" && <Badge tone={STATUS[item.status].tone} className="h-5 text-[0.68rem]">{STATUS[item.status].label}</Badge>}
                          {item.expires_on && <Expiry iso={item.expires_on} />}
                        </span>
                      </span>
                      <ChevronRight size={16} className="mt-2 shrink-0 text-faint" />
                    </button>
                  </li>
                ))}
              </ul>

              {/* Paginación */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
                <span className="tabular">
                  {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, rows.length)} de {rows.length}
                </span>
                <div className="flex items-center gap-3">
                  <label className="hidden items-center gap-2 sm:flex">
                    Filas
                    <select
                      value={pageSize}
                      onChange={(e) => update({ por: e.target.value === "25" ? null : e.target.value })}
                      className="h-8 rounded-lg border border-line bg-surface px-2 text-ink"
                    >
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={current <= 1}
                      onClick={() => update({ pag: current - 1 > 1 ? String(current - 1) : null })}
                      className="flex size-8 items-center justify-center rounded-lg border border-line hover:text-ink disabled:opacity-40"
                      aria-label="Página anterior"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span className="px-2 tabular">
                      {current} / {pages}
                    </span>
                    <button
                      type="button"
                      disabled={current >= pages}
                      onClick={() => update({ pag: String(current + 1) })}
                      className="flex size-8 items-center justify-center rounded-lg border border-line hover:text-ink disabled:opacity-40"
                      aria-label="Página siguiente"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <p className="mt-3 hidden text-xs text-faint lg:block">
          Consejo: <kbd>Intro</kbd> abre la vista previa del primer resultado · <kbd>Esc</kbd> la cierra · arrastra archivos a esta pantalla para subirlos.
        </p>
      </div>

      <AnimatePresence>
        {preview && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewId(null)}
              className="fixed inset-0 z-30 bg-black/40 xl:bg-black/20"
              aria-hidden
            />
            <Preview key={preview.id} item={preview} snippet={snippets.get(preview.id)} onClose={() => setPreviewId(null)} onTag={addTag} />
          </>
        )}
      </AnimatePresence>
    </Page>
  );
}
