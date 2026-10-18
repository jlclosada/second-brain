import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Bell, CalendarDays, CheckSquare, CornerDownLeft, FileText, Gem, Mail, NotebookPen, Search, Sparkles } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { api, itemPath, type Kind } from "../lib/api";
import { fmt } from "../lib/dates";
import { useGo } from "../lib/nav";
import { describeCapture } from "./Capture";
import { cx } from "./ui";

const KIND_ICON = { document: FileText, note: NotebookPen, task: CheckSquare, event: CalendarDays, reminder: Bell, email: Mail, vault: Gem };
const KIND_LABEL = { document: "Documento", note: "Nota", task: "Tarea", event: "Evento", reminder: "Recordatorio", email: "Correo", vault: "Memoria" };

const PAGES = [
  { to: "/", label: "Jarvis" },
  { to: "/bandeja", label: "Correo" },
  { to: "/calendario", label: "Agenda" },
  { to: "/tareas", label: "Tareas" },
  { to: "/documentos", label: "Documentos" },
  { to: "/documentos?subir=1", label: "Subir documentos" },
  { to: "/ajustes?seccion=conexiones", label: "Conectar Google o GitHub" },
  { to: "/ajustes", label: "Ajustes" },
];

/** Buscar e ir a una sección. Para apuntar algo nuevo está la captura (botón + o tecla C). */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const query = useDeferredValue(text.trim());
  const go = useGo();
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setText("");
      d.showModal();
      requestAnimationFrame(() => d.querySelector("input")?.focus());
    } else if (!open && d.open) d.close();
  }, [open]);

  const results = useQuery({
    queryKey: ["palette-search", query],
    queryFn: () => api.search(query, {}),
    enabled: open && query.length > 1,
    staleTime: 30_000,
  });

  const create = () => {
    const value = text.trim();
    onClose();
    toast.promise(api.capture(value), {
      loading: "Guardando…",
      success: (r) => {
        queryClient.invalidateQueries();
        return {
          message: `${KIND_LABEL[r.kind]}: ${r.title}`,
          description: describeCapture(r),
          action:
            r.created_id && r.kind !== "reminder" ? { label: "Abrir", onClick: () => go(itemPath(r.kind as Kind, r.created_id!), "nav-forward") } : undefined,
        };
      },
      error: (e) => (e as Error).message,
    });
  };

  const open_ = (to: string) => {
    onClose();
    go(to, to.includes("/") && to.split("/").length > 2 ? "nav-forward" : undefined);
  };

  const pages = PAGES.filter((p) => !query || p.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-label="Buscar"
      className="m-0 mt-[8vh] w-[calc(100%-1.5rem)] max-w-xl justify-self-center overflow-hidden rounded-2xl bg-surface p-0 text-ink shadow-lift backdrop:bg-ink/35 backdrop:backdrop-blur-[2px] sm:mx-auto"
    >
      {open && (
        <Command shouldFilter={false} loop label="Buscar">
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={18} className="shrink-0 text-muted" />
            <Command.Input
              autoFocus
              value={text}
              onValueChange={setText}
              autoComplete="off"
              placeholder="Busca en notas, documentos, tareas, correos… o ve a una sección"
              className="h-14 w-full bg-transparent text-[1.05rem] placeholder:text-faint focus:outline-none focus-visible:outline-none"
            />
          </div>
          <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
            {results.data && results.data.hits.length > 0 && (
              <Command.Group heading="En tu segundo cerebro" className="palette-group">
                {results.data.hits.slice(0, 8).map((h) => {
                  const Icon = KIND_ICON[h.item.kind];
                  return (
                    <Command.Item
                      key={h.item.id}
                      value={h.item.id}
                      onSelect={() => open_(itemPath(h.item.kind, h.item.id, h.item.title))}
                      className="palette-item"
                    >
                      <Icon size={18} className="shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{h.item.title}</div>
                        <div className="truncate text-sm text-muted">
                          {KIND_LABEL[h.item.kind]}
                          {h.item.category ? `, ${h.item.category}` : ""}
                          {h.item.year ? ` ${h.item.year}` : ""}
                        </div>
                      </div>
                    </Command.Item>
                  );
                })}
                <Command.Item value="__all" onSelect={() => open_(`/buscar?q=${encodeURIComponent(query)}`)} className="palette-item text-sm text-cobalt">
                  Ver todos los resultados de «{query}»
                </Command.Item>
              </Command.Group>
            )}

            {query.length > 2 && (
              <Command.Group heading="Apuntar como nuevo" className="palette-group">
                <Command.Item value="__capture" onSelect={create} className="palette-item">
                  <Sparkles size={18} className="shrink-0 text-cobalt" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">Apuntar «{text.trim()}»</div>
                    <div className="text-sm text-muted">Se guarda como tarea, evento, aviso o nota según lo que digas</div>
                  </div>
                  <CornerDownLeft size={15} className="text-faint" />
                </Command.Item>
              </Command.Group>
            )}

            {pages.length > 0 && (
              <Command.Group heading="Ir a" className="palette-group">
                {pages.map((p) => (
                  <Command.Item key={p.to} value={p.to} onSelect={() => open_(p.to)} className="palette-item">
                    <span className={cx("size-1.5 rounded-full bg-faint")} />
                    {p.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
          <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-faint">
            <span>↑↓ para moverte, ↵ para abrir. Para apuntar algo nuevo: tecla C.</span>
            <span className="hidden sm:inline">{fmt(new Date(), "EEEE d")}</span>
          </footer>
        </Command>
      )}
    </dialog>
  );
}
