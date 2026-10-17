import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, FileText, NotebookPen } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";

import { api, itemPath, type LinkRef, type NoteDetail } from "../lib/api";
import { GoLink } from "../lib/nav";
import { cx, Segmented } from "./ui";

const KIND_ICON = { document: FileText, note: NotebookPen, task: CheckSquare, event: CalendarDays };

/** Convierte [[Título]] en enlaces a la nota con ese título. */
function withWikiLinks(body: string, links: LinkRef[]) {
  const byTitle = new Map(links.map((l) => [l.title.toLowerCase(), l]));
  return body.replace(/\[\[([^[\]\n]{1,200})\]\]/g, (_, title: string) => {
    const target = byTitle.get(title.trim().toLowerCase());
    return target ? `[${title}](${itemPath(target.kind, target.id)})` : `*${title}*`;
  });
}

export function Markdown({ body, links = [] }: { body: string; links?: LinkRef[] }) {
  return (
    <div className="prose-brain">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = "", children }) =>
            href.startsWith("/") ? (
              <Link to={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
        }}
      >
        {withWikiLinks(body, links)}
      </ReactMarkdown>
    </div>
  );
}

export function LinkList({ title, items }: { title: string; items: LinkRef[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-1.5 text-sm font-semibold text-muted">{title}</h2>
      <ul className="flex flex-col">
        {items.map((l) => {
          const Icon = KIND_ICON[l.kind];
          return (
            <li key={l.id}>
              <GoLink to={itemPath(l.kind, l.id)} className="flex items-center gap-2 rounded-md py-1 text-[0.95rem] hover:text-cobalt">
                <Icon size={15} className="shrink-0 text-faint" />
                <span className="truncate">{l.title}</span>
              </GoLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Editor de una nota: markdown con autoguardado y autocompletado de [[enlaces]].
 * `onSave` recibe solo lo que ha cambiado.
 */
export function NoteBody({ note, placeholder }: { note: NoteDetail; placeholder?: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState(note.body);
  const [mode, setMode] = useState<"edit" | "read">(note.body ? "read" : "edit");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [link, setLink] = useState<{ query: string; start: number } | null>(null);
  const [selected, setSelected] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(note.body);

  useEffect(() => {
    if (note.body !== latest.current) {
      setBody(note.body);
      latest.current = note.body;
    }
  }, [note.body]);

  const suggestions = useQuery({
    queryKey: ["titles", link?.query],
    queryFn: () => api.titles(link!.query),
    enabled: !!link,
  });

  const save = (value: string) => {
    setBody(value);
    latest.current = value;
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const updated = await api.updateNote(note.id, { body: value });
        queryClient.setQueryData(["note", note.id], updated);
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        setState("saved");
      } catch {
        setState("error");
      }
    }, 800);
  };

  const onChange = (value: string, caret: number) => {
    save(value);
    const before = value.slice(0, caret);
    const open = before.lastIndexOf("[[");
    if (open !== -1 && !before.slice(open).includes("]]") && !before.slice(open).includes("\n")) {
      setLink({ query: before.slice(open + 2), start: open });
      setSelected(0);
    } else setLink(null);
  };

  const pick = (title: string) => {
    if (!link || !area.current) return;
    const caret = area.current.selectionStart;
    const value = `${body.slice(0, link.start)}[[${title}]]${body.slice(caret)}`;
    save(value);
    setLink(null);
    requestAnimationFrame(() => {
      const pos = link.start + title.length + 4;
      area.current?.setSelectionRange(pos, pos);
      area.current?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const items = suggestions.data ?? [];
    if (!link || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(items[selected].title);
    } else if (e.key === "Escape") setLink(null);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Segmented
          label="Modo"
          value={mode}
          onChange={setMode}
          options={[
            { value: "edit", label: "Escribir" },
            { value: "read", label: "Leer" },
          ]}
        />
        <span className="text-xs text-faint" aria-live="polite">
          {state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : state === "error" ? "No se pudo guardar" : "Markdown y [[enlaces]]"}
        </span>
      </div>
      {mode === "edit" ? (
        <div className="relative">
          <label htmlFor={`body-${note.id}`} className="sr-only">
            Contenido
          </label>
          <textarea
            id={`body-${note.id}`}
            ref={area}
            value={body}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? "Escribe… Usa # para títulos, - para listas y [[Título]] para enlazar otra nota."}
            className="min-h-[50vh] w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[1.02rem] leading-relaxed placeholder:text-faint focus:border-cobalt focus:outline-none"
          />
          {link && !!suggestions.data?.length && (
            <ul
              role="listbox"
              aria-label="Enlazar con"
              className="absolute top-3 right-3 z-10 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-lift"
            >
              {suggestions.data.map((s, i) => {
                const Icon = KIND_ICON[s.kind];
                return (
                  <li key={s.id} role="option" aria-selected={i === selected}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(s.title);
                      }}
                      className={cx("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", i === selected && "bg-sunken")}
                    >
                      <Icon size={14} className="shrink-0 text-faint" />
                      <span className="truncate">{s.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : body.trim() ? (
        <div onDoubleClick={() => setMode("edit")}>
          <Markdown body={body} links={note.links} />
        </div>
      ) : (
        <button type="button" onClick={() => setMode("edit")} className="text-faint hover:text-ink">
          Vacía. Pulsa para escribir.
        </button>
      )}
    </div>
  );
}
