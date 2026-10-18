import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Camera, ChevronRight, FileImage, FileSpreadsheet, FileText, Loader2, Search, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { cx, Empty, Loading } from "../components/ui";
import { api, type Item } from "../lib/api";
import { fmt, relativeDay } from "../lib/dates";
import { GoLink, Page, useGo } from "../lib/nav";

// Tus papeles: escribe lo que buscas como lo dirías («nómina de junio 2023», «seguro del coche»,
// «DNI») y aparece al instante. Sin buscar, todo está ordenado por categoría y año.

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function DocIcon({ item, className }: { item: Item; className?: string }) {
  const mime = item.document?.mime ?? "";
  const Icon = mime.startsWith("image/") ? FileImage : /sheet|csv|excel/.test(mime) ? FileSpreadsheet : FileText;
  return (
    <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-cobalt", className)}>
      <Icon size={19} />
    </span>
  );
}

function meta(item: Item) {
  const kind = item.doc_type ? item.doc_type.charAt(0).toUpperCase() + item.doc_type.slice(1) : null;
  const when = item.doc_date ? fmt(item.doc_date, "d MMM yyyy") : item.year ? String(item.year) : null;
  return [kind, item.category, when].filter(Boolean).join(" · ");
}

/** Abrir el archivo directamente (PDF, foto…) en otra pestaña. */
function OpenFile({ item }: { item: Item }) {
  return (
    <a
      href={api.fileUrl(item.id)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cobalt px-3.5 py-1.5 text-sm font-medium text-paper"
    >
      Abrir <ArrowUpRight size={14} />
    </a>
  );
}

function ResultCard({ item, snippet, i }: { item: Item; snippet: string; i: number }) {
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
      <div className="glass glass-hover flex items-start gap-4 rounded-2xl p-4">
        <DocIcon item={item} />
        <GoLink to={`/documentos/${item.id}`} className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{item.title}</p>
          <p className="mt-0.5 text-sm text-muted">{meta(item)}</p>
          {snippet && <p className="mt-1.5 line-clamp-2 text-sm text-faint" dangerouslySetInnerHTML={{ __html: snippet }} />}
        </GoLink>
        <OpenFile item={item} />
      </div>
    </motion.li>
  );
}

function UploadButton({ onDone }: { onDone: () => void }) {
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
      <button
        type="button"
        onClick={() => camera.current?.click()}
        className="glass flex size-11 items-center justify-center rounded-full text-muted sm:hidden"
        aria-label="Hacer una foto de un documento"
      >
        <Camera size={18} />
      </button>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="glass flex h-11 items-center gap-2 rounded-full px-4 text-sm text-muted hover:text-ink"
        aria-label="Subir documentos"
      >
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
        <span className="hidden sm:inline">Subir</span>
      </button>
    </>
  );
}

export default function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const go = useGo();
  const [text, setText] = useState(params.get("q") ?? "");
  const q = useDebounced(text.trim(), 140);
  const [category, setCategory] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const archive = useQuery({ queryKey: ["archive"], queryFn: api.archive });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: (s) => (s.state.data?.pending ? 3000 : false) });
  const results = useQuery({
    queryKey: ["doc-search", q],
    queryFn: () => api.search(q, { kind: "document" }),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  useEffect(() => {
    // Se guarda la búsqueda en la dirección para poder volver atrás a ella.
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    next.delete("subir");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) input.current?.focus();
    if (params.get("subir")) toast("Pulsa «Subir» o arrastra los archivos a esta pantalla");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["archive"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
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
    const first = results.data?.hits[0];
    if (e.key === "Enter" && first) window.open(api.fileUrl(first.item.id), "_blank");
    if (e.key === "Escape") setText("");
  };

  const searching = q.length > 0;
  const d = results.data;
  const understood = d && (d.text || d.months.length || d.years.length) && (d.months.length || d.years.length);
  const total = stats.data?.total ?? 0;
  const shown = archive.data?.filter((c) => !category || c.category === category) ?? [];

  return (
    <Page>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cx("min-h-[70vh] rounded-3xl transition-colors", over && "bg-cobalt-soft outline-2 outline-dashed outline-cobalt")}
      >
        <header className="mb-5">
          <p className="eyebrow">
            {total} documentos{stats.data?.pending ? ` · leyendo ${stats.data.pending}` : ""}
          </p>
          <h1 className="text-glow mt-1 font-display text-[2.2rem] leading-tight font-semibold sm:text-[2.8rem]">Documentos</h1>
        </header>

        <div className="sticky top-14 z-10 flex items-center gap-2 lg:top-4">
          <label className="glass flex h-14 flex-1 items-center gap-3 rounded-full px-5 focus-within:border-line-strong">
            <Search size={20} className="shrink-0 text-cobalt" />
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder="Busca: «nómina de junio 2023», «seguro del coche»…"
              aria-label="Buscar documentos"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent text-[1.05rem] placeholder:text-faint focus:outline-none focus-visible:outline-none"
            />
            {results.isFetching && <Loader2 size={17} className="animate-spin text-faint" />}
            {text && (
              <button type="button" onClick={() => setText("")} aria-label="Borrar búsqueda" className="text-faint hover:text-ink">
                <X size={18} />
              </button>
            )}
          </label>
          <UploadButton onDone={refresh} />
        </div>

        {searching ? (
          <section className="mt-5" aria-live="polite">
            {understood ? (
              <p className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                Buscando
                {d.text && <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-ink">«{d.text}»</span>}
                {d.months.map((m) => (
                  <span key={m} className="rounded-full bg-cobalt-soft px-2.5 py-0.5 text-cobalt">
                    {MONTHS[m - 1]}
                  </span>
                ))}
                {d.years.map((y) => (
                  <span key={y} className="mono rounded-full bg-ochre-soft px-2.5 py-0.5 text-ochre">
                    {y}
                  </span>
                ))}
              </p>
            ) : null}
            {d && d.hits.length === 0 ? (
              <Empty icon={<Search size={20} />} title={`Nada para «${q}»`}>
                Prueba con otras palabras, o pregúntale a Jarvis: también busca dentro de los documentos.{" "}
                <button type="button" className="text-cobalt underline" onClick={() => go(`/?q=${encodeURIComponent(`Busca en mis documentos: ${q}`)}`)}>
                  Preguntar a Jarvis
                </button>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-2.5">
                <AnimatePresence initial={false}>
                  {d?.hits.map((h, i) => (
                    <ResultCard key={h.item.id} item={h.item} snippet={h.snippet} i={i} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
            {d && d.hits.length > 0 && <p className="mt-3 text-xs text-faint">Intro abre el primero.</p>}
          </section>
        ) : archive.isPending ? (
          <Loading />
        ) : !archive.data?.length ? (
          <div className="mt-8">
            <Empty icon={<FileText size={20} />} title="Aún no hay documentos">
              Lo que descargues se ordena solo aquí. También puedes subirlos o arrastrarlos a esta pantalla.
            </Empty>
          </div>
        ) : (
          <>
            <div className="scrollbar-none -mx-4 mt-5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
              {[{ category: null as string | null, count: total }, ...archive.data.map((c) => ({ category: c.category as string | null, count: c.count }))].map(
                (c) => (
                  <button
                    key={c.category ?? "todas"}
                    type="button"
                    onClick={() => setCategory(c.category)}
                    aria-pressed={category === c.category}
                    className={cx(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors",
                      category === c.category ? "bg-white/[0.09] text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink",
                    )}
                  >
                    {c.category ?? "Todas"} <span className="mono text-xs opacity-60">{c.count}</span>
                  </button>
                ),
              )}
            </div>

            <div className="mt-6 flex flex-col gap-8">
              {shown.map((c, ci) => (
                <motion.section key={c.category} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: ci * 0.05 }}>
                  <h2 className="mb-2 flex items-baseline gap-2 font-display text-xl font-semibold">
                    {c.category} <span className="mono text-xs font-normal text-faint">{c.count}</span>
                  </h2>
                  <div className="glass overflow-hidden rounded-3xl">
                    {c.years.map((y) => (
                      <div key={y.year ?? "sin"} className="border-t border-line first:border-t-0">
                        <p className="eyebrow px-5 pt-3">{y.year ?? "Sin fecha"}</p>
                        <ul>
                          {y.items.map((item) => (
                            <li key={item.id}>
                              <GoLink to={`/documentos/${item.id}`} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.03]">
                                <DocIcon item={item} className="size-8 rounded-lg" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate group-hover:text-cobalt">{item.title}</p>
                                  <p className="truncate text-xs text-faint">
                                    {meta(item)}
                                    {item.expires_on && <span className="text-ochre"> · vence {relativeDay(item.expires_on)}</span>}
                                  </p>
                                </div>
                                <ChevronRight size={15} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                              </GoLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </motion.section>
              ))}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
