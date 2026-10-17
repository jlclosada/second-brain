// Cliente de la API. Todas las peticiones que cambian datos llevan la cabecera
// X-Requested-With: el servidor la exige como protección contra CSRF.

export type Kind = "document" | "note" | "task" | "event";

export type DocumentFile = { filename: string; mime: string; size: number; pages: number | null; ocr_used: boolean };

export type Item = {
  id: string;
  kind: Kind;
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
  pinned: boolean;
  project_id: string | null;
  created_at: string;
  document: DocumentFile | null;
};

export type ItemDetail = Item & {
  entities: { list?: { type: string; name: string; role?: string }[] };
  text: string | null;
};

export type LinkRef = { id: string; kind: Kind; title: string };

export type Note = {
  id: string;
  title: string;
  body: string;
  excerpt: string;
  tags: string[];
  pinned: boolean;
  project_id: string | null;
  journal_date: string | null;
  created_at: string;
  updated_at: string;
};
export type NoteDetail = Note & { links: LinkRef[]; backlinks: LinkRef[] };

export type Task = {
  id: string;
  title: string;
  notes: string;
  due_date: string | null;
  due_time: string | null;
  priority: number;
  done_at: string | null;
  rrule: string | null;
  remind: boolean;
  tags: string[];
  project_id: string | null;
  sort: number;
  created_at: string;
};

export type CalendarSource = {
  id: string;
  name: string;
  color: Color;
  source: "local" | "ics";
  enabled: boolean;
  last_synced_at: string | null;
  sync_error: string | null;
  events: number;
};

export type CalEvent = {
  id: string;
  title: string;
  calendar_id: string;
  color: Color;
  source: "local" | "ics";
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  rrule: string | null;
  remind_minutes: number | null;
  tags: string[];
  project_id: string | null;
  recurring: boolean;
};

export type Reminder = {
  id: string;
  title: string;
  remind_at: string;
  sent_at: string | null;
  dismissed_at: string | null;
  item_id: string | null;
};

export type Project = {
  id: string;
  name: string;
  kind: "project" | "area";
  color: Color;
  description: string | null;
  archived_at: string | null;
  open_tasks: number;
  notes: number;
  documents: number;
};

export type Color = "cobalt" | "ochre" | "moss" | "clay" | "plum" | "slate" | "teal" | "rose";
export const COLORS: Color[] = ["cobalt", "ochre", "moss", "clay", "plum", "teal", "rose", "slate"];

export type ExpiringDoc = { id: string; title: string; category: string | null; expires_on: string; days_left: number };

export type Today = {
  date: string;
  timezone: string;
  events: CalEvent[];
  overdue: Task[];
  due_today: Task[];
  reminders: Reminder[];
  expiring: ExpiringDoc[];
  journal: Note | null;
  pinned_notes: Note[];
  recent: LinkRef[];
  counts: Record<string, number>;
};

export type CaptureResult = {
  kind: "task" | "event" | "note" | "reminder";
  title: string;
  due_date: string | null;
  due_time: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  remind_at: string | null;
  body: string | null;
  tags: string[];
  priority: number;
  parsed_by: "claude" | "reglas";
  created_id: string | null;
};

export type SearchHit = { item: Item; score: number; snippet: string; matched_by: string[] };
export type SearchResponse = { query: string; text: string; years: number[]; hits: SearchHit[] };
export type Facet = { value: string; count: number };
export type Stats = { total: number; pending: number; errors: number; categories: Facet[]; years: Facet[]; expiring: Item[] };

export type Me = {
  user: string;
  totp_enabled: boolean;
  ai_enabled: boolean;
  timezone: string;
  session_id: string;
  prefs: { default_event_reminder: number; briefing_hour: number; expiry_warning_days: number[] };
};
export type SessionInfo = { id: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null; current: boolean };
export type AuditEntry = { at: string; action: string; ip: string | null; detail: Record<string, unknown> };
export type AppNotification = { id: string; kind: string; title: string; body: string | null; url: string | null; created_at: string; read_at: string | null };

export type ChatAction = { tool: string; summary: string; link: string | null };
export type ChatMessage = { role: "user" | "assistant"; text: string; actions: ChatAction[] };
export type Conversation = { id: string; title: string; updated_at: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const CSRF = { "X-Requested-With": "segundo-cerebro" };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET") headers.set("X-Requested-With", CSRF["X-Requested-With"]);
  const res = await fetch(path, { credentials: "same-origin", ...init, headers });
  if (res.status === 401 && !path.startsWith("/api/auth/login") && path !== "/api/auth/me") {
    window.dispatchEvent(new Event("sb:logout"));
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) message = String(body.detail[0].msg).replace(/^Value error, /, "");
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // Acceso y seguridad
  login: (password: string, totp?: string) => request("/api/auth/login", send("POST", { password, totp })),
  logout: () => request("/api/auth/logout", send("POST")),
  me: () => request<Me>("/api/auth/me"),
  prefs: (body: Partial<Me["prefs"]>) => request<Me>("/api/auth/prefs", send("PATCH", body)),
  changePassword: (current: string, next: string) => request("/api/auth/password", send("POST", { current, new: next })),
  totpSetup: () => request<{ secret: string; uri: string; qr_svg: string }>("/api/auth/totp/setup", send("POST")),
  totpEnable: (code: string) => request("/api/auth/totp/enable", send("POST", { code })),
  totpDisable: (code: string, password: string) => request("/api/auth/totp/disable", send("POST", { code, password })),
  sessions: () => request<SessionInfo[]>("/api/auth/sessions"),
  revokeSession: (id: string) => request<void>(`/api/auth/sessions/${id}`, send("DELETE")),
  audit: () => request<AuditEntry[]>("/api/auth/audit"),

  // Hoy y captura
  today: () => request<Today>("/api/today"),
  capture: (text: string, commit = true) => request<CaptureResult>("/api/capture", send("POST", { text, commit })),

  // Tareas
  tasks: (params: { view?: string; project_id?: string; tag?: string }) => request<Task[]>(`/api/tasks${qs(params)}`),
  createTask: (body: Partial<Task> & { title: string }) => request<Task>("/api/tasks", send("POST", body)),
  updateTask: (id: string, body: Partial<Task> & { done?: boolean }) => request<Task>(`/api/tasks/${id}`, send("PATCH", body)),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, send("DELETE")),

  // Notas y diario
  notes: (params: { tag?: string; project_id?: string; journal?: boolean } = {}) => request<Note[]>(`/api/notes${qs(params)}`),
  note: (id: string) => request<NoteDetail>(`/api/notes/${id}`),
  createNote: (body: Partial<Note>) => request<NoteDetail>("/api/notes", send("POST", body)),
  updateNote: (id: string, body: Partial<Note>) => request<NoteDetail>(`/api/notes/${id}`, send("PATCH", body)),
  deleteNote: (id: string) => request<void>(`/api/notes/${id}`, send("DELETE")),
  journal: (day: string) => request<NoteDetail>(`/api/journal/${day}`),
  titles: (q: string) => request<LinkRef[]>(`/api/titles${qs({ q })}`),

  // Calendario
  calendars: () => request<CalendarSource[]>("/api/calendars"),
  addCalendar: (body: { name: string; color: Color; url?: string }) => request<CalendarSource>("/api/calendars", send("POST", body)),
  updateCalendar: (id: string, body: Partial<CalendarSource>) => request<CalendarSource>(`/api/calendars/${id}`, send("PATCH", body)),
  syncCalendar: (id: string) => request<CalendarSource>(`/api/calendars/${id}/sync`, send("POST")),
  deleteCalendar: (id: string) => request<void>(`/api/calendars/${id}`, send("DELETE")),
  events: (start: string, end: string) => request<CalEvent[]>(`/api/events${qs({ start, end })}`),
  event: (id: string) => request<CalEvent>(`/api/events/${id}`),
  createEvent: (body: Partial<CalEvent> & { title: string; starts_at: string }) => request<CalEvent>("/api/events", send("POST", body)),
  updateEvent: (id: string, body: Partial<CalEvent>) => request<CalEvent>(`/api/events/${id}`, send("PATCH", body)),
  deleteEvent: (id: string) => request<void>(`/api/events/${id}`, send("DELETE")),
  feed: () => request<{ url_path: string }>("/api/calendar/feed"),
  rotateFeed: () => request<{ url_path: string }>("/api/calendar/feed/rotate", send("POST")),

  // Recordatorios
  reminders: () => request<Reminder[]>("/api/reminders"),
  createReminder: (body: { title: string; remind_at: string; item_id?: string }) => request<Reminder>("/api/reminders", send("POST", body)),
  updateReminder: (id: string, body: { title?: string; remind_at?: string; dismissed?: boolean }) =>
    request<Reminder>(`/api/reminders/${id}`, send("PATCH", body)),
  deleteReminder: (id: string) => request<void>(`/api/reminders/${id}`, send("DELETE")),

  // Proyectos
  projects: (archived = false) => request<Project[]>(`/api/projects${qs({ archived })}`),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (body: { name: string; kind: Project["kind"]; color: Color; description?: string }) => request<Project>("/api/projects", send("POST", body)),
  updateProject: (id: string, body: Partial<Project> & { archived?: boolean }) => request<Project>(`/api/projects/${id}`, send("PATCH", body)),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, send("DELETE")),

  // Documentos
  stats: () => request<Stats>("/api/stats"),
  categories: () => request<string[]>("/api/categories"),
  documents: (params: { category?: string; year?: number; status?: string; project_id?: string; offset?: number }) =>
    request<{ items: Item[]; total: number }>(`/api/documents${qs({ limit: 60, ...params })}`),
  document: (id: string) => request<ItemDetail>(`/api/documents/${id}`),
  updateDocument: (id: string, body: Partial<Item>) => request<Item>(`/api/documents/${id}`, send("PATCH", body)),
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, send("DELETE")),
  reprocess: (id: string) => request<Item>(`/api/documents/${id}/reprocess`, send("POST")),
  fileUrl: (id: string, download = false) => `/api/documents/${id}/file${download ? "?download=true" : ""}`,
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<{ created: Item[]; duplicates: string[] }>("/api/documents", { method: "POST", body: form });
  },

  // Búsqueda
  search: (q: string, params: { kind?: Kind; category?: string } = {}) => request<SearchResponse>(`/api/search${qs({ q, ...params })}`),

  // Avisos
  notifications: () => request<AppNotification[]>("/api/notifications"),
  unread: () => request<{ count: number }>("/api/notifications/unread"),
  markRead: () => request<void>("/api/notifications/read", send("POST")),
  pushKey: () => request<{ key: string }>("/api/push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<void>("/api/push/subscribe", send("POST", sub)),
  pushUnsubscribe: (sub: PushSubscriptionJSON) => request<void>("/api/push/unsubscribe", send("POST", sub)),
  pushTest: () => request<{ subscriptions: number }>("/api/push/test", send("POST")),

  // Asistente
  chat: (message: string, conversation_id?: string) =>
    request<{ conversation_id: string; reply: ChatMessage }>("/api/assistant/chat", send("POST", { message, conversation_id })),
  conversations: () => request<Conversation[]>("/api/assistant/conversations"),
  conversation: (id: string) => request<Conversation & { messages: ChatMessage[] }>(`/api/assistant/conversations/${id}`),
  deleteConversation: (id: string) => request<void>(`/api/assistant/conversations/${id}`, send("DELETE")),
};

export function itemPath(kind: Kind, id: string) {
  switch (kind) {
    case "document":
      return `/documentos/${id}`;
    case "note":
      return `/notas/${id}`;
    case "task":
      return `/tareas?t=${id}`;
    case "event":
      return `/calendario?evento=${id}`;
  }
}
