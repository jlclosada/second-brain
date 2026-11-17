import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  FileText,
  FolderKanban,
  Inbox,
  LayoutGrid,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { api } from "../lib/api";
import { CaptureDialog } from "./Capture";
import CommandPalette from "./CommandPalette";
import Notifications from "./Notifications";
import { cx, Sheet } from "./ui";

// Navegación de la aplicación.
//   General     lo del día a día: Jarvis, agenda, tareas, correo y documentos
//   Biblioteca  lo que guardas: notas, diario, personas y proyectos
// En el móvil, las cinco de General van en la barra de abajo y la Biblioteca detrás de «Más».
type NavItem = { to: string; label: string; icon: typeof Sparkles; end?: boolean; match?: string[] };

const GENERAL: NavItem[] = [
  { to: "/", label: "Jarvis", icon: Sparkles, end: true, match: ["/hoy", "/buscar"] },
  { to: "/calendario", label: "Agenda", icon: CalendarDays },
  { to: "/tareas", label: "Tareas", icon: CheckSquare },
  { to: "/bandeja", label: "Correo", icon: Inbox },
  { to: "/documentos", label: "Documentos", icon: FileText },
];

const LIBRARY: NavItem[] = [
  { to: "/notas", label: "Notas", icon: NotebookPen },
  { to: "/diario", label: "Diario", icon: BookOpen },
  { to: "/personas", label: "Personas", icon: UsersRound },
  { to: "/proyectos", label: "Proyectos", icon: FolderKanban },
];

const SECTION_LABEL: Record<string, string> = {
  "": "Jarvis",
  hoy: "Jarvis",
  buscar: "Búsqueda",
  calendario: "Agenda",
  tareas: "Tareas",
  bandeja: "Correo",
  documentos: "Documentos",
  notas: "Notas",
  diario: "Diario",
  proyectos: "Proyectos",
  personas: "Personas",
  ajustes: "Ajustes",
};

const DETAIL_LABEL: Record<string, string> = { documentos: "Ficha", notas: "Nota", proyectos: "Proyecto", diario: "Entrada", personas: "Ficha" };

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full shadow-[0_0_14px_rgba(111,156,255,0.55)]"
      style={{ width: size * 0.62, height: size * 0.62, background: "radial-gradient(circle at 35% 30%, #eef3ff, #6f9cff 40%, #8b5cf6 75%, #2b1d5c)" }}
    />
  );
}

function useActive(item: NavItem) {
  const { pathname } = useLocation();
  if (item.end) return pathname === item.to || !!item.match?.some((m) => pathname === m);
  return [item.to, ...(item.match ?? [])].some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

function Count({ n, tone = "muted" }: { n?: number; tone?: "muted" | "accent" }) {
  if (!n) return null;
  return (
    <span
      className={cx(
        "ml-auto min-w-5 rounded-md px-1.5 text-center text-[0.7rem] leading-5 font-semibold tabular",
        tone === "accent" ? "bg-cobalt text-paper" : "bg-white/[0.06] text-muted",
      )}
    >
      {n > 999 ? "999+" : n}
    </span>
  );
}

function SideLink({ item, badge, tone }: { item: NavItem; badge?: number; tone?: "muted" | "accent" }) {
  const active = useActive(item);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[0.9rem] transition-colors",
        active ? "bg-white/[0.07] font-medium text-ink" : "text-muted hover:bg-white/[0.04] hover:text-ink",
      )}
    >
      {active && <span aria-hidden className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-cobalt" />}
      <Icon size={17} strokeWidth={active ? 2.1 : 1.8} className={cx("shrink-0", active ? "text-cobalt" : "text-faint group-hover:text-muted")} />
      <span className="truncate">{item.label}</span>
      <Count n={badge} tone={tone} />
    </NavLink>
  );
}

function DockLink({ item, badge }: { item: NavItem; badge?: number }) {
  const active = useActive(item);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cx("relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem]", active ? "text-ink" : "text-faint")}
    >
      {active && <span aria-hidden className="absolute inset-x-2 inset-y-1 rounded-xl bg-white/[0.07]" />}
      <Icon size={20} strokeWidth={active ? 2.2 : 1.7} className={cx("relative", active && "text-cobalt")} />
      <span className="relative">{item.label}</span>
      {!!badge && (
        <span className="absolute top-0.5 left-[calc(50%+4px)] min-w-4 rounded-full bg-cobalt px-1 text-center text-[0.6rem] leading-4 font-semibold text-paper tabular">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </NavLink>
  );
}

// Móvil: la Biblioteca (notas, diario, personas, proyectos) no cabe en la barra de abajo,
// así que va detrás de «Más», que se marca activo cuando estás en una de esas secciones.
function DockMore() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const active = LIBRARY.some((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-current={active ? "page" : undefined}
        className={cx("relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem]", active ? "text-ink" : "text-faint")}
      >
        {active && <span aria-hidden className="absolute inset-x-2 inset-y-1 rounded-xl bg-white/[0.07]" />}
        <LayoutGrid size={20} strokeWidth={active ? 2.2 : 1.7} className={cx("relative", active && "text-cobalt")} />
        <span className="relative">Más</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Biblioteca">
        <nav aria-label="Biblioteca" className="grid grid-cols-2 gap-2">
          {[...LIBRARY, { to: "/ajustes", label: "Ajustes", icon: Settings }].map((n) => {
            const Icon = n.icon;
            const here = pathname === n.to || pathname.startsWith(`${n.to}/`);
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={cx(
                  "flex items-center gap-3 rounded-xl border border-line px-4 py-3.5 text-sm font-medium",
                  here ? "bg-white/[0.07] text-ink" : "text-muted hover:text-ink",
                )}
              >
                <Icon size={19} className={here ? "text-cobalt" : undefined} />
                {n.label}
              </NavLink>
            );
          })}
        </nav>
      </Sheet>
    </>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const [section = "", detail] = pathname.split("/").filter(Boolean);
  const label = SECTION_LABEL[section] ?? "Jarvis";
  return (
    <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 text-sm">
      {detail ? (
        <>
          <NavLink to={`/${section}`} className="text-muted hover:text-ink">
            {label}
          </NavLink>
          <ChevronRight size={14} className="shrink-0 text-faint" />
          <span className="truncate font-medium text-ink">{DETAIL_LABEL[section] ?? detail}</span>
        </>
      ) : (
        <span className="font-medium text-ink">{label}</span>
      )}
    </nav>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState(false);
  const [capture, setCapture] = useState(false);
  const [bell, setBell] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
  const unread = useQuery({ queryKey: ["unread"], queryFn: api.unread, refetchInterval: 60_000 });
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, refetchInterval: 2 * 60_000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, staleTime: 60_000 });
  const attention = today.data?.inbox?.counts.attention ?? 0;
  const unreadCount = unread.data?.count ?? 0;
  const name = me.data?.prefs.name || me.data?.user || "Tú";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true]");
      if (document.querySelector("dialog[open]")) return;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearch(true);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "c" || e.key === "n")) {
        e.preventDefault();
        setCapture(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const iconBtn = "relative flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <div className="aurora" aria-hidden />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>

      {/* Barra lateral (ordenador) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-sunken/80 lg:flex">
        <NavLink to="/" className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-5" aria-label="Jarvis, inicio">
          <BrandMark size={34} />
          <span className="leading-tight">
            <span className="block font-display text-[0.98rem] font-semibold tracking-tight">Jarvis</span>
            <span className="block text-[0.7rem] text-faint">Segundo cerebro</span>
          </span>
        </NavLink>

        <div className="px-3 pt-4">
          <button
            type="button"
            onClick={() => setCapture(true)}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-cobalt text-sm font-semibold text-paper transition hover:brightness-110"
          >
            <Plus size={16} strokeWidth={2.4} /> Nuevo
            <kbd className="ml-1 border-paper/25 bg-paper/10 text-paper/80">C</kbd>
          </button>
        </div>

        <nav aria-label="Secciones" className="scrollbar-thin mt-4 flex-1 overflow-y-auto px-3">
          <p className="px-2.5 pb-1.5 text-[0.7rem] font-semibold tracking-wide text-faint uppercase">General</p>
          <div className="flex flex-col gap-0.5">
            {GENERAL.map((n) => (
              <SideLink
                key={n.to}
                item={n}
                badge={n.to === "/bandeja" ? attention : n.to === "/documentos" ? stats.data?.total : undefined}
                tone={n.to === "/bandeja" ? "accent" : "muted"}
              />
            ))}
          </div>
          <p className="px-2.5 pt-5 pb-1.5 text-[0.7rem] font-semibold tracking-wide text-faint uppercase">Biblioteca</p>
          <div className="flex flex-col gap-0.5">
            {LIBRARY.map((n) => (
              <SideLink key={n.to} item={n} />
            ))}
          </div>
        </nav>

        <div className="border-t border-line p-3">
          <SideLink item={{ to: "/ajustes", label: "Ajustes y conexiones", icon: Settings }} />
          <div className="mt-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cobalt-soft text-xs font-semibold text-cobalt uppercase">
              {name.charAt(0)}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block text-[0.7rem] text-faint">{me.data?.ai_enabled ? "Claude conectado" : "Sin clave de Claude"}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Barra superior (ordenador): dónde estás, búsqueda global y avisos */}
        <header className="sticky top-0 z-20 hidden h-14 items-center gap-4 border-b border-line bg-paper/85 px-6 backdrop-blur-md lg:flex xl:px-8">
          <Breadcrumbs />
          <button
            type="button"
            onClick={() => setSearch(true)}
            className="ml-auto flex h-9 w-full max-w-sm items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted"
          >
            <Search size={15} />
            <span className="flex-1 text-left">Buscar en todo…</span>
            <kbd>⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setBell(true)}
            className={iconBtn}
            aria-label={unreadCount ? `Avisos, ${unreadCount} sin leer` : "Avisos"}
            title="Avisos"
          >
            <Bell size={17} />
            {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-ochre ring-2 ring-paper" />}
          </button>
        </header>

        {/* Arriba (móvil): solo lo imprescindible */}
        <header className="sticky top-0 z-20 flex items-center justify-between px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1 lg:hidden">
          <NavLink to="/" className="flex items-center gap-2 pl-1" aria-label="Jarvis">
            <BrandMark size={30} />
            <span className="font-display text-base font-semibold tracking-tight">Jarvis</span>
          </NavLink>
          <div className="chrome flex items-center rounded-xl">
            <button type="button" className={cx(iconBtn, "size-10")} aria-label="Buscar" onClick={() => setSearch(true)}>
              <Search size={19} />
            </button>
            <button
              type="button"
              className={cx(iconBtn, "size-10")}
              aria-label={unreadCount ? `Avisos, ${unreadCount} sin leer` : "Avisos"}
              onClick={() => setBell(true)}
            >
              <Bell size={19} />
              {unreadCount > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-ochre" />}
            </button>
            <NavLink to="/ajustes" className={cx(iconBtn, "size-10")} aria-label="Ajustes y conexiones">
              <Settings size={19} />
            </NavLink>
          </div>
        </header>

        <main id="contenido" className="mx-auto w-full max-w-[1360px] min-w-0 px-4 pt-4 pb-32 sm:px-6 lg:px-8 lg:pt-8 lg:pb-14 xl:px-10">
          {children}
        </main>
      </div>

      {/* Barra de abajo (móvil) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <nav aria-label="Secciones" className="chrome pointer-events-auto mx-auto flex max-w-md items-stretch rounded-2xl px-1">
          {GENERAL.map((n) => (
            <DockLink key={n.to} item={n} badge={n.to === "/bandeja" ? attention : undefined} />
          ))}
          <DockMore />
        </nav>
      </div>

      <Notifications open={bell} onClose={() => setBell(false)} />
      <CommandPalette open={search} onClose={() => setSearch(false)} />
      <CaptureDialog open={capture} onClose={() => setCapture(false)} />
    </div>
  );
}
