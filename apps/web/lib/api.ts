const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api/v1";

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string; name: string; email_verified: boolean; created_at: string | null };
  org_id: string | null;
  tenant_id: string | null;
  role: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

const SESSION_KEY = "brightloop.session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  setSession(null);
}

async function refreshSession(): Promise<Session | null> {
  const session = getSession();
  if (!session?.refresh_token) return null;
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!response.ok) {
    clearSession();
    return null;
  }
  const refreshed = (await response.json()) as Session;
  setSession(refreshed);
  return refreshed;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { auth = true, retry = true, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (auth) {
    const session = getSession();
    if (session?.access_token) headers.set("authorization", `Bearer ${session.access_token}`);
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401 && auth && retry) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch<T>(path, { ...options, retry: false });
  }
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const body =
      typeof payload === "object" && payload
        ? (payload as ApiErrorBody)
        : { code: "INTERNAL_SERVER_ERROR", message: String(payload || response.statusText) };
    throw new ApiError(response.status, body);
  }
  return payload as T;
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export async function login(email: string, password: string): Promise<Session> {
  const session = await apiFetch<Session>("/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, password }),
  });
  setSession(session);
  return session;
}

export async function register(input: { email: string; password: string; name: string }) {
  return apiFetch<{ user: Session["user"]; verification_required: boolean; verification_token_hint?: string }>(
    "/auth/register",
    { method: "POST", auth: false, body: JSON.stringify(input) },
  );
}

export function logout() {
  clearSession();
}

export function money(minor: number, currency = "USD"): string {
  const value = (minor / 100).toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  });
  return value;
}

export function date(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function time(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function relative(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value).getTime();
  const diff = parsed - Date.now();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} d`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export function nextMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
