import { useQuery } from "@tanstack/react-query";
import { Bell, Bot, CalendarDays, CheckSquare, Inbox, Library, Plus, Search, Settings, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { api } from "../lib/api";
import { CaptureDialog } from "./Capture";
import CommandPalette from "./CommandPalette";
import { LIBRARY_PATHS } from "./LibraryTabs";
import Notifications from "./Notifications";
import { cx, IconButton } from "./ui";

// Cinco secciones, siempre las mismas en el ordenador y en el móvil:
//   Hoy        lo que toca ahora (agenda, tareas, correo, GitHub)
//   Bandeja    el correo de Gmail que requiere atención
//   Calendario tu agenda (propia y de Google)
//   Tareas     todo lo que tienes que hacer
//   Biblioteca lo que guardas para consultar: notas, diario, documentos, proyectos
type NavItem = { to: string; label: string; icon: typeof Sun; end?: boolean; match?: string[] };

const NAV: NavItem[] = [
  { to: "/", label: "Hoy", icon: Sun, end: true, match: ["/hoy"] },
  { to: "/bandeja", label: "Bandeja", icon: Inbox },
  { to: "/calendario", label: "Calendario", icon: CalendarDays },
  { to: "/tareas", label: "Tareas", icon: CheckSquare },
  { to: "/notas", label: "Biblioteca", icon: Library, match: LIBRARY_PATHS },
];

export function BrandMark({ size = 28 }: { size?: number }) {
  // El hilo del día: una línea vertical con el punto del ahora.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--night)" />
      <path d="M16 6v20" stroke="var(--ochre)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M16 11h6M16 21h-6" stroke="var(--night-ink)" strokeWidth="2.5" strokeLinecap="round" opacity=".85" />
      <circle cx="16" cy="16" r="3.6" fill="var(--ochre)" />
    </svg>
  );
}

function useActive(item: NavItem) {
  const { pathname } = useLocation();
  if (item.end) return pathname === item.to || !!item.match?.some((m) => pathname === m);
  return [item.to, ...(item.match ?? [])].some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

function Badge({ count, tone = "ochre" }: { count?: number; tone?: "ochre" | "cobalt" }) {
  if (!count) return null;
  return (
    <span
      className={cx(
        "ml-auto min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular",
        tone === "ochre" ? "bg-ochre text-ink" : "bg-cobalt text-white dark:text-paper",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SideLink({ item, badge }: { item: NavItem; badge?: number }) {
  const active = useActive(item);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] transition-colors",
        active ? "bg-surface font-semibold text-ink shadow-lift" : "text-muted hover:bg-sunken hover:text-ink",
      )}
    >
      <Icon size={18} strokeWidth={1.9} />
      {item.label}
      <Badge count={badge} tone="cobalt" />
    </NavLink>
  );
}

function TabLink({ item, badge }: { item: NavItem; badge?: number }) {
  const active = useActive(item);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cx("relative flex flex-col items-center gap-0.5 py-1 text-[0.7rem]", active ? "font-semibold text-ink" : "text-muted")}
    >
      <Icon size={22} strokeWidth={active ? 2.3 : 1.8} />
      {item.label}
      {!!badge && (
        <span className="absolute top-0 left-[calc(50%+6px)] min-w-4 rounded-full bg-cobalt px-1 text-center text-[0.62rem] leading-4 font-semibold text-white tabular dark:text-paper">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </NavLink>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState(false);
  const [capture, setCapture] = useState(false);
  const [bell, setBell] = useState(false);
  const location = useLocation();
  const unread = useQuery({ queryKey: ["unread"], queryFn: api.unread, refetchInterval: 60_000 });
  // El número de la bandeja: correos que requieren atención.
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, refetchInterval: 5 * 60_000 });
  const attention = today.data?.inbox?.counts.attention ?? 0;

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

  const unreadCount = unread.data?.count ?? 0;
  const inAssistant = location.pathname.startsWith("/asistente");

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>

      {/* Barra lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r border-line px-4 py-5 lg:flex">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <BrandMark />
          <span className="font-display text-[1.15rem] font-semibold tracking-tight">Segundo cerebro</span>
        </div>
        <button
          type="button"
          onClick={() => setCapture(true)}
          className="mb-2 flex h-11 items-center gap-2 rounded-xl bg-ink px-3.5 text-left font-medium text-paper transition-transform active:scale-[0.98]"
        >
          <Plus size={18} />
          <span className="flex-1">Apuntar algo</span>
          <kbd className="rounded border border-paper/25 px-1.5 text-[0.7rem] text-paper/70">C</kbd>
        </button>
        <button
          type="button"
          onClick={() => setSearch(true)}
          className="mb-4 flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-left text-sm text-faint transition-colors hover:border-muted"
        >
          <Search size={16} />
          <span className="flex-1">Buscar</span>
          <kbd className="rounded border border-line px-1.5 text-[0.7rem] text-muted">⌘K</kbd>
        </button>
        <nav aria-label="Secciones" className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <SideLink key={n.to} item={n} badge={n.to === "/bandeja" ? attention : undefined} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <SideLink item={{ to: "/asistente", label: "Asistente", icon: Bot }} />
          <button
            type="button"
            onClick={() => setBell(true)}
            className="flex h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] text-muted hover:bg-sunken hover:text-ink"
          >
            <Bell size={18} strokeWidth={1.9} />
            Avisos
            <Badge count={unreadCount} />
          </button>
          <SideLink item={{ to: "/ajustes", label: "Ajustes y conexiones", icon: Settings }} />
        </div>
      </aside>

      {/* Cabecera (móvil) */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/90 px-3 py-2 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 pl-1">
          <BrandMark size={26} />
          <span className="font-display text-base font-semibold">Segundo cerebro</span>
        </div>
        <div className="flex items-center">
          <IconButton label="Buscar" onClick={() => setSearch(true)} className="size-10">
            <Search size={20} />
          </IconButton>
          <NavLink
            to="/asistente"
            aria-label="Asistente"
            title="Asistente"
            className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-sunken"
          >
            <Bot size={20} />
          </NavLink>
          <IconButton label={unreadCount ? `Avisos, ${unreadCount} sin leer` : "Avisos"} onClick={() => setBell(true)} className="relative size-10">
            <Bell size={20} />
            {unreadCount > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-ochre" />}
          </IconButton>
          <NavLink
            to="/ajustes"
            aria-label="Ajustes y conexiones"
            title="Ajustes"
            className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-sunken"
          >
            <Settings size={20} />
          </NavLink>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-[1180px] min-w-0 px-4 pt-5 pb-32 sm:px-6 lg:px-10 lg:pt-9 lg:pb-12">
        {children}
      </main>

      {/* Botón para apuntar (siempre a mano, salvo en el asistente, que tiene su propia caja) */}
      {!inAssistant && (
        <button
          type="button"
          onClick={() => setCapture(true)}
          aria-label="Apuntar algo nuevo"
          className="fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-2xl bg-ink text-paper shadow-lift transition-transform active:scale-95 lg:hidden"
        >
          <Plus size={26} />
        </button>
      )}

      {/* Barra inferior (móvil) */}
      <nav
        aria-label="Secciones"
        className="pb-safe fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface/95 pt-1.5 backdrop-blur lg:hidden"
      >
        {NAV.map((n) => (
          <TabLink key={n.to} item={n} badge={n.to === "/bandeja" ? attention : undefined} />
        ))}
      </nav>

      <Notifications open={bell} onClose={() => setBell(false)} />
      <CommandPalette open={search} onClose={() => setSearch(false)} />
      <CaptureDialog open={capture} onClose={() => setCapture(false)} />
    </div>
  );
}
