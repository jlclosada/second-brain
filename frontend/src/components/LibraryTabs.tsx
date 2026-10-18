import { ArrowLeft } from "lucide-react";

import { GoLink } from "../lib/nav";

// Notas, diario y proyectos antiguos de la app: se vuelve a Jarvis.
export default function LibraryTabs() {
  return (
    <GoLink to="/" type="nav-back" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft size={15} /> Jarvis
    </GoLink>
  );
}
