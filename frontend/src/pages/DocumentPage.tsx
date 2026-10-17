import { ArrowLeft, Download, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, type ItemDetail } from "../api";
import { formatDate, StatusBadge } from "../components/ItemCard";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900";

export default function DocumentPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api.get(id).then(setItem, (e: Error) => setError(e.message)), [id]);

  useEffect(() => {
    load();
    api.categories().then(setCategories, () => {});
  }, [load]);

  useEffect(() => {
    if (item && (item.status === "pending" || item.status === "processing")) {
      const timer = setTimeout(load, 3000);
      return () => clearTimeout(timer);
    }
  }, [item, load]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!item) return null;

  const mime = item.document?.mime ?? "";
  const fileUrl = api.fileUrl(item.id);

  const save = async (form: FormData) => {
    const get = (k: string) => (form.get(k) as string) || null;
    await api.update(item.id, {
      title: get("title") ?? item.title,
      category: get("category"),
      doc_type: get("doc_type"),
      doc_date: get("doc_date"),
      expires_on: get("expires_on"),
      year: get("year") ? Number(get("year")) : null,
      tags: (get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      summary: get("summary"),
    });
    setEditing(false);
    load();
  };

  const remove = async () => {
    if (!confirm(`¿Borrar "${item.title}"? No se puede deshacer.`)) return;
    await api.remove(item.id);
    navigate("/documentos");
  };

  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-500">
        <ArrowLeft size={16} /> Volver
      </button>

      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-semibold">{item.title}</h1>
          <StatusBadge item={item} />
        </div>
        <p className="text-sm text-slate-500">
          {[item.category, item.doc_type, item.year].filter(Boolean).join(" · ")}
        </p>
        {item.error && <p className="text-sm text-red-600">{item.error}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={api.fileUrl(item.id, true)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
          <Download size={16} /> Descargar
        </a>
        <button onClick={() => setEditing(!editing)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
          <Pencil size={16} /> Editar
        </button>
        <button
          onClick={() => api.reprocess(item.id).then(load)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
        >
          <RefreshCw size={16} /> Reprocesar
        </button>
        <button onClick={remove} className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 dark:border-red-500/40">
          <Trash2 size={16} /> Borrar
        </button>
      </div>

      {editing ? (
        <form action={save} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <label className="grid gap-1 text-sm">
            Título
            <input name="title" defaultValue={item.title} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              Categoría
              <select name="category" defaultValue={item.category ?? ""} className={field}>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Tipo
              <input name="doc_type" defaultValue={item.doc_type ?? ""} className={field} />
            </label>
            <label className="grid gap-1 text-sm">
              Fecha
              <input type="date" name="doc_date" defaultValue={item.doc_date ?? ""} className={field} />
            </label>
            <label className="grid gap-1 text-sm">
              Vence
              <input type="date" name="expires_on" defaultValue={item.expires_on ?? ""} className={field} />
            </label>
            <label className="grid gap-1 text-sm">
              Año
              <input type="number" name="year" defaultValue={item.year ?? ""} className={field} />
            </label>
            <label className="grid gap-1 text-sm">
              Etiquetas
              <input name="tags" defaultValue={item.tags.join(", ")} className={field} />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Resumen
            <textarea name="summary" rows={3} defaultValue={item.summary ?? ""} className={field} />
          </label>
          <button className="rounded-lg bg-indigo-600 py-2 text-white">Guardar</button>
        </form>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
          {item.summary && <dd className="col-span-2 text-slate-700 dark:text-slate-300">{item.summary}</dd>}
          <Meta label="Fecha" value={formatDate(item.doc_date)} />
          <Meta label="Vence" value={formatDate(item.expires_on)} />
          <Meta label="Archivo" value={item.document?.filename} />
          <Meta label="Páginas" value={item.document?.pages?.toString()} />
          {item.tags.length > 0 && <Meta label="Etiquetas" value={item.tags.join(", ")} />}
          {item.entities.list?.length ? (
            <Meta label="Relacionado" value={item.entities.list.map((e) => (e.role ? `${e.name} (${e.role})` : e.name)).join(", ")} />
          ) : null}
        </dl>
      )}

      {mime === "application/pdf" && <iframe src={fileUrl} title={item.title} className="h-[70vh] w-full rounded-xl border border-slate-200 dark:border-slate-800" />}
      {mime.startsWith("image/") && <img src={fileUrl} alt={item.title} className="w-full rounded-xl border border-slate-200 dark:border-slate-800" />}

      {item.text && (
        <div>
          <button onClick={() => setShowText(!showText)} className="text-sm text-indigo-600 dark:text-indigo-400">
            {showText ? "Ocultar texto" : `Ver texto extraído${item.document?.ocr_used ? " (OCR)" : ""}`}
          </button>
          {showText && (
            <pre className="mt-2 max-h-[60vh] overflow-auto rounded-xl bg-slate-100 p-3 text-xs whitespace-pre-wrap dark:bg-slate-900">{item.text}</pre>
          )}
        </div>
      )}

      <Link to="/" className="block text-center text-sm text-slate-500">
        Volver a buscar
      </Link>
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
