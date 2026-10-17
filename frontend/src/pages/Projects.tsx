import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button, colorVar, cx, Empty, Field, Input, Loading, PageHeader, Segmented, Sheet, Textarea } from "../components/ui";
import { api, COLORS, type Color, type Project } from "../lib/api";
import { GoLink, Page, Shared } from "../lib/nav";

export function ColorPicker({ value, onChange }: { value: Color; onChange: (c: Color) => void }) {
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx("size-8 rounded-full ring-offset-2 ring-offset-surface", value === c && "ring-2 ring-ink")}
          style={{ background: colorVar(c) }}
        />
      ))}
    </div>
  );
}

export function ProjectSheet({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: project?.name ?? "",
    kind: project?.kind ?? "project",
    color: project?.color ?? ("cobalt" as Color),
    description: project?.description ?? "",
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (project) await api.updateProject(project.id, form);
      else await api.createProject(form);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      onClose();
      toast(project ? "Guardado" : `${form.kind === "area" ? "Área" : "Proyecto"} creado`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={project ? "Editar" : "Nuevo proyecto o área"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Segmented
          label="Tipo"
          value={form.kind}
          onChange={(kind) => setForm({ ...form, kind })}
          options={[
            { value: "project", label: "Proyecto" },
            { value: "area", label: "Área" },
          ]}
        />
        <p className="-mt-2 text-sm text-faint">
          {form.kind === "project" ? "Algo con un final: «Reforma de la cocina», «Mudanza»." : "Algo que cuidas siempre: «Salud», «Casa», «Finanzas»."}
        </p>
        <Field label="Nombre">
          {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />}
        </Field>
        <Field label="Color">{() => <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />}</Field>
        <Field label="Descripción">
          {(id) => <Textarea id={id} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
        <Button type="submit" variant="primary" className="self-end">
          {project ? "Guardar" : "Crear"}
        </Button>
      </form>
    </Sheet>
  );
}

function Group({ title, items }: { title: string; items: Project[] }) {
  if (!items.length) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <ul className="grid gap-x-8 md:grid-cols-2">
        {items.map((p) => (
          <li key={p.id} className="border-t border-line">
            <GoLink to={`/proyectos/${p.id}`} className="group flex items-start gap-3 py-4">
              <span className="mt-1.5 h-8 w-1 shrink-0 rounded-full" style={{ background: colorVar(p.color) }} />
              <div className="min-w-0">
                <Shared name={`project-${p.id}`}>
                  <p className="text-lg font-semibold group-hover:text-cobalt">{p.name}</p>
                </Shared>
                <p className="text-sm text-muted">
                  {[
                    p.open_tasks && `${p.open_tasks} ${p.open_tasks === 1 ? "tarea" : "tareas"}`,
                    p.notes && `${p.notes} ${p.notes === 1 ? "nota" : "notas"}`,
                    p.documents && `${p.documents} documentos`,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Vacío por ahora"}
                </p>
              </div>
            </GoLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ProjectsPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
  const [creating, setCreating] = useState(false);

  return (
    <Page>
      <PageHeader title="Proyectos y áreas" sub="Agrupa tareas, notas y documentos de un mismo asunto.">
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={17} /> Nuevo
        </Button>
      </PageHeader>
      {projects.isPending ? (
        <Loading />
      ) : !projects.data?.length ? (
        <Empty icon={<FolderKanban size={20} />} title="Sin proyectos todavía">
          Crea áreas como Salud, Casa o Finanzas y proyectos como «Mudanza» para tenerlo todo junto.
        </Empty>
      ) : (
        <>
          <Group title="Proyectos" items={projects.data.filter((p) => p.kind === "project")} />
          <Group title="Áreas" items={projects.data.filter((p) => p.kind === "area")} />
        </>
      )}
      {creating && <ProjectSheet open onClose={() => setCreating(false)} />}
    </Page>
  );
}
