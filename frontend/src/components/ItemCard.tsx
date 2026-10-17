import { FileImage, FileText, Loader2, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import type { Item } from "../api";

export const formatDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "";

export function StatusBadge({ item }: { item: Item }) {
  if (item.status === "ready") return null;
  if (item.status === "error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-500/20 dark:text-red-300">
        <TriangleAlert size={12} /> Error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
      <Loader2 size={12} className="animate-spin" /> Procesando
    </span>
  );
}

export function Chip({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

export default function ItemCard({ item, snippet, extra }: { item: Item; snippet?: string; extra?: React.ReactNode }) {
  const isImage = item.document?.mime.startsWith("image/");
  const Icon = isImage ? FileImage : FileText;
  return (
    <Link
      to={`/documentos/${item.id}`}
      className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mt-0.5 self-start rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-medium">{item.title}</h3>
          <StatusBadge item={item} />
        </div>
        <p className="text-xs text-slate-500">
          {[item.category, item.doc_type, item.year, formatDate(item.doc_date)].filter(Boolean).join(" · ")}
        </p>
        {snippet ? (
          <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400" dangerouslySetInnerHTML={{ __html: snippet }} />
        ) : item.summary ? (
          <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{item.summary}</p>
        ) : null}
        {extra}
      </div>
    </Link>
  );
}
