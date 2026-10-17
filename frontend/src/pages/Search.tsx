import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, FileText, NotebookPen, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Empty, Loading, PageHeader, Segmented } from "../components/ui";
import { api, itemPath, type Kind } from "../lib/api";
import { GoLink, Page } from "../lib/nav";

const KIND = {
  document: { label: "Documento", icon: FileText },
  note: { label: "Nota", icon: NotebookPen },
  task: { label: "Tarea", icon: CheckSquare },
  event: { label: "Evento", icon: CalendarDays },
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState<Kind | "all">("all");
  const q = useDeferredValue(text.trim());
  const results = useQuery({
    queryKey: ["search", q, kind],
    queryFn: () => api.search(q, kind === "all" ? {} : { kind }),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });

  return (
    <Page>
      <PageHeader title="Buscar" sub="Por palabras o por significado: «seguro del coche 2024», «ideas para el viaje»." />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(text ? { q: text } : {}, { replace: true });
        }}
        className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 focus-within:border-cobalt"
      >
        <Search size={19} className="text-faint" />
        <label htmlFor="q" className="sr-only">
          Buscar
        </label>
        <input
          id="q"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Seguro del coche 2024…"
          autoComplete="off"
          spellCheck={false}
          className="h-13 flex-1 bg-transparent text-lg placeholder:text-faint focus:outline-none"
        />
      </form>
      <div className="mb-6">
        <Segmented<Kind | "all">
          label="Tipo"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "Todo" },
            { value: "document", label: "Documentos" },
            { value: "note", label: "Notas" },
            { value: "task", label: "Tareas" },
            { value: "event", label: "Eventos" },
          ]}
        />
      </div>

      {!q ? (
        <p className="text-muted">Escribe para buscar en documentos, notas, tareas y eventos a la vez. Un año en la búsqueda filtra por ese año.</p>
      ) : results.isPending ? (
        <Loading label="Buscando" />
      ) : !results.data?.hits.length ? (
        <Empty title={`Nada para «${q}»`}>Prueba con otras palabras o pregunta al asistente.</Empty>
      ) : (
        <>
          {results.data.years.length > 0 && <p className="mb-3 text-sm text-muted">Filtrando por {results.data.years.join(", ")}.</p>}
          <ul>
            {results.data.hits.map((h) => {
              const k = KIND[h.item.kind];
              return (
                <li key={h.item.id} className="border-t border-line">
                  <GoLink to={itemPath(h.item.kind, h.item.id)} className="group flex gap-4 py-4">
                    <k.icon size={19} className="mt-0.5 shrink-0 text-faint" />
                    <div className="min-w-0">
                      <p className="font-medium group-hover:text-cobalt">{h.item.title}</p>
                      <p className="text-sm text-muted">
                        {k.label}
                        {h.item.category ? `, ${h.item.category}` : ""}
                        {h.item.year ? ` ${h.item.year}` : ""}
                        {h.matched_by.length === 1 && h.matched_by[0] === "significado" ? ", por significado" : ""}
                      </p>
                      {/* El servidor escapa el texto y solo deja las marcas <mark>. */}
                      {h.snippet && <p className="mt-1 line-clamp-3 text-[0.95rem]" dangerouslySetInnerHTML={{ __html: h.snippet }} />}
                    </div>
                  </GoLink>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Page>
  );
}
