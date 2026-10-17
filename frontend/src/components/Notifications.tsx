import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useEffect } from "react";

import { api } from "../lib/api";
import { ago } from "../lib/dates";
import { GoLink } from "../lib/nav";
import { cx, Empty, Loading, Sheet } from "./ui";

export default function Notifications({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, enabled: open });

  useEffect(() => {
    if (!open) return;
    // Al abrir el panel se dan por leídos.
    const t = setTimeout(() => api.markRead().then(() => queryClient.invalidateQueries({ queryKey: ["unread"] })), 1200);
    return () => clearTimeout(t);
  }, [open, queryClient]);

  return (
    <Sheet open={open} onClose={onClose} title="Avisos">
      {list.isPending ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty icon={<Bell size={20} />} title="Sin avisos todavía">
          Aquí aparecerán tus recordatorios, eventos próximos, vencimientos y el resumen de cada mañana.
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((n) => {
            const body = (
              <div className="flex gap-3 py-3">
                <span className={cx("mt-2 size-2 shrink-0 rounded-full", n.read_at ? "bg-line" : "bg-ochre")} />
                <div className="min-w-0">
                  <p className="font-medium">{n.title}</p>
                  {n.body && <p className="text-sm text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-faint">{ago(n.created_at)}</p>
                </div>
              </div>
            );
            return (
              <li key={n.id}>
                {n.url ? (
                  <GoLink to={n.url} onClick={onClose} className="block rounded-lg hover:bg-sunken">
                    {body}
                  </GoLink>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
