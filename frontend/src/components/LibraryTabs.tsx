import { FileText, FolderKanban, NotebookPen, NotebookTabs } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cx } from "./ui";

// La biblioteca reúne lo que guardas para consultar: notas, diario, documentos y
// proyectos. Una sola entrada en el menú, con pestañas dentro.

export const LIBRARY_PATHS = ["/biblioteca", "/notas", "/diario", "/documentos", "/proyectos"];

const TABS = [
  { to: "/notas", label: "Notas", icon: NotebookPen },
  { to: "/diario", label: "Diario", icon: NotebookTabs },
  { to: "/documentos", label: "Documentos", icon: FileText },
  { to: "/proyectos", label: "Proyectos", icon: FolderKanban },
];

export default function LibraryTabs() {
  return (
    <nav aria-label="Biblioteca" className="scrollbar-none -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cx(
              "-mb-px flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[0.95rem] transition-colors",
              isActive ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
            )
          }
        >
          <Icon size={16} strokeWidth={1.9} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
