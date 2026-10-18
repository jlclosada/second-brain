import { ArrowLeft } from "lucide-react";

import { GoLink } from "../lib/nav";

// Notas, diario y proyectos de la app viven ahora dentro de Memoria (junto al vault).
export default function LibraryTabs() {
  return (
    <GoLink to="/memoria" type="nav-back" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft size={15} /> Memoria
    </GoLink>
  );
}
