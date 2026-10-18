import { useQuery } from "@tanstack/react-query";
import { Inbox as InboxIcon, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConnectGoogleCard, EmailRow, useInboxRefresh } from "../components/EmailParts";
import { Button, Empty, Loading, PageHeader, Segmented } from "../components/ui";
import { api, type InboxView } from "../lib/api";
import { ago } from "../lib/dates";
import { Page } from "../lib/nav";

const VIEWS: { value: InboxView; label: string; empty: string }[] = [
  { value: "attention", label: "Requiere atención", empty: "Nada pendiente de respuesta. Bandeja al día." },
  { value: "primary", label: "Principal", empty: "No hay correos en Principal." },
  { value: "other", label: "Notificaciones y promociones", empty: "Nada por aquí." },
  { value: "all", label: "Todo", empty: "La bandeja de entrada está vacía." },
];

export default function InboxPage() {
  const [view, setView] = useState<InboxView>("attention");
  const inbox = useQuery({ queryKey: ["inbox", view], queryFn: () => api.inbox(view), refetchInterval: 60_000 });
  const refresh = useInboxRefresh();

  const sync = async () => {
    await api.syncIntegration("google");
    toast("Sincronizando con Gmail…");
    setTimeout(refresh, 4000);
  };

  if (inbox.isPending) return <Loading />;
  if (inbox.isError) return <Empty title="No se pudo cargar la bandeja">{(inbox.error as Error).message}</Empty>;
  const d = inbox.data;

  if (!d.connected) {
    return (
      <Page>
        <PageHeader title="Bandeja" sub="Tu correo de Gmail, con lo que necesita respuesta primero." />
        <ConnectGoogleCard status="off" what="tu correo aquí" />
      </Page>
    );
  }

  const current = VIEWS.find((v) => v.value === view)!;
  return (
    <Page>
      <PageHeader
        title="Bandeja"
        sub={
          <>
            {d.account} · {d.synced_at ? `actualizada ${ago(d.synced_at)}` : "sincronizando…"}
            {d.error && <span className="text-clay"> · {d.error}</span>}
          </>
        }
      >
        <Button variant="ghost" onClick={sync} aria-label="Sincronizar ahora">
          <RefreshCw size={16} /> <span className="hidden sm:inline">Actualizar</span>
        </Button>
      </PageHeader>

      <div className="mb-4">
        <Segmented<InboxView>
          label="Qué correos ver"
          value={view}
          onChange={setView}
          options={VIEWS.map((v) => ({ value: v.value, label: d.counts[v.value] ? `${v.label} · ${d.counts[v.value]}` : v.label }))}
        />
      </div>
      <p className="mb-2 text-sm text-faint">
        Convierte en tarea lo que tengas que hacer y archiva el resto: se archiva también en Gmail. Se muestran los últimos 30 días.
      </p>

      {d.emails.length ? (
        <ul className="max-w-3xl divide-y divide-line">
          {d.emails.map((e) => (
            <EmailRow key={e.id} email={e} />
          ))}
        </ul>
      ) : (
        <Empty icon={<InboxIcon size={22} />} title={current.empty} />
      )}
    </Page>
  );
}
