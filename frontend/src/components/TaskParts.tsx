import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, Repeat, Trash2 } from "lucide-react";
import { useState, ViewTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { api, type Task } from "../lib/api";
import { dueLabel, isOverdue } from "../lib/dates";
import { animate } from "../lib/nav";
import { Button, cx, Dot, Field, Input, Select, Sheet, Textarea } from "./ui";

export const PRIORITY = ["Sin prioridad", "Baja", "Media", "Alta"];
const PRIORITY_COLOR = ["", "text-faint", "text-ochre", "text-clay"];

export const REPEAT_OPTIONS = [
  { value: "", label: "No se repite" },
  { value: "FREQ=DAILY", label: "Cada día" },
  { value: "FREQ=WEEKLY", label: "Cada semana" },
  { value: "FREQ=WEEKLY;INTERVAL=2", label: "Cada dos semanas" },
  { value: "FREQ=MONTHLY", label: "Cada mes" },
  { value: "FREQ=YEARLY", label: "Cada año" },
];

export function useTaskMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["today"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };
  const toggle = useMutation({
    mutationFn: (t: Task) => api.updateTask(t.id, { done: !t.done_at }),
    onSuccess: (updated, t) => {
      animate(refresh);
      if (!t.done_at && !updated.done_at && updated.rrule) toast(`Hecha. Vuelve ${dueLabel(updated.due_date, updated.due_time)}.`);
      else if (!t.done_at) toast("Tarea completada", { action: { label: "Deshacer", onClick: () => api.updateTask(t.id, { done: false }).then(refresh) } });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return { toggle, refresh };
}

export function TaskRow({ task, onOpen, showProjectColor }: { task: Task; onOpen: (t: Task) => void; showProjectColor?: string | null }) {
  const { toggle } = useTaskMutations();
  const done = !!task.done_at;
  const due = dueLabel(task.due_date, task.due_time);
  const late = !done && isOverdue(task.due_date);
  return (
    <ViewTransition key={task.id}>
      <li className="group flex items-start gap-3 py-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Marcar «${task.title}» como pendiente` : `Completar «${task.title}»`}
          onClick={() => toggle.mutate(task)}
          className={cx(
            "mt-0.5 flex size-[1.35rem] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            done ? "border-moss bg-moss text-paper" : "border-faint hover:border-moss hover:bg-moss-soft",
          )}
        >
          {done && <Check size={13} strokeWidth={3} />}
        </button>
        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
          <span className={cx("block leading-snug", done && "text-faint line-through")}>{task.title}</span>
          {(due || task.rrule || task.tags.length > 0 || task.notes) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.82rem] text-muted">
              {due && <span className={cx("tabular", late && "font-medium text-clay")}>{late ? `Vencida ${due}` : due}</span>}
              {task.rrule && <Repeat size={12} aria-label="Se repite" />}
              {task.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
              {task.notes && <span className="max-w-[24ch] truncate text-faint">{task.notes}</span>}
            </span>
          )}
        </button>
        {showProjectColor && <Dot color={showProjectColor} className="mt-2" />}
        {task.priority > 0 && (
          <Flag size={15} className={cx("mt-1 shrink-0", PRIORITY_COLOR[task.priority])} aria-label={`Prioridad ${PRIORITY[task.priority].toLowerCase()}`} />
        )}
      </li>
    </ViewTransition>
  );
}

export function QuickAddTask({ defaults, placeholder = "Añadir tarea y pulsar Intro…" }: { defaults?: Partial<Task>; placeholder?: string }) {
  const [title, setTitle] = useState("");
  const { refresh } = useTaskMutations();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    try {
      if (defaults) await api.createTask({ ...defaults, title: text });
      else await api.capture(text); // entiende "llamar al taller el martes"
      animate(refresh);
    } catch (err) {
      setTitle(text);
      toast.error((err as Error).message);
    }
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-3 border-b border-line py-2">
      <span className="flex size-[1.35rem] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line" aria-hidden />
      <label htmlFor="quick-task" className="sr-only">
        Nueva tarea
      </label>
      <input
        id="quick-task"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-9 flex-1 bg-transparent placeholder:text-faint focus:outline-none"
      />
    </form>
  );
}

export function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { refresh } = useTaskMutations();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.projects(), enabled: !!task });
  const [draft, setDraft] = useState<Task | null>(task);
  if (task && draft?.id !== task.id) setDraft(task);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    try {
      await api.updateTask(draft.id, {
        title: draft.title,
        notes: draft.notes,
        due_date: draft.due_date || null,
        due_time: draft.due_date && draft.due_time ? draft.due_time.slice(0, 5) : null,
        priority: draft.priority,
        rrule: draft.rrule || null,
        project_id: draft.project_id || null,
        tags: draft.tags,
        remind: draft.remind,
      });
      refresh();
      onClose();
      toast("Tarea guardada");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!draft || !confirm("¿Eliminar esta tarea?")) return;
    await api.deleteTask(draft.id);
    refresh();
    onClose();
    toast("Tarea eliminada");
  };

  const set = (patch: Partial<Task>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <Sheet open={!!task} onClose={onClose} title="Tarea">
      {draft && (
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Qué hay que hacer">{(id) => <Input id={id} value={draft.title} onChange={(e) => set({ title: e.target.value })} required />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha">
              {(id) => <Input id={id} type="date" value={draft.due_date ?? ""} onChange={(e) => set({ due_date: e.target.value || null })} />}
            </Field>
            <Field label="Hora">
              {(id) => (
                <Input
                  id={id}
                  type="time"
                  value={draft.due_time?.slice(0, 5) ?? ""}
                  disabled={!draft.due_date}
                  onChange={(e) => set({ due_time: e.target.value || null })}
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prioridad">
              {(id) => (
                <Select id={id} value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
                  {PRIORITY.map((p, i) => (
                    <option key={p} value={i}>
                      {p}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Repetir">
              {(id) => (
                <Select id={id} value={draft.rrule ?? ""} onChange={(e) => set({ rrule: e.target.value || null })}>
                  {REPEAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Proyecto o área">
            {(id) => (
              <Select id={id} value={draft.project_id ?? ""} onChange={(e) => set({ project_id: e.target.value || null })}>
                <option value="">Ninguno</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Etiquetas" hint="Separadas por comas">
            {(id) => (
              <Input
                id={id}
                value={draft.tags.join(", ")}
                onChange={(e) =>
                  set({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
          </Field>
          <Field label="Notas">{(id) => <Textarea id={id} rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.remind} onChange={(e) => set({ remind: e.target.checked })} className="size-4 accent-[var(--cobalt)]" />
            Avisarme a la hora indicada
          </label>
          <div className="flex items-center justify-between pt-2">
            <Button variant="danger" onClick={remove}>
              <Trash2 size={16} /> Eliminar
            </Button>
            <Button type="submit" variant="primary">
              Guardar tarea
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
