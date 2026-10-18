import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  FileText,
  FolderKanban,
  Inbox,
  Layers,
  NotebookTabs,
  Paperclip,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { cx, Empty, Loading } from "../components/ui";
import { api, type VaultNoteRef } from "../lib/api";
import { ago, fmt } from "../lib/dates";
import { GoLink, Page } from "../lib/nav";
import DocumentsPage from "./Documents";

// La memoria de Jarvis: tu vault de Obsidian, tal cual, más lo que Jarvis ha archivado.

const FOLDER_META: Record<string, { label: string; icon: typeof Inbox; hint: string }> = {
  "00-Bandeja": { label: "Bandeja", icon: Inbox, hint: "Lo nuevo, sin procesar" },
  "01-Proyectos": { label: "Proyectos", icon: FolderKanban, hint: "Con objetivo y final" },
  "02-Areas": { label: "Áreas", icon: Layers, hint: "Responsabilidades continuas" },
  "03-Recursos": { label: "Recursos", icon: BookOpen, hint: "Referencias y documentos" },
  "04-Archivo": { label: "Archivo", icon: Archive, hint: "Lo inactivo" },
  "05-Diario": { label: "Diario", icon: NotebookTabs, hint: "Una nota por día" },
  "": { label: "Raíz", icon: Sparkles, hint: "Inicio y guías" },
};

const meta = (folder: string) => FOLDER_META[folder] ?? { label: folder.replace(/^\d+-/, ""), icon: FileText, hint: "" };

/** [[Nota|alias]] → enlace interno; ![[archivo]] → aviso de adjunto. */
function wikify(body: string) {
  return body
    .replace(/!\[\[([^\]]+)\]\]/g, (_, target: string) => `[📎 ${target.split("/").pop()}](adjunto:${encodeURIComponent(target)})`)
    .replace(
      /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
      (_, target: string, alias?: string) => `[${alias || target.split("/").pop()}](nota:${encodeURIComponent(target)})`,
    );
}

function NoteReader({ refParam, onOpen }: { refParam: { path?: string; id?: string }; onOpen: (path: string) => void }) {
  const note = useQuery({ queryKey: ["memory-note", refParam], queryFn: () => api.memoryNote(refParam), retry: false });
  if (note.isPending) return <Loading label="Abriendo nota" />;
  if (note.isError) return <Empty title="No encuentro esa nota">{(note.error as Error).message}</Empty>;
  const n = note.data;
  const fm = Object.entries(n.frontmatter).filter(([k]) => !["tags"].includes(k));
  const tags = Array.isArray(n.frontmatter.tags) ? (n.frontmatter.tags as string[]) : [];

  return (
    <motion.article
      key={n.path}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 160, damping: 22 }}
      className="min-w-0"
    >
      <p className="eyebrow">{n.folder || "vault"}</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-display text-[2rem] leading-tight font-semibold sm:text-[2.4rem]">{n.title}</h1>
        <a href={n.obsidian_url} className="glass inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm text-muted hover:text-ink">
          <ExternalLink size={14} /> Abrir en Obsidian
        </a>
      </div>
      {(fm.length > 0 || tags.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-cobalt-soft px-2.5 py-0.5 text-xs text-cobalt">
              #{t}
            </span>
          ))}
          {fm.map(([k, v]) => (
            <span key={k} className="mono rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}
      <div className="prose-brain mt-6 max-w-[72ch] text-[1.03rem]">
        <Markdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => url}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("nota:"))
                return (
                  <button
                    type="button"
                    onClick={() => onOpen(decodeURIComponent(href.slice(5)))}
                    className="text-cobalt underline decoration-cobalt/40 underline-offset-4 hover:decoration-cobalt"
                  >
                    {children}
                  </button>
                );
              if (href?.startsWith("adjunto:"))
                return (
                  <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-sm text-muted">
                    <Paperclip size={12} /> {children}
                  </span>
                );
              return (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              );
            },
          }}
        >
          {wikify(n.body.replace(new RegExp(`^\\s*#\\s+${n.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n`), ""))}
        </Markdown>
      </div>
      {n.backlinks.length > 0 && (
        <section className="mt-10 border-t border-line pt-5">
          <h2 className="eyebrow mb-2">La mencionan</h2>
          <div className="flex flex-wrap gap-1.5">
            {n.backlinks.map((b) => (
              <button key={b.path} type="button" onClick={() => onOpen(b.path)} className="glass rounded-full px-3 py-1 text-sm text-muted hover:text-ink">
                {b.title}
              </button>
            ))}
          </div>
        </section>
      )}
      <p className="mono mt-8 text-xs text-faint">
        {n.path} · editada {ago(n.updated_at)}
      </p>
    </motion.article>
  );
}

function VaultView() {
  const [params, setParams] = useSearchParams();
  const tree = useQuery({ queryKey: ["memory-tree"], queryFn: api.memoryTree, refetchInterval: 60_000 });
  const status = useQuery({ queryKey: ["memory-status"], queryFn: api.memoryStatus });
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({ "04-Archivo": true });
  const path = params.get("nota") ?? undefined;
  const id = params.get("id") ?? undefined;
  const open = (p: string) => setParams({ vista: "vault", nota: p });

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (tree.data ?? [])
      .map((g) => ({ ...g, notes: q ? g.notes.filter((n) => `${n.title} ${n.path} ${n.tags.join(" ")}`.toLowerCase().includes(q)) : g.notes }))
      .filter((g) => g.notes.length);
  }, [tree.data, filter]);

  if (tree.isPending) return <Loading />;
  if (status.data && !status.data.vault.configured)
    return <Empty title="No hay vault conectado">Define VAULT_PATH en .env con la ruta de tu vault de Obsidian y reinicia la app.</Empty>;

  const daily = tree.data?.find((g) => g.folder === "05-Diario")?.notes.at(-1);

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={cx("scrollbar-thin lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:pr-1", (path || id) && "hidden")}>
        <div className="glass mb-3 flex items-center gap-2 rounded-full px-3.5">
          <Search size={15} className="text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar notas…"
            aria-label="Filtrar notas"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm placeholder:text-faint focus:outline-none focus-visible:outline-none"
          />
        </div>
        <nav aria-label="Carpetas del vault" className="flex flex-col gap-1">
          {groups.map((g, gi) => {
            const m = meta(g.folder);
            const Icon = m.icon;
            const isClosed = closed[g.folder] && !filter;
            return (
              <motion.div key={g.folder} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: gi * 0.04 }}>
                <button
                  type="button"
                  onClick={() => setClosed({ ...closed, [g.folder]: !isClosed })}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-white/[0.04]"
                  aria-expanded={!isClosed}
                >
                  <Icon size={16} className="text-cobalt" />
                  <span className="flex-1 text-sm font-semibold">{m.label}</span>
                  <span className="mono text-xs text-faint">{g.notes.length}</span>
                  <ChevronDown size={14} className={cx("text-faint transition-transform", isClosed && "-rotate-90")} />
                </button>
                <AnimatePresence initial={false}>
                  {!isClosed && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      {g.notes.map((n: VaultNoteRef) => (
                        <li key={n.path}>
                          <button
                            type="button"
                            onClick={() => open(n.path)}
                            className={cx(
                              "block w-full truncate rounded-lg py-1.5 pr-2 pl-9 text-left text-sm transition-colors",
                              path === n.path ? "bg-cobalt-soft text-ink" : "text-muted hover:text-ink",
                            )}
                            title={n.path}
                          >
                            {n.folder.split("/").length > 1 && <span className="text-faint">{n.folder.split("/").slice(1).join("/")} / </span>}
                            {n.title}
                          </button>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0">
        {path || id ? (
          <>
            <button
              type="button"
              onClick={() => setParams({ vista: "vault" })}
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink lg:hidden"
            >
              <ChevronLeft size={15} /> Carpetas
            </button>
            <NoteReader refParam={id ? { id } : { path }} onOpen={open} />
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <h1 className="text-glow font-display text-[2.2rem] font-semibold">Tu memoria</h1>
            <p className="max-w-xl text-muted">
              Todo tu vault «{status.data?.vault.name}» está aquí, indexado para que Jarvis lo encuentre por palabras o por significado. Lo que escribas en
              Obsidian aparece en un minuto; lo que Jarvis apunta va a tu Bandeja y a tu diario.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["00-Bandeja", "01-Proyectos", "02-Areas", "03-Recursos", "05-Diario"] as const).map((f, i) => {
                const g = tree.data?.find((x) => x.folder === f);
                const m = meta(f);
                const Icon = m.icon;
                return (
                  <motion.button
                    key={f}
                    type="button"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => g?.notes[0] && open(f === "05-Diario" && daily ? daily.path : g.notes[0].path)}
                    className="glass glass-hover rounded-3xl p-5 text-left"
                  >
                    <Icon size={20} className="text-cobalt" />
                    <p className="mt-3 font-display text-xl font-semibold">{m.label}</p>
                    <p className="text-sm text-muted">{m.hint}</p>
                    <p className="mono mt-3 text-2xl">{g?.notes.length ?? 0}</p>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityView() {
  const activity = useQuery({ queryKey: ["activity", 100], queryFn: () => api.activity(100), refetchInterval: 15_000 });
  const status = useQuery({ queryKey: ["memory-status"], queryFn: api.memoryStatus, refetchInterval: 15_000 });
  const s = status.data;
  return (
    <div className="max-w-3xl">
      {s && (
        <div className="glass mb-6 flex flex-wrap items-center gap-4 rounded-3xl p-5">
          <span className={cx("size-2.5 rounded-full", s.downloads.enabled ? "pulse-dot bg-moss text-moss" : "bg-faint")} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{s.downloads.enabled ? "Jarvis vigila tu carpeta de Descargas" : "Descargas no está conectada"}</p>
            <p className="text-sm text-muted">
              Cada documento nuevo se lee, se clasifica, se renombra y se archiva en tu vault (Adjuntos/categoría) con su nota en Recursos/Documentos.
              {s.downloads.processing > 0 && ` Leyendo ${s.downloads.processing} ahora.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => api.memorySync().then(() => toast("Revisando Descargas y el vault…"))}
            className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm text-muted hover:text-ink"
          >
            <RefreshCw size={14} /> Revisar ahora
          </button>
        </div>
      )}
      {activity.data?.length ? (
        <ol className="relative border-l border-line pl-6">
          {activity.data.map((a, i) => (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.03 }}
              className="relative pb-5"
            >
              <span className="absolute top-1.5 -left-[1.82rem] size-2.5 rounded-full bg-cobalt shadow-[0_0_10px_rgba(122,167,255,0.8)]" />
              {a.url ? (
                <GoLink to={a.url} className="font-medium hover:text-cobalt">
                  {a.title}
                </GoLink>
              ) : (
                <p className="font-medium">{a.title}</p>
              )}
              {a.body && <p className="mono text-sm break-all text-muted">{a.body}</p>}
              <p className="mono text-xs text-faint">{fmt(a.at, "d MMM, HH:mm")}</p>
            </motion.li>
          ))}
        </ol>
      ) : (
        <Empty title="Todavía no he archivado nada">Cuando descargues un documento, lo verás aparecer aquí en un minuto.</Empty>
      )}
    </div>
  );
}

const VIEWS = [
  { value: "vault", label: "Vault" },
  { value: "documentos", label: "Documentos" },
  { value: "actividad", label: "Lo que he hecho" },
] as const;

export default function MemoryPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("vista") ?? (params.get("nota") || params.get("id") ? "vault" : "vault");

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-center gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setParams({ vista: v.value })}
            className={cx("relative rounded-full px-4 py-1.5 text-sm transition-colors", view === v.value ? "text-ink" : "text-muted hover:text-ink")}
          >
            {view === v.value && <motion.span layoutId="memory-tab" className="absolute inset-0 rounded-full bg-white/[0.07] ring-1 ring-line" />}
            <span className="relative">{v.label}</span>
          </button>
        ))}
      </div>
      {view === "vault" && <VaultView />}
      {view === "documentos" && <DocumentsPage embedded />}
      {view === "actividad" && <ActivityView />}
    </Page>
  );
}
