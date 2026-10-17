import { FileText, LogOut, Search, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import { api } from "./api";
import DocumentPage from "./pages/DocumentPage";
import DocumentsPage from "./pages/DocumentsPage";
import LoginPage from "./pages/LoginPage";
import SearchPage from "./pages/SearchPage";
import UploadPage from "./pages/UploadPage";

const tabs = [
  { to: "/", label: "Buscar", icon: Search },
  { to: "/documentos", label: "Documentos", icon: FileText },
  { to: "/subir", label: "Subir", icon: Upload },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api.me().then(() => setAuthed(true), () => setAuthed(false));
    const onLogout = () => setAuthed(false);
    window.addEventListener("sb:logout", onLogout);
    return () => window.removeEventListener("sb:logout", onLogout);
  }, []);

  if (authed === null) return null;
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <span className="font-semibold">Segundo Cerebro</span>
        <nav className="hidden gap-1 sm:flex">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm ${isActive ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <button
          aria-label="Cerrar sesión"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          onClick={() => api.logout().finally(() => setAuthed(false))}
        >
          <LogOut size={18} />
        </button>
      </header>

      <main className="flex-1 px-4 pt-4 pb-24 sm:pb-8">
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/documentos" element={<DocumentsPage />} />
          <Route path="/documentos/:id" element={<DocumentPage />} />
          <Route path="/subir" element={<UploadPage />} />
          <Route path="*" element={<SearchPage />} />
        </Routes>
      </main>

      {/* Barra inferior para el móvil */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-slate-200 bg-white pt-2 sm:hidden dark:border-slate-800 dark:bg-slate-900">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 text-xs ${isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500"}`
            }
          >
            <t.icon size={22} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
