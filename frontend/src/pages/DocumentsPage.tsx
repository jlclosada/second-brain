import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, type Item, type Stats } from "../api";
import ItemCard, { Chip } from "../components/ItemCard";

export default function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get("categoria") ?? undefined;
  const year = params.get("anio") ? Number(params.get("anio")) : undefined;
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.stats().then(setStats, () => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.list({ category, year }).then((r) => {
      if (cancelled) return;
      setItems(r.items);
      setTotal(r.total);
    });
    return () => {
      cancelled = true;
    };
  }, [category, year, tick]);

  // Mientras haya documentos procesándose, refresca cada pocos segundos.
  const processing = items.some((i) => i.status === "pending" || i.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setTimeout(() => setTick((t) => t + 1), 3000);
    return () => clearTimeout(timer);
  }, [processing, tick]);

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value && next.get(key) !== value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={!category} onClick={() => set("categoria")}>
          Todas
        </Chip>
        {stats?.categories.map((c) => (
          <Chip key={c.value} active={category === c.value} onClick={() => set("categoria", c.value)}>
            {c.value}
          </Chip>
        ))}
      </div>
      {stats && stats.years.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {stats.years.map((y) => (
            <Chip key={y.value} active={year === Number(y.value)} onClick={() => set("anio", y.value)}>
              {y.value}
            </Chip>
          ))}
        </div>
      )}
      <p className="text-sm text-slate-500">{total} documentos</p>
      <div className="space-y-2">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
