import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, Loader2, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button, cx, Empty, Loading, PageHeader } from "../components/ui";
import { api, type Item } from "../lib/api";
import { fmt, relativeDay } from "../lib/dates";
import { GoLink, Page, Shared } from "../lib/nav";

function UploadZone({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const r = await api.upload(files);
      if (r.created.length)
        toast(`${r.created.length === 1 ? "Documento subido" : `${r.created.length} documentos subidos`}. Se están leyendo y clasificando.`);
      if (r.duplicates.length) toast(`Ya tenías ${r.duplicates.join(", ")}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    send([...e.dataTransfer.files]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cx(
        "mb-8 flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed px-5 py-5 transition-colors",
        over ? "border-cobalt bg-cobalt-soft" : "border-line",
      )}
    >
      <div className="flex-1">
        <p className="font-medium">{busy ? "Subiendo…" : "Arrastra aquí PDFs, fotos, Word o texto"}</p>
        <p className="text-sm text-muted">Se leen (también escaneados), se clasifican y quedan listos para buscar.</p>
      </div>
      <input ref={input} type="file" multiple hidden onChange={(e) => send([...(e.target.files ?? [])])} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => send([...(e.target.files ?? [])])} />
      <Button onClick={() => camera.current?.click()} className="sm:hidden" disabled={busy}>
        <Camera size={17} /> Foto
      </Button>
      <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />} Elegir archivos
      </Button>
    </div>
  );
}

function DocRow({ item }: { item: Item }) {
  const working = item.status === "pending" || item.status === "processing";
  return (
    <li className="border-t border-line">
      <GoLink to={`/documentos/${item.id}`} className="group flex items-start gap-4 py-3.5">
        <span
          className={cx(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
            item.status === "error" ? "bg-clay-soft text-clay" : "bg-sunken text-muted",
          )}
        >
          {working ? <Loader2 size={17} className="animate-spin" /> : item.status === "error" ? <TriangleAlert size={17} /> : <FileText size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <Shared name={`doc-${item.id}`}>
            <p className="truncate font-medium group-hover:text-cobalt">{item.title}</p>
          </Shared>
          <p className="truncate text-sm text-muted">
            {working
              ? "Leyendo y clasificando…"
              : item.status === "error"
                ? "No se pudo procesar"
                : [item.doc_type && item.doc_type.charAt(0).toUpperCase() + item.doc_type.slice(1), item.category, item.year].filter(Boolean).join(", ")}
          </p>
        </div>
        <div className="hidden shrink-0 text-right text-sm sm:block">
          {item.expires_on && <p className={cx(new Date(item.expires_on) < new Date() ? "text-clay" : "text-ochre")}>Vence {relativeDay(item.expires_on)}</p>}
          <p className="text-faint">{fmt(item.created_at, "d MMM yyyy")}</p>
        </div>
      </GoLink>
    </li>
  );
}

export default function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const category = params.get("categoria") ?? undefined;
  const year = params.get("año") ? Number(params.get("año")) : undefined;
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const docs = useQuery({
    queryKey: ["documents", category, year],
    queryFn: () => api.documents({ category, year }),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "pending" || i.status === "processing") ? 3000 : false),
  });

  const toggle = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);
    next.delete("subir");
    setParams(next, { replace: true });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };

  return (
    <Page>
      <PageHeader
        title="Documentos"
        sub={stats.data ? `${stats.data.total} guardados${stats.data.pending ? `, ${stats.data.pending} procesándose` : ""}.` : undefined}
      />
      <UploadZone onDone={refresh} />

      {!!stats.data?.categories.length && (
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {stats.data.categories.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={category === c.value}
                onClick={() => toggle("categoria", c.value)}
                className={cx(
                  "h-8 rounded-full border px-3 text-sm",
                  category === c.value ? "border-ink bg-ink text-paper" : "border-line text-muted hover:text-ink",
                )}
              >
                {c.value} <span className="opacity-60 tabular">{c.count}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stats.data.years.map((y) => (
              <button
                key={y.value}
                type="button"
                aria-pressed={String(year) === y.value}
                onClick={() => toggle("año", y.value)}
                className={cx("h-7 rounded-full px-2.5 text-sm tabular", String(year) === y.value ? "bg-ochre text-ink" : "text-muted hover:bg-sunken")}
              >
                {y.value}
              </button>
            ))}
          </div>
        </div>
      )}

      {docs.isPending ? (
        <Loading />
      ) : !docs.data?.items.length ? (
        <Empty icon={<FileText size={20} />} title={category || year ? "Nada con esos filtros" : "Aún no hay documentos"}>
          {!category && !year && "Sube pólizas, facturas, nóminas o contratos: los leerá y ordenará por ti."}
        </Empty>
      ) : (
        <ul>
          {docs.data.items.map((item) => (
            <DocRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Page>
  );
}
