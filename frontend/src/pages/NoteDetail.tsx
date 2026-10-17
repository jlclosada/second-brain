import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { LinkList, NoteBody } from "../components/NoteEditor";
import { Button, cx, Empty, IconButton, Input, Loading, Select } from "../components/ui";
import { api, type Note, type NoteDetail } from "../lib/api";
import { ago } from "../lib/dates";
import { GoLink, Page, Shared, useGo } from "../lib/nav";

export default function NotePage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const go = useGo();
  const note = useQuery({
    queryKey: ["note", id],
    queryFn: () => api.note(id),
    // Mientras carga, el título de la lista: así la transición lo puede mover a su sitio.
    placeholderData: () => {
      const n = queryClient.getQueryData<Note[]>(["notes"])?.find((x) => x.id === id);
      return n ? ({ ...n, links: [], backlinks: [] } as NoteDetail) : undefined;
    },
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (note.data && !note.isPlaceholderData) {
      setTitle(note.data.title === "Nota sin título" ? "" : note.data.title);
      setTags(note.data.tags.join(", "));
    }
  }, [note.data, note.isPlaceholderData]);

  const patch = async (body: Partial<Note>) => {
    try {
      const updated = await api.updateNote(id, body);
      queryClient.setQueryData(["note", id], updated);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["today"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm("¿Eliminar esta nota? No se puede deshacer.")) return;
    await api.deleteNote(id);
    queryClient.invalidateQueries({ queryKey: ["notes"] });
    toast("Nota eliminada");
    go("/notas", "nav-back");
  };

  if (note.isPending) return <Loading />;
  if (!note.data) return <Empty title="Esta nota no existe">Puede que la hayas borrado.</Empty>;
  const n = note.data;

  return (
    <Page>
      <div className="mb-4 flex items-center justify-between gap-2">
        <GoLink to={n.journal_date ? "/diario" : "/notas"} type="nav-back" className="inline-flex items-center gap-1.5 text-muted hover:text-ink">
          <ArrowLeft size={17} /> {n.journal_date ? "Diario" : "Notas"}
        </GoLink>
        <div className="flex items-center gap-1">
          <IconButton
            label={n.pinned ? "Quitar de fijadas" : "Fijar en Hoy"}
            onClick={() => patch({ pinned: !n.pinned })}
            className={cx(n.pinned && "text-ochre")}
          >
            <Pin size={18} />
          </IconButton>
          <IconButton label="Eliminar nota" onClick={remove} className="hover:text-clay">
            <Trash2 size={18} />
          </IconButton>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
        <article className="min-w-0">
          <Shared name={`note-${n.id}`}>
            <h1 className="text-[2rem] leading-tight font-semibold sm:text-[2.4rem]">
              <label htmlFor="note-title" className="sr-only">
                Título
              </label>
              <input
                id="note-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title !== n.title && patch({ title })}
                placeholder="Sin título"
                className="w-full bg-transparent placeholder:text-faint focus:outline-none"
              />
            </h1>
          </Shared>
          <p className="mt-1 mb-5 text-sm text-faint">Editada {ago(n.updated_at)}</p>
          {!note.isPlaceholderData && <NoteBody note={n} />}
        </article>

        <aside className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="note-tags" className="text-sm font-semibold text-muted">
              Etiquetas
            </label>
            <Input
              id="note-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={() =>
                patch({
                  tags: tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="viaje, ideas…"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="note-project" className="text-sm font-semibold text-muted">
              Proyecto o área
            </label>
            <Select id="note-project" value={n.project_id ?? ""} onChange={(e) => patch({ project_id: e.target.value || null })}>
              <option value="">Ninguno</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <LinkList title="Enlaza a" items={n.links} />
          <LinkList title="Mencionada en" items={n.backlinks} />
          {!n.links.length && !n.backlinks.length && <p className="text-sm text-faint">Escribe [[ y el título de otra nota para enlazarlas.</p>}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go("/asistente?q=" + encodeURIComponent(`Resume la nota «${n.title}»`), "nav-forward")}
            className="self-start"
          >
            Preguntar al asistente sobre esta nota
          </Button>
        </aside>
      </div>
    </Page>
  );
}
