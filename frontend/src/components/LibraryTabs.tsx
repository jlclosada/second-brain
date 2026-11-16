import { ArrowLeft } from "lucide-react";

import { GoLink } from "../lib/nav";

// En el móvil, notas, diario y proyectos no están en la barra de abajo: se vuelve a Jarvis.
// En el ordenador ya están en la barra lateral.
export default function LibraryTabs() {
  return (
    <GoLink to="/" type="nav-back" className="mb-5 inline-flex items-center lg:hidden gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft size={15} /> Jarvis
    </GoLink>
  );
}
