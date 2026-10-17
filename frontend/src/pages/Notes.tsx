import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Pin, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button, cx, Empty, Input, Loading, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { ago } from "../lib/dates";
import { GoLink, Page, Shared, useGo } from "../lib/nav";

export default function NotesPage() {
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => api.notes() });
  const [filter, setFilter] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const go = useGo();

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    notes.data?.forEach((n) => n.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [notes.data]);

  const visible = (notes.data ?? []).filter(
    (n) => (!tag || n.tags.includes(tag)) && (!filter || `${n.title} ${n.body}`.toLowerCase().includes(filter.toLowerCase())),
  );

  const create = async () => {
    try {
      const n = await api.createNote({ title: "", body: "" });
      go(`/notas/${n.id}`, "nav-forward");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader title="Notas" sub="Ideas, apuntes y todo lo que quieras recordar.">
        <GoLink to="/diario" className="inline-flex h-10 items-center rounded-lg px-3.5 text-muted hover:bg-sunken hover:text-ink">
          Diario
        </GoLink>
        <Button variant="primary" onClick={create}>
          <Plus size={17} /> Nueva nota
        </Button>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label htmlFor="filtro-notas" className="sr-only">
          Filtrar notas
        </label>
        <Input
          id="filtro-notas"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por texto…"
          autoComplete="off"
          className="max-w-xs"
        />
        {tags.map(([t]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTag(tag === t ? null : t)}
            aria-pressed={tag === t}
            className={cx("h-8 rounded-full border px-3 text-sm", tag === t ? "border-ink bg-ink text-paper" : "border-line text-muted hover:text-ink")}
          >
            #{t}
          </button>
        ))}
      </div>

      {notes.isPending ? (
        <Loading />
      ) : !visible.length ? (
        <Empty icon={<NotebookPen size={20} />} title={notes.data?.length ? "Ninguna nota coincide" : "Todavía no tienes notas"}>
          {!notes.data?.length && "Crea una, o escribe «nota: …» en la captura rápida (botón + o ⌘K)."}
        </Empty>
      ) : (
        <ul className="grid gap-x-8 md:grid-cols-2">
          {visible.map((n) => (
            <li key={n.id} className="border-t border-line">
              <GoLink to={`/notas/${n.id}`} className="group block py-4">
                <Shared name={`note-${n.id}`}>
                  <h2 className="flex items-center gap-1.5 text-lg font-semibold group-hover:text-cobalt">
                    {n.pinned && <Pin size={14} className="shrink-0 text-ochre" aria-label="Fijada" />}
                    <span className="truncate">{n.title}</span>
                  </h2>
                </Shared>
                {n.excerpt && <p className="mt-0.5 line-clamp-2 text-muted">{n.excerpt}</p>}
                <p className="mt-1.5 text-xs text-faint">
                  Editada {ago(n.updated_at)}
                  {n.tags.length > 0 && <span className="ml-2">#{n.tags.join(" #")}</span>}
                </p>
              </GoLink>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
