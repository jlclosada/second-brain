import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, Pencil } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { QuickAddTask, TaskRow, TaskSheet } from "../components/TaskParts";
import { Button, colorVar, Empty, Loading, Section } from "../components/ui";
import { api, type Task } from "../lib/api";
import { ago } from "../lib/dates";
import { GoLink, Page, Shared, useGo } from "../lib/nav";
import { ProjectSheet } from "./Projects";

export default function ProjectPage() {
  const { id = "" } = useParams();
  const go = useGo();
  const queryClient = useQueryClient();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.project(id) });
  const tasks = useQuery({ queryKey: ["tasks", "project", id], queryFn: () => api.tasks({ view: "open", project_id: id }) });
  const notes = useQuery({ queryKey: ["notes", "project", id], queryFn: () => api.notes({ project_id: id }) });
  const docs = useQuery({ queryKey: ["documents", "project", id], queryFn: () => api.documents({ project_id: id }) });
  const [task, setTask] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);

  const archive = async () => {
    await api.updateProject(id, { archived: true });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast("Archivado. Sus tareas, notas y documentos siguen ahí.");
    go("/proyectos", "nav-back");
  };

  const newNote = async () => {
    const n = await api.createNote({ title: "", body: "", project_id: id });
    go(`/notas/${n.id}`, "nav-forward");
  };

  if (project.isPending) return <Loading />;
  if (!project.data) return <Empty title="Este proyecto no existe" />;
  const p = project.data;

  return (
    <Page>
      <GoLink to="/proyectos" type="nav-back" className="mb-4 inline-flex items-center gap-1.5 text-muted hover:text-ink">
        <ArrowLeft size={17} /> Proyectos y áreas
      </GoLink>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-2 h-10 w-1.5 shrink-0 rounded-full" style={{ background: colorVar(p.color) }} />
          <div>
            <Shared name={`project-${p.id}`}>
              <h1 className="text-[2.2rem] leading-tight font-semibold">{p.name}</h1>
            </Shared>
            <p className="text-muted">{p.description || (p.kind === "area" ? "Área" : "Proyecto")}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Editar
          </Button>
          <Button variant="ghost" onClick={archive}>
            <Archive size={16} /> Archivar
          </Button>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <Section title="Tareas">
          <QuickAddTask defaults={{ project_id: id }} placeholder="Añadir tarea…" />
          <ul className="divide-y divide-line">
            {tasks.data?.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={setTask} />
            ))}
          </ul>
          {tasks.data && !tasks.data.length && <p className="mt-3 text-muted">Sin tareas pendientes.</p>}
        </Section>

        <div>
          <Section
            title="Notas"
            action={
              <Button size="sm" variant="ghost" onClick={newNote}>
                Nueva nota
              </Button>
            }
          >
            {notes.data?.length ? (
              <ul>
                {notes.data.map((n) => (
                  <li key={n.id} className="border-t border-line">
                    <GoLink to={`/notas/${n.id}`} className="block py-2.5 hover:text-cobalt">
                      <p className="font-medium">{n.title}</p>
                      <p className="text-xs text-faint">Editada {ago(n.updated_at)}</p>
                    </GoLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Sin notas.</p>
            )}
          </Section>
          <Section title="Documentos">
            {docs.data?.items.length ? (
              <ul>
                {docs.data.items.map((d) => (
                  <li key={d.id} className="border-t border-line">
                    <GoLink to={`/documentos/${d.id}`} className="block py-2.5 hover:text-cobalt">
                      {d.title}
                    </GoLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Asigna documentos a este proyecto desde su ficha.</p>
            )}
          </Section>
        </div>
      </div>
      <TaskSheet task={task} onClose={() => setTask(null)} />
      {editing && <ProjectSheet open project={p} onClose={() => setEditing(false)} />}
    </Page>
  );
}
