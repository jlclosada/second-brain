import { useQuery } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useParams } from "react-router-dom";

import { NoteBody } from "../components/NoteEditor";
import { Button, cx, IconButton, Loading } from "../components/ui";
import { api } from "../lib/api";
import { capitalize, dayFromIso, fmt, isoDay } from "../lib/dates";
import { GoLink, Page, useGo } from "../lib/nav";

export default function JournalPage() {
  const { day: param } = useParams();
  const day = param ? dayFromIso(param) : new Date();
  const key = isoDay(day);
  const go = useGo();
  const entry = useQuery({ queryKey: ["note", "journal", key], queryFn: () => api.journal(key) });
  const past = useQuery({ queryKey: ["notes", "journal"], queryFn: () => api.notes({ journal: true }) });
  const isToday = key === isoDay(new Date());

  return (
    <Page>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted">Diario</p>
          <h1 className="text-[2rem] leading-tight font-semibold sm:text-[2.4rem]">{capitalize(fmt(day, "EEEE d 'de' MMMM yyyy"))}</h1>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Día anterior" onClick={() => go(`/diario/${isoDay(addDays(day, -1))}`, "nav-back")}>
            <ChevronLeft size={20} />
          </IconButton>
          {!isToday && (
            <Button size="sm" variant="ghost" onClick={() => go("/diario", "nav-forward")}>
              Hoy
            </Button>
          )}
          <IconButton
            label="Día siguiente"
            onClick={() => go(`/diario/${isoDay(addDays(day, 1))}`, "nav-forward")}
            disabled={isToday}
            className="disabled:opacity-30"
          >
            <ChevronRight size={20} />
          </IconButton>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          {entry.data ? (
            <NoteBody key={entry.data.id} note={entry.data} placeholder="¿Qué ha pasado hoy? ¿Cómo te sientes? ¿Qué has aprendido?" />
          ) : (
            <Loading />
          )}
        </div>
        <aside>
          <h2 className="mb-2 text-sm font-semibold text-muted">Entradas anteriores</h2>
          <ul className="flex flex-col">
            {past.data
              ?.filter((n) => n.body.trim())
              .slice(0, 30)
              .map((n) => (
                <li key={n.id}>
                  <GoLink
                    to={`/diario/${n.journal_date}`}
                    type={n.journal_date! < key ? "nav-back" : "nav-forward"}
                    className={cx("block rounded-md px-2 py-1.5 hover:bg-sunken", n.journal_date === key && "bg-sunken font-medium")}
                  >
                    <span className="block text-sm">{capitalize(fmt(dayFromIso(n.journal_date!), "EEEE d MMM"))}</span>
                    <span className="block truncate text-xs text-muted">{n.excerpt}</span>
                  </GoLink>
                </li>
              ))}
          </ul>
        </aside>
      </div>
    </Page>
  );
}
