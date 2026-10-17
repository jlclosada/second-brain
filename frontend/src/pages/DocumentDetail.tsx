import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { Button, Empty, Field, Input, Loading, Select, Textarea } from "../components/ui";
import { api, type Item, type ItemDetail } from "../lib/api";
import { fmt } from "../lib/dates";
import { GoLink, Page, Shared, useGo } from "../lib/nav";

const sizeLabel = (bytes: number) => (bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default function DocumentPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const go = useGo();
  const doc = useQuery({
    queryKey: ["document", id],
    queryFn: () => api.document(id),
    placeholderData: () => {
      for (const [, data] of queryClient.getQueriesData<{ items: Item[] }>({ queryKey: ["documents"] })) {
        const found = data?.items.find((i) => i.id === id);
        if (found) return { ...found, entities: {}, text: null } as ItemDetail;
      }
      return undefined;
    },
    refetchInterval: (q) => (q.state.data && ["pending", "processing"].includes(q.state.data.status) ? 2500 : false),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
  const [form, setForm] = useState<ItemDetail | null>(null);

  useEffect(() => {
    if (doc.data && !doc.isPlaceholderData) setForm(doc.data);
  }, [doc.data, doc.isPlaceholderData]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["document", id] });
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    try {
      await api.updateDocument(id, {
        title: form.title,
        category: form.category,
        doc_type: form.doc_type,
        doc_date: form.doc_date || null,
        expires_on: form.expires_on || null,
        year: form.year || null,
        summary: form.summary,
        tags: form.tags,
        project_id: form.project_id || null,
      });
      refresh();
      toast("Cambios guardados");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm("¿Eliminar este documento y su archivo original? No se puede deshacer.")) return;
    await api.deleteDocument(id);
    refresh();
    toast("Documento eliminado");
    go("/documentos", "nav-back");
  };

  const reprocess = async () => {
    await api.reprocess(id);
    refresh();
    toast("Se volverá a leer y clasificar");
  };

  if (doc.isPending) return <Loading />;
  if (!doc.data) return <Empty title="Este documento no existe" />;
  const d = doc.data;
  const set = (patch: Partial<ItemDetail>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const previewable = d.document && (d.document.mime === "application/pdf" || d.document.mime.startsWith("image/"));

  return (
    <Page>
      <GoLink to="/documentos" type="nav-back" className="mb-4 inline-flex items-center gap-1.5 text-muted hover:text-ink">
        <ArrowLeft size={17} /> Documentos
      </GoLink>
      <header className="mb-6">
        <Shared name={`doc-${d.id}`}>
          <h1 className="text-[1.9rem] leading-tight font-semibold sm:text-[2.3rem]">{d.title}</h1>
        </Shared>
        {d.document && (
          <p className="mt-1 text-sm text-muted">
            {d.document.filename}, {sizeLabel(d.document.size)}
            {d.document.pages ? `, ${d.document.pages} páginas` : ""}
            {d.document.ocr_used ? ", leído con OCR" : ""}. Subido el {fmt(d.created_at, "d 'de' MMMM yyyy")}.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={api.fileUrl(id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 hover:bg-sunken"
          >
            Abrir original
          </a>
          <a href={api.fileUrl(id, true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-muted hover:bg-sunken hover:text-ink">
            <Download size={16} /> Descargar
          </a>
          <Button variant="ghost" onClick={reprocess}>
            <RefreshCw size={16} /> Volver a clasificar
          </Button>
          <Button variant="danger" onClick={remove}>
            <Trash2 size={16} /> Eliminar
          </Button>
        </div>
      </header>

      {d.status === "error" && (
        <p role="alert" className="mb-6 rounded-lg bg-clay-soft px-4 py-3 text-clay">
          No se pudo leer: {d.error}. Prueba a volver a clasificarlo.
        </p>
      )}
      {(d.status === "pending" || d.status === "processing") && <Loading label="Leyendo y clasificando el documento" />}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {d.summary && <p className="mb-6 text-lg leading-relaxed">{d.summary}</p>}
          {previewable && (
            <div className="mb-6 overflow-hidden rounded-xl border border-line bg-surface">
              {d.document!.mime.startsWith("image/") ? (
                <img src={api.fileUrl(id)} alt={d.title} className="max-h-[70vh] w-full object-contain" />
              ) : (
                <iframe src={api.fileUrl(id)} title={d.title} className="h-[70vh] w-full" />
              )}
            </div>
          )}
          {!!d.entities?.list?.length && (
            <section className="mb-6">
              <h2 className="mb-2 text-lg font-semibold">Datos detectados</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                {d.entities.list.map((e, i) => (
                  <div key={i} className="contents">
                    <dt className="text-muted first-letter:uppercase">{e.role || e.type}</dt>
                    <dd>{e.name}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {d.text && (
            <details className="rounded-xl border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 font-medium">Texto extraído</summary>
              <pre className="max-h-[60vh] overflow-auto px-4 pb-4 font-sans text-sm leading-relaxed whitespace-pre-wrap text-muted">{d.text}</pre>
            </details>
          )}
        </div>

        {form && (
          <form onSubmit={save} className="flex flex-col gap-4 self-start rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">Ficha</h2>
            <Field label="Título">{(fid) => <Input id={fid} value={form.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Categoría">
                {(fid) => (
                  <Select id={fid} value={form.category ?? ""} onChange={(e) => set({ category: e.target.value })}>
                    {categories.data?.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Tipo">{(fid) => <Input id={fid} value={form.doc_type ?? ""} onChange={(e) => set({ doc_type: e.target.value })} />}</Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha">
                {(fid) => <Input id={fid} type="date" value={form.doc_date ?? ""} onChange={(e) => set({ doc_date: e.target.value })} />}
              </Field>
              <Field label="Vence">
                {(fid) => <Input id={fid} type="date" value={form.expires_on ?? ""} onChange={(e) => set({ expires_on: e.target.value })} />}
              </Field>
            </div>
            <Field label="Año">
              {(fid) => (
                <Input
                  id={fid}
                  type="number"
                  inputMode="numeric"
                  value={form.year ?? ""}
                  onChange={(e) => set({ year: e.target.value ? Number(e.target.value) : null })}
                />
              )}
            </Field>
            <Field label="Proyecto o área">
              {(fid) => (
                <Select id={fid} value={form.project_id ?? ""} onChange={(e) => set({ project_id: e.target.value || null })}>
                  <option value="">Ninguno</option>
                  {projects.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Etiquetas" hint="Separadas por comas">
              {(fid) => (
                <Input
                  id={fid}
                  value={form.tags.join(", ")}
                  onChange={(e) =>
                    set({
                      tags: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
            </Field>
            <Field label="Resumen">
              {(fid) => <Textarea id={fid} rows={4} value={form.summary ?? ""} onChange={(e) => set({ summary: e.target.value })} />}
            </Field>
            <Button type="submit" variant="primary">
              Guardar ficha
            </Button>
            <p className="text-xs text-faint">Con fecha de vencimiento te avisará 30, 7 y 1 día antes.</p>
          </form>
        )}
      </div>
    </Page>
  );
}
