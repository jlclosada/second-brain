export type DocumentFile = {
  filename: string;
  mime: string;
  size: number;
  pages: number | null;
  ocr_used: boolean;
};

export type Item = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  category: string | null;
  doc_type: string | null;
  doc_date: string | null;
  expires_on: string | null;
  year: number | null;
  tags: string[];
  status: "pending" | "processing" | "ready" | "error";
  error: string | null;
  created_at: string;
  document: DocumentFile | null;
};

export type ItemDetail = Item & { entities: { list?: { type: string; name: string; role?: string }[] }; text: string | null };

export type SearchHit = { item: Item; score: number; snippet: string; matched_by: string[] };
export type SearchResponse = { query: string; text: string; years: number[]; hits: SearchHit[] };
export type AskResponse = { answer: string; sources: { n: number; item_id: string; title: string; category: string | null; year: number | null }[] };
export type Facet = { value: string; count: number };
export type Stats = { total: number; pending: number; errors: number; categories: Facet[]; years: Facet[]; expiring: Item[] };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    window.dispatchEvent(new Event("sb:logout"));
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = typeof body.detail === "string" ? body.detail : message;
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
};

export const api = {
  login: (password: string) => request("/api/auth/login", json("POST", { password })),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: string }>("/api/auth/me"),
  stats: () => request<Stats>("/api/stats"),
  categories: () => request<string[]>("/api/categories"),
  list: (params: { category?: string; year?: number; status?: string; offset?: number }) =>
    request<{ items: Item[]; total: number }>(`/api/documents?${qs({ limit: 50, ...params })}`),
  get: (id: string) => request<ItemDetail>(`/api/documents/${id}`),
  update: (id: string, body: Partial<Item>) => request<Item>(`/api/documents/${id}`, json("PATCH", body)),
  remove: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  reprocess: (id: string) => request<Item>(`/api/documents/${id}/reprocess`, { method: "POST" }),
  fileUrl: (id: string, download = false) => `/api/documents/${id}/file${download ? "?download=true" : ""}`,
  search: (q: string, category?: string) => request<SearchResponse>(`/api/search?${qs({ q, category })}`),
  ask: (question: string) => request<AskResponse>("/api/ask", json("POST", { question })),
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<{ created: Item[]; duplicates: string[] }>("/api/documents", { method: "POST", body: form });
  },
};
