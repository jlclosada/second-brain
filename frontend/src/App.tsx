import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { Route, Routes } from "react-router-dom";

import Shell from "./components/Shell";
import { Loading } from "./components/ui";
import { api } from "./lib/api";
import LoginPage from "./pages/Login";
import TodayPage from "./pages/Today";

// Hoy carga al instante; el resto de secciones se descargan al abrirlas.
const AssistantPage = lazy(() => import("./pages/Assistant"));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const DocumentPage = lazy(() => import("./pages/DocumentDetail"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const JournalPage = lazy(() => import("./pages/Journal"));
const NotePage = lazy(() => import("./pages/NoteDetail"));
const NotesPage = lazy(() => import("./pages/Notes"));
const ProjectPage = lazy(() => import("./pages/ProjectDetail"));
const ProjectsPage = lazy(() => import("./pages/Projects"));
const SearchPage = lazy(() => import("./pages/Search"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const TasksPage = lazy(() => import("./pages/Tasks"));

export default function App() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, staleTime: 60_000 });

  useEffect(() => {
    const onLogout = () => {
      // Se olvida todo lo cargado salvo la propia sesión, que pasa a "sin usuario".
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      queryClient.setQueryData(["me"], null);
    };
    window.addEventListener("sb:logout", onLogout);
    return () => window.removeEventListener("sb:logout", onLogout);
  }, [queryClient]);

  if (me.isPending) return null;
  if (!me.data) return <LoginPage onLogin={() => me.refetch()} />;

  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/hoy" element={<TodayPage />} />
          <Route path="/calendario" element={<CalendarPage />} />
          <Route path="/tareas" element={<TasksPage />} />
          <Route path="/notas" element={<NotesPage />} />
          <Route path="/notas/:id" element={<NotePage />} />
          <Route path="/diario/:day?" element={<JournalPage />} />
          <Route path="/documentos" element={<DocumentsPage />} />
          <Route path="/documentos/:id" element={<DocumentPage />} />
          <Route path="/proyectos" element={<ProjectsPage />} />
          <Route path="/proyectos/:id" element={<ProjectPage />} />
          <Route path="/buscar" element={<SearchPage />} />
          <Route path="/asistente" element={<AssistantPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="*" element={<TodayPage />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
