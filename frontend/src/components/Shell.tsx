import { useQuery } from "@tanstack/react-query";
import { Bell, Bot, CalendarDays, CheckSquare, FileText, FolderKanban, LogOut, Menu, NotebookPen, Plus, Search, Settings, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { api } from "../lib/api";
import CommandPalette from "./CommandPalette";
import Notifications from "./Notifications";
import { cx, IconButton, Sheet } from "./ui";

const NAV = [
  { to: "/", label: "Hoy", icon: Sun, end: true },
  { to: "/calendario", label: "Calendario", icon: CalendarDays },
  { to: "/tareas", label: "Tareas", icon: CheckSquare },
  { to: "/notas", label: "Notas", icon: NotebookPen },
  { to: "/documentos", label: "Documentos", icon: FileText },
  { to: "/proyectos", label: "Proyectos y áreas", icon: FolderKanban },
  { to: "/asistente", label: "Asistente", icon: Bot },
];

const MOBILE = [NAV[0], NAV[1], NAV[2], NAV[3]];

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

function SideLink({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] transition-colors",
          isActive ? "bg-surface font-semibold text-ink shadow-lift" : "text-muted hover:bg-sunken hover:text-ink",
        )
      }
    >
      <Icon size={18} strokeWidth={1.9} />
      {label}
    </NavLink>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState<{ open: boolean; capture: boolean }>({ open: false, capture: false });
  const [more, setMore] = useState(false);
  const [bell, setBell] = useState(false);
  const location = useLocation();
  const unread = useQuery({ queryKey: ["unread"], queryFn: api.unread, refetchInterval: 60_000 });

  useEffect(() => setMore(false), [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette({ open: true, capture: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openCapture = () => setPalette({ open: true, capture: true });
  const unreadCount = unread.data?.count ?? 0;

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
          onClick={() => setPalette({ open: true, capture: false })}
          className="mb-4 flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-left text-sm text-faint transition-colors hover:border-muted"
        >
          <Search size={16} />
          <span className="flex-1">Buscar o capturar</span>
          <kbd className="rounded border border-line px-1.5 text-[0.7rem] text-muted">⌘K</kbd>
        </button>
        <nav aria-label="Secciones" className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <SideLink key={n.to} {...n} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setBell(true)}
            className="flex h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] text-muted hover:bg-sunken hover:text-ink"
          >
            <Bell size={18} strokeWidth={1.9} />
            Avisos
            {unreadCount > 0 && <span className="ml-auto rounded-full bg-ochre px-1.5 text-xs font-semibold text-ink tabular">{unreadCount}</span>}
          </button>
          <SideLink to="/ajustes" label="Ajustes" icon={Settings} />
        </div>
      </aside>

      {/* Cabecera (móvil) */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <BrandMark size={26} />
          <span className="font-display text-base font-semibold">Segundo cerebro</span>
        </div>
        <div className="flex items-center">
          <IconButton label="Buscar" onClick={() => setPalette({ open: true, capture: false })}>
            <Search size={19} />
          </IconButton>
          <IconButton label={unreadCount ? `Avisos, ${unreadCount} sin leer` : "Avisos"} onClick={() => setBell(true)} className="relative">
            <Bell size={19} />
            {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-ochre" />}
          </IconButton>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-[1180px] px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-9 lg:pb-12">
        {children}
      </main>

      {/* Botón de captura (siempre a mano, salvo en el asistente, que tiene su propia caja) */}
      {!location.pathname.startsWith("/asistente") && (
        <button
          type="button"
          onClick={openCapture}
          aria-label="Capturar algo nuevo"
          className="fixed right-5 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-2xl bg-ink text-paper shadow-lift transition-transform active:scale-95 lg:right-8 lg:bottom-8"
        >
          <Plus size={26} />
        </button>
      )}

      {/* Barra inferior (móvil) */}
      <nav
        aria-label="Secciones"
        className="pb-safe fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface/95 pt-1.5 backdrop-blur lg:hidden"
      >
        {MOBILE.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-1 text-[0.7rem]", isActive ? "font-semibold text-ink" : "text-muted")}
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2.3 : 1.8} />
                {label}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-1 text-[0.7rem] text-muted">
          <Menu size={22} strokeWidth={1.8} />
          Más
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="Más">
        <nav className="flex flex-col gap-0.5">
          {[
            ...NAV.slice(4),
            { to: "/buscar", label: "Buscar", icon: Search },
            { to: "/diario", label: "Diario", icon: NotebookPen },
            { to: "/ajustes", label: "Ajustes", icon: Settings },
          ].map((n) => (
            <SideLink key={n.to} {...n} />
          ))}
          <button
            type="button"
            onClick={() => api.logout().finally(() => window.dispatchEvent(new Event("sb:logout")))}
            className="flex h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] text-clay hover:bg-clay-soft"
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </nav>
      </Sheet>

      <Notifications open={bell} onClose={() => setBell(false)} />
      <CommandPalette open={palette.open} captureFirst={palette.capture} onClose={() => setPalette({ open: false, capture: false })} />
    </div>
  );
}
