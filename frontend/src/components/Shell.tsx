import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays, CheckSquare, Inbox, Plus, Search, Settings, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { api } from "../lib/api";
import { CaptureDialog } from "./Capture";
import CommandPalette from "./CommandPalette";
import Notifications from "./Notifications";
import { cx } from "./ui";

// Cuatro sitios, siempre los mismos:
//   Jarvis   hablarle y ver tu día de un vistazo
//   Agenda   tu calendario (Google y propio)
//   Tareas   lo que tienes que hacer (también de GitHub y del correo)
//   Correo   lo de Gmail que requiere respuesta
// Tu memoria (el vault de Obsidian y los documentos) no se navega: se le pregunta a Jarvis.
type NavItem = { to: string; label: string; icon: typeof Sparkles; end?: boolean; match?: string[] };

const NAV: NavItem[] = [
  { to: "/", label: "Jarvis", icon: Sparkles, end: true, match: ["/hoy", "/documentos", "/notas", "/diario", "/proyectos", "/buscar"] },
  { to: "/calendario", label: "Agenda", icon: CalendarDays },
  { to: "/tareas", label: "Tareas", icon: CheckSquare },
  { to: "/bandeja", label: "Correo", icon: Inbox },
];

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full shadow-[0_0_18px_rgba(122,167,255,0.75)]"
      style={{ width: size * 0.62, height: size * 0.62, background: "radial-gradient(circle at 35% 30%, #eef3ff, #7aa7ff 40%, #8b5cf6 75%, #2b1d5c)" }}
    />
  );
}

function useActive(item: NavItem) {
  const { pathname } = useLocation();
  if (item.end) return pathname === item.to || !!item.match?.some((m) => pathname === m);
  return [item.to, ...(item.match ?? [])].some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

function Count({ n, className }: { n?: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cx("absolute min-w-4 rounded-full bg-cobalt px-1 text-center text-[0.62rem] leading-4 font-semibold text-paper tabular", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function RailLink({ item, badge }: { item: NavItem; badge?: number }) {
  const active = useActive(item);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[0.68rem] transition-colors",
        active ? "text-ink" : "text-faint hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-active"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="absolute inset-0 rounded-2xl bg-white/[0.06] shadow-[0_0_24px_-6px_rgba(122,167,255,0.55)] ring-1 ring-line"
        />
      )}
      <Icon size={21} strokeWidth={active ? 2.1 : 1.7} className={cx("relative transition-transform group-hover:scale-110", active && "text-cobalt")} />
      <span className="relative">{item.label}</span>
      <Count n={badge} className="top-1 right-3" />
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
      {active && (
        <motion.span
          layoutId="dock-active"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="absolute inset-x-1.5 inset-y-1 rounded-2xl bg-white/[0.07]"
        />
      )}
      <Icon size={21} strokeWidth={active ? 2.2 : 1.7} className={cx("relative", active && "text-cobalt")} />
      <span className="relative">{item.label}</span>
      <Count n={badge} className="top-0.5 left-[calc(50%+4px)]" />
    </NavLink>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState(false);
  const [capture, setCapture] = useState(false);
  const [bell, setBell] = useState(false);
  const unread = useQuery({ queryKey: ["unread"], queryFn: api.unread, refetchInterval: 60_000 });
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, refetchInterval: 2 * 60_000 });
  const attention = today.data?.inbox?.counts.attention ?? 0;
  const unreadCount = unread.data?.count ?? 0;

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

  const iconBtn = "relative flex size-10 items-center justify-center rounded-xl text-faint transition-colors hover:bg-white/[0.05] hover:text-ink";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[92px_minmax(0,1fr)]">
      <div className="aurora" aria-hidden />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>

      {/* Barra lateral (ordenador) */}
      <aside className="sticky top-0 hidden h-dvh flex-col items-center gap-2 px-2.5 py-5 lg:flex">
        <NavLink to="/" aria-label="Jarvis" className="mb-4 flex size-11 items-center justify-center">
          <BrandMark size={44} />
        </NavLink>
        <button
          type="button"
          onClick={() => setCapture(true)}
          className={cx(iconBtn, "mb-1 bg-white/[0.04] text-ink ring-1 ring-line")}
          aria-label="Apuntar algo (C)"
          title="Apuntar algo (C)"
        >
          <Plus size={19} />
        </button>
        <button type="button" onClick={() => setSearch(true)} className={iconBtn} aria-label="Buscar (⌘K)" title="Buscar (⌘K)">
          <Search size={18} />
        </button>
        <nav aria-label="Secciones" className="mt-4 flex w-full flex-col gap-1">
          {NAV.map((n) => (
            <RailLink key={n.to} item={n} badge={n.to === "/bandeja" ? attention : undefined} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setBell(true)}
            className={iconBtn}
            aria-label={unreadCount ? `Avisos, ${unreadCount} sin leer` : "Avisos"}
            title="Avisos"
          >
            <Bell size={18} />
            {unreadCount > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-ochre" />}
          </button>
          <NavLink
            to="/ajustes"
            className={({ isActive }) => cx(iconBtn, isActive && "text-ink")}
            aria-label="Ajustes y conexiones"
            title="Ajustes y conexiones"
          >
            <Settings size={18} />
          </NavLink>
        </div>
      </aside>

      {/* Arriba (móvil): solo lo imprescindible */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1 lg:hidden">
        <NavLink to="/" className="flex items-center gap-2 pl-1" aria-label="Jarvis">
          <BrandMark size={30} />
          <span className="font-display text-base font-semibold tracking-tight">Jarvis</span>
        </NavLink>
        <div className="glass flex items-center rounded-2xl">
          <button type="button" className={iconBtn} aria-label="Buscar" onClick={() => setSearch(true)}>
            <Search size={19} />
          </button>
          <button type="button" className={iconBtn} aria-label={unreadCount ? `Avisos, ${unreadCount} sin leer` : "Avisos"} onClick={() => setBell(true)}>
            <Bell size={19} />
            {unreadCount > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-ochre" />}
          </button>
          <NavLink to="/ajustes" className={iconBtn} aria-label="Ajustes y conexiones">
            <Settings size={19} />
          </NavLink>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-[1180px] min-w-0 px-4 pt-4 pb-32 sm:px-6 lg:px-10 lg:pt-10 lg:pb-14">
        {children}
      </main>

      {/* Dock (móvil) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <nav aria-label="Secciones" className="glass pointer-events-auto mx-auto flex max-w-sm items-stretch rounded-[1.6rem] px-1">
          {NAV.map((n) => (
            <DockLink key={n.to} item={n} badge={n.to === "/bandeja" ? attention : undefined} />
          ))}
        </nav>
      </div>

      <Notifications open={bell} onClose={() => setBell(false)} />
      <CommandPalette open={search} onClose={() => setSearch(false)} />
      <CaptureDialog open={capture} onClose={() => setCapture(false)} />
    </div>
  );
}
