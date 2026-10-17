import { useQuery } from "@tanstack/react-query";
import { CheckSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { QuickAddTask, TaskRow, TaskSheet } from "../components/TaskParts";
import { cx, Dot, Empty, Loading, PageHeader } from "../components/ui";
import { api, type Task } from "../lib/api";
import { dayFromIso, fmt, isOverdue, relativeDay } from "../lib/dates";
import { Page } from "../lib/nav";

const VIEWS = [
  { value: "today", label: "Hoy", empty: "Nada para hoy. Disfruta." },
  { value: "upcoming", label: "Próximas", empty: "No hay tareas con fecha futura." },
  { value: "inbox", label: "Sin fecha", empty: "Aquí van las tareas sin fecha ni proyecto." },
  { value: "open", label: "Todas", empty: "No tienes tareas pendientes." },
  { value: "done", label: "Hechas", empty: "Lo que completes en los últimos 30 días aparecerá aquí." },
];

function groupByDay(tasks: Task[]) {
  const groups: { label: string; tasks: Task[] }[] = [];
  for (const t of tasks) {
    const label = !t.due_date
      ? "Sin fecha"
      : isOverdue(t.due_date)
        ? "Vencidas"
        : relativeDay(t.due_date) === "hoy"
          ? "Hoy"
          : fmt(dayFromIso(t.due_date), "EEEE d 'de' MMMM");
    const last = groups.at(-1);
    if (last?.label === label) last.tasks.push(t);
    else groups.push({ label, tasks: [t] });
  }
  return groups;
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("vista") ?? "today";
  const projectId = params.get("proyecto");
  const [open, setOpen] = useState<Task | null>(null);

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
  const tasks = useQuery({
    queryKey: ["tasks", view, projectId],
    queryFn: () => api.tasks({ view: projectId ? "open" : view, project_id: projectId ?? undefined }),
  });

  // ?t=<id> abre una tarea concreta (desde la búsqueda o el asistente).
  const linked = params.get("t");
  useEffect(() => {
    if (!linked) return;
    api.tasks({ view: "all" }).then((all) => setOpen(all.find((t) => t.id === linked) ?? null));
  }, [linked]);

  const project = projects.data?.find((p) => p.id === projectId);
  const groups = useMemo(
    () => (view === "upcoming" || view === "open" ? groupByDay(tasks.data ?? []) : [{ label: "", tasks: tasks.data ?? [] }]),
    [tasks.data, view],
  );
  const colorOf = (t: Task) => projects.data?.find((p) => p.id === t.project_id)?.color ?? null;

  const select = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v);
    setParams(next, { replace: true });
  };

  return (
    <Page>
      <PageHeader title={project ? project.name : "Tareas"} sub={project ? (project.kind === "area" ? "Área" : "Proyecto") : undefined} />
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Vistas de tareas" className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              to={`/tareas?vista=${v.value}`}
              replace
              aria-current={!projectId && view === v.value ? "page" : undefined}
              className={cx(
                "flex h-9 shrink-0 items-center rounded-lg px-3 text-left text-[0.95rem] whitespace-nowrap",
                !projectId && view === v.value ? "bg-ink text-paper" : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              {v.label}
            </Link>
          ))}
          {!!projects.data?.length && <p className="mt-4 mb-1 hidden px-3 text-sm text-faint lg:block">Proyectos y áreas</p>}
          {projects.data?.map((p) => (
            <Link
              key={p.id}
              to={`/tareas?proyecto=${p.id}`}
              replace
              aria-current={projectId === p.id ? "page" : undefined}
              className={cx(
                "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-[0.95rem] whitespace-nowrap",
                projectId === p.id ? "bg-ink text-paper" : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <Dot color={p.color} />
              <span className="truncate">{p.name}</span>
              {p.open_tasks > 0 && <span className="ml-auto text-xs opacity-70 tabular">{p.open_tasks}</span>}
            </Link>
          ))}
        </nav>

        <div className="min-w-0 max-w-3xl">
          {view !== "done" && (
            <QuickAddTask
              defaults={projectId ? { project_id: projectId } : view === "inbox" ? {} : undefined}
              placeholder={projectId ? `Añadir a ${project?.name ?? "este proyecto"}…` : "Añade una tarea: «pagar el IBI el 5 de noviembre»…"}
            />
          )}
          {tasks.isPending ? (
            <Loading />
          ) : !tasks.data?.length ? (
            <div className="mt-6">
              <Empty icon={<CheckSquare size={20} />} title={VIEWS.find((v) => v.value === view)?.empty ?? "Sin tareas"} />
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label || "all"} className="mt-4">
                {g.label && (
                  <h2 className={cx("mb-1 text-sm font-semibold first-letter:uppercase", g.label === "Vencidas" ? "text-clay" : "text-muted")}>{g.label}</h2>
                )}
                <ul className="divide-y divide-line">
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={setOpen} showProjectColor={projectId ? null : colorOf(t)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
      <TaskSheet
        task={open}
        onClose={() => {
          setOpen(null);
          if (linked) select({ vista: view });
        }}
      />
    </Page>
  );
}
