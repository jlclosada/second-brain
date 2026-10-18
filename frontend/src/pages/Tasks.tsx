import { useQuery } from "@tanstack/react-query";
import { CheckSquare, GitPullRequest, Mail } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { QuickAddTask, TaskRow, TaskSheet } from "../components/TaskParts";
import { cx, Empty, Loading, PageHeader, Segmented } from "../components/ui";
import { api, type Task } from "../lib/api";
import { dayFromIso, fmt, isOverdue, relativeDay } from "../lib/dates";
import { Page } from "../lib/nav";

// Una sola lista: todo lo pendiente, ordenado por cuándo toca (vencidas, hoy, los próximos días y lo
// que no tiene fecha). Si quieres ver solo lo de GitHub o lo que salió del correo, un toque.

const SOURCES = [
  { value: "", label: "Todas", icon: CheckSquare },
  { value: "github", label: "GitHub", icon: GitPullRequest },
  { value: "correo", label: "Del correo", icon: Mail },
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
          : relativeDay(t.due_date) === "mañana"
            ? "Mañana"
            : fmt(dayFromIso(t.due_date), "EEEE d 'de' MMMM");
    const last = groups.at(-1);
    if (last?.label === label) last.tasks.push(t);
    else groups.push({ label, tasks: [t] });
  }
  return groups;
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const done = params.get("vista") === "done";
  const tag = params.get("etiqueta") ?? "";
  const [open, setOpen] = useState<Task | null>(null);

  const tasks = useQuery({
    queryKey: ["tasks", done ? "done" : "open", tag],
    queryFn: () => api.tasks({ view: done ? "done" : "open", tag: tag || undefined }),
  });

  // ?t=<id> abre una tarea concreta (desde la búsqueda o Jarvis).
  const linked = params.get("t");
  useEffect(() => {
    if (!linked) return;
    api.tasks({ view: "all" }).then((all) => setOpen(all.find((t) => t.id === linked) ?? null));
  }, [linked]);

  const groups = useMemo(() => (done ? [{ label: "", tasks: tasks.data ?? [] }] : groupByDay(tasks.data ?? [])), [tasks.data, done]);
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams();
    const merged = { vista: done ? "done" : "", etiqueta: tag, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    setParams(next, { replace: true });
  };
  const count = done ? 0 : (tasks.data?.length ?? 0);

  return (
    <Page>
      <PageHeader title="Tareas" sub={count ? `${count} pendientes` : undefined}>
        <Segmented<"open" | "done">
          label="Qué tareas ver"
          value={done ? "done" : "open"}
          onChange={(v) => set({ vista: v === "done" ? "done" : "" })}
          options={[
            { value: "open", label: "Pendientes" },
            { value: "done", label: "Hechas" },
          ]}
        />
      </PageHeader>

      <div className="max-w-3xl">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {SOURCES.map(({ value, label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => set({ etiqueta: value })}
              aria-pressed={tag === value}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition-colors",
                tag === value ? "bg-white/[0.08] text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink",
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {!done && !tag && <QuickAddTask placeholder="Añade una tarea: «llamar al taller el martes»…" />}

        {tasks.isPending ? (
          <Loading />
        ) : !tasks.data?.length ? (
          <div className="mt-6">
            <Empty icon={<CheckSquare size={20} />} title={done ? "Lo que completes aparecerá aquí." : "Nada pendiente. Todo al día."} />
          </div>
        ) : (
          groups.map((g, gi) => (
            <motion.section
              key={g.label || "all"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.04 }}
              className="mt-5"
            >
              {g.label && <h2 className={cx("eyebrow mb-1", g.label === "Vencidas" && "text-clay")}>{g.label}</h2>}
              <ul className="divide-y divide-line">
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setOpen} />
                ))}
              </ul>
            </motion.section>
          ))
        )}
      </div>
      <TaskSheet
        task={open}
        onClose={() => {
          setOpen(null);
          if (linked) set({});
        }}
      />
    </Page>
  );
}
