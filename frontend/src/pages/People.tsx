import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, CircleAlert, ListTodo, Plus, Search, UserRound, UsersRound } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import LibraryTabs from "../components/LibraryTabs";
import { Badge, Button, cx, Empty, Field, Input, Loading, PageHeader, Segmented, Sheet, Stat, Textarea } from "../components/ui";
import { api, ApiError, type PersonSummary } from "../lib/api";
import { ago, capitalize, dayFromIso, isoDay, relativeDay } from "../lib/dates";
import { GoLink, Page, Shared, useGo } from "../lib/nav";

// Personas: una chuleta con memoria de cada persona. Cada ficha es una nota de tu vault
// (02-Areas/Personas/<nombre>.md) con lo que ha pasado y su fecha, cómo tratarle y lo pendiente.
// Jarvis la lee para responder «¿qué sé de Samuel?» y te la recuerda antes de cada reunión.

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const AVATAR = ["cobalt", "violet", "teal", "ochre", "rose", "moss", "plum", "cyan"];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = AVATAR[h % AVATAR.length];
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        color: `var(--${color})`,
        background: `color-mix(in oklab, var(--${color}) 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(--${color}) 30%, transparent)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** «hoy», «ayer», «el 3 de marzo»… */
export function entryDay(iso: string | null) {
  if (!iso) return "Sin fecha";
  return capitalize(relativeDay(dayFromIso(iso)));
}

export function NewPersonSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const go = useGo();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", relation: "", company: "", role: "", email: "", about: "", entry: "", date: isoDay(new Date()) });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const p = await api.createPerson({
        name: form.name.trim(),
        relation: form.relation.trim() || null,
        company: form.company.trim() || null,
        role: form.role.trim() || null,
        email: form.email.trim() || null,
        about: form.about.trim() || undefined,
      });
      if (form.entry.trim()) await api.addPersonEntry(p.id, { text: form.entry.trim(), date: form.date || undefined });
      queryClient.invalidateQueries({ queryKey: ["people"] });
      toast(`Ficha de ${p.name} creada`);
      onClose();
      go(`/personas/${p.id}`, "nav-forward");
    } catch (err) {
      const detail = err instanceof ApiError ? (err.detail as { id?: string } | undefined) : undefined;
      if (err instanceof ApiError && err.status === 409 && detail?.id) {
        toast(err.message, { action: { label: "Abrir", onClick: () => go(`/personas/${detail.id}`, "nav-forward") } });
      } else {
        toast.error((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Nueva persona" wide>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Nombre">{(id) => <Input id={id} value={form.name} onChange={set("name")} placeholder="Samuel Ortega" autoFocus required maxLength={120} />}</Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Relación">
            {(id) => <Input id={id} value={form.relation} onChange={set("relation")} placeholder="cliente, equipo, amigo…" list="people-relations" maxLength={60} />}
          </Field>
          <Field label="Empresa">{(id) => <Input id={id} value={form.company} onChange={set("company")} placeholder="Acme" maxLength={200} />}</Field>
          <Field label="Cargo">{(id) => <Input id={id} value={form.role} onChange={set("role")} placeholder="Director comercial" maxLength={200} />}</Field>
        </div>
        <Field label="Email" hint="Con el email, Jarvis le reconoce entre los asistentes de tus reuniones y en tu correo.">
          {(id) => <Input id={id} type="email" value={form.email} onChange={set("email")} placeholder="samuel@acme.es" maxLength={200} />}
        </Field>
        <Field label="Quién es">
          {(id) => <Textarea id={id} rows={2} value={form.about} onChange={set("about")} placeholder="Cómo le conociste, a qué se dedica…" maxLength={2000} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Primer apunte (opcional)">
            {(id) => <Input id={id} value={form.entry} onChange={set("entry")} placeholder="Ha conseguido un ascenso" maxLength={4000} />}
          </Field>
          <Field label="Fecha">{(id) => <Input id={id} type="date" value={form.date} onChange={set("date")} />}</Field>
        </div>
        <datalist id="people-relations">
          {["cliente", "equipo", "proveedor", "socio", "amigo", "familia"].map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !form.name.trim()}>
            Crear ficha
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function PersonCardLink({ p }: { p: PersonSummary }) {
  const sub = [p.role, p.company].filter(Boolean).join(" · ");
  return (
    <GoLink to={`/personas/${p.id}`} className="glass glass-hover group flex min-w-0 flex-col gap-3 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <Avatar name={p.name} />
        <div className="min-w-0 flex-1">
          <Shared name={`person-${p.id}`}>
            <p className="truncate font-semibold group-hover:text-cobalt">{p.name}</p>
          </Shared>
          <p className="truncate text-sm text-muted">{sub || "Sin cargo ni empresa"}</p>
        </div>
        {p.relation && <Badge>{capitalize(p.relation)}</Badge>}
      </div>
      {p.last_entry ? (
        <p className="line-clamp-2 text-sm">
          <span className="text-faint">{entryDay(p.last_entry.date)} · </span>
          {p.last_entry.text}
        </p>
      ) : (
        <p className="text-sm text-faint">Aún sin apuntes.</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-faint">
        <span>
          {p.entries} {p.entries === 1 ? "apunte" : "apuntes"}
        </span>
        {p.pending > 0 && (
          <Badge tone="warning">
            <ListTodo size={12} /> {p.pending} pendiente{p.pending > 1 ? "s" : ""}
          </Badge>
        )}
        {p.updated_at && <span className="ml-auto">Editada {ago(p.updated_at)}</span>}
      </div>
    </GoLink>
  );
}

export default function PeoplePage() {
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ["people"], queryFn: api.people });
  const [text, setText] = useState("");
  const [relation, setRelation] = useState("all");
  const creating = params.get("nueva") === "1";
  const setCreating = (v: boolean) => setParams(v ? { nueva: "1" } : {}, { replace: true });

  const everyone = list.data?.people ?? [];
  const relations = useMemo(() => [...new Set(everyone.map((p) => p.relation?.toLowerCase()).filter(Boolean) as string[])].sort(), [everyone]);
  const shown = useMemo(() => {
    const q = norm(text.trim());
    return everyone
      .filter((p) => relation === "all" || p.relation?.toLowerCase() === relation)
      .filter((p) => !q || norm([p.name, p.company, p.role, p.relation, p.last_entry?.text].filter(Boolean).join(" ")).includes(q))
      .sort((a, b) => (b.last_entry?.date ?? b.updated_at ?? "").localeCompare(a.last_entry?.date ?? a.updated_at ?? ""));
  }, [everyone, text, relation]);

  const monthAgo = isoDay(new Date(Date.now() - 30 * 86_400_000));
  const recent = everyone.filter((p) => (p.last_entry?.date ?? "") >= monthAgo).length;
  const pending = everyone.reduce((n, p) => n + p.pending, 0);

  return (
    <Page>
      <LibraryTabs />
      <PageHeader title="Personas" sub="Tu chuleta con memoria: lo que pasa con cada persona, con su fecha, para llegar preparado.">
        <Button variant="primary" onClick={() => setCreating(true)} disabled={list.data && !list.data.vault}>
          <Plus size={16} strokeWidth={2.4} /> Nueva persona
        </Button>
      </PageHeader>

      {list.isPending ? (
        <Loading />
      ) : list.data && !list.data.vault ? (
        <Empty icon={<CircleAlert size={22} />} title="Conecta tu vault de Obsidian">
          Las fichas de personas se guardan como notas en tu vault. Configura <code>VAULT_DIR</code> y vuelve aquí.
        </Empty>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Personas" value={everyone.length} icon={<UsersRound size={15} />} tone="accent" />
            <Stat label="Con novedades" value={recent} hint="Apuntes en los últimos 30 días" icon={<CalendarHeart size={15} />} tone="success" />
            <Stat label="Pendientes" value={pending} hint="Cosas que les debes o quedan por hacer" icon={<ListTodo size={15} />} tone="warning" />
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label className="flex h-10 min-w-0 flex-1 basis-64 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 focus-within:border-cobalt">
              <Search size={16} className="shrink-0 text-faint" />
              <span className="sr-only">Filtrar personas</span>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Nombre, empresa o algo que pasó…"
                className="h-full min-w-0 flex-1 bg-transparent placeholder:text-faint focus:outline-none"
              />
            </label>
            {relations.length > 0 && (
              <Segmented
                label="Relación"
                value={relation}
                onChange={setRelation}
                options={[{ value: "all", label: "Todas" }, ...relations.map((r) => ({ value: r, label: capitalize(r) }))]}
              />
            )}
          </div>

          {everyone.length === 0 ? (
            <Empty icon={<UserRound size={22} />} title="Aún no tienes fichas de personas">
              Crea una con «Nueva persona» o díselo a Jarvis: «apunta que Samuel ha conseguido un ascenso».
            </Empty>
          ) : shown.length === 0 ? (
            <p className="text-muted">Nadie encaja con ese filtro.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <PersonCardLink key={p.id} p={p} />
              ))}
            </div>
          )}
        </>
      )}
      <NewPersonSheet open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
