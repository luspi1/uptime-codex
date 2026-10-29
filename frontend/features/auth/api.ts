const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/$/, "");

export type AuthMode = "login" | "register";

export type User = {
  id: number;
  email: string;
  name: string;
  avatar_url?: string;
};

export type AuthResponse = {
  user: User;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type Credentials = {
  email: string;
  password: string;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: Credentials | { name: string } | MonitorInput | FormData;
  token?: string | null;
};

// Keep the access token in memory; reloads restore the session via the HttpOnly cookie.
let accessToken: string | null = null;
let refreshPromise: Promise<User> | null = null;

/** Preserves API status and code for UI decisions; status 0 also covers local response validation. */
export class AuthError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 0, code = "network_error") {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUser(value: unknown): User {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.email !== "string" || typeof value.name !== "string") {
    throw new AuthError("Сервер вернул некорректный ответ.", 0, "invalid_response");
  }
  if (value.avatar_url !== undefined && typeof value.avatar_url !== "string") {
    throw new AuthError("Сервер вернул некорректный ответ.", 0, "invalid_response");
  }
  return { id: value.id, email: value.email, name: value.name,
    ...(typeof value.avatar_url === "string" ? { avatar_url: value.avatar_url } : {}) };
}

/** Resolves a backend-relative avatar path against the API origin. */
export function avatarSource(path: string): string {
  return `${API_URL}${path}`;
}

async function request(path: string, { method = "GET", body, token }: RequestOptions = {}, prefix = "/api/auth"): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${prefix}${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      cache: "no-store",
    });
  } catch {
    throw new AuthError("Не удалось связаться с сервером.");
  }

  if (response.status === 204) return null;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AuthError("Сервер вернул некорректный ответ.", response.status, "invalid_response");
  }

  if (!response.ok) {
    const payload = isRecord(data) && isRecord(data.error) ? data.error : null;
    throw new AuthError(
      typeof payload?.message === "string" ? payload.message : "Не удалось выполнить запрос.",
      response.status,
      typeof payload?.code === "string" ? payload.code : "unknown_error",
    );
  }
  return data;
}

function parseAuthResponse(value: unknown): AuthResponse {
  if (
    !isRecord(value) ||
    typeof value.access_token !== "string" || !value.access_token ||
    value.token_type !== "Bearer" ||
    typeof value.expires_in !== "number"
  ) {
    throw new AuthError("Сервер вернул некорректный ответ.", 0, "invalid_response");
  }
  return {
    user: parseUser(value.user),
    access_token: value.access_token,
    token_type: "Bearer",
    expires_in: value.expires_in,
  };
}

function saveSession(data: unknown): User {
  const { user, access_token } = parseAuthResponse(data);
  accessToken = access_token;
  return user;
}

/** Starts a session and returns its user after validating and retaining the access token. */
export async function authenticate(mode: AuthMode, email: string, password: string): Promise<User> {
  const data = await request(mode === "register" ? "/register" : "/login", {
    method: "POST",
    body: { email, password },
  });
  return saveSession(data);
}

/** Restores the session using the refresh cookie; concurrent callers share one rotation. */
export function refreshSession(): Promise<User> {
  if (!refreshPromise) {
    // The server rotates refresh tokens, so parallel refreshes could reuse an invalidated cookie.
    refreshPromise = request("/refresh", { method: "POST" })
      .then(saveSession)
      .catch((error: unknown) => {
        if (error instanceof AuthError && error.status === 401) accessToken = null;
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Fetches the current profile, refreshing the session if the access token is missing or rejected. */
export async function getCurrentUser(): Promise<User> {
  return requestUser();
}

/** Saves the profile; with an avatar, an empty name is omitted to preserve the stored name. */
export async function updateProfile(name: string, avatar?: File): Promise<User> {
  if (avatar) {
    const body = new FormData();
    if (name) body.append("name", name);
    body.append("avatar", avatar);
    return requestUser({ method: "PATCH", body });
  }
  return requestUser({ method: "PATCH", body: { name } });
}

async function requestUser(options: RequestOptions = {}): Promise<User> {
  return parseUser(await authorizedRequest("/me", options, "/api/auth"));
}

async function authorizedRequest(path: string, options: RequestOptions = {}, prefix = "/api"): Promise<unknown> {
  if (!accessToken) await refreshSession();
  try {
    return await request(path, { ...options, token: accessToken }, prefix);
  } catch (error: unknown) {
    if (!(error instanceof AuthError) || error.status !== 401) throw error;
    await refreshSession();
    // Retry once so a second 401 reaches the UI instead of causing a refresh loop.
    return request(path, { ...options, token: accessToken }, prefix);
  }
}

export type MonitorInput = { url: string; interval_minutes: number };
export type Monitor = MonitorInput & { id: number; created_at: string };

function parseMonitor(value: unknown): Monitor {
  if (!isRecord(value) || typeof value.id !== "number" || !Number.isInteger(value.id) || value.id < 1 ||
    typeof value.url !== "string" || typeof value.interval_minutes !== "number" ||
    !Number.isInteger(value.interval_minutes) || value.interval_minutes < 1 || value.interval_minutes > 1440 ||
    typeof value.created_at !== "string") {
    throw new AuthError("Сервер вернул некорректный ответ.", 0, "invalid_response");
  }
  return { id: value.id, url: value.url, interval_minutes: value.interval_minutes, created_at: value.created_at };
}

/** Returns validated monitors for the current session, refreshing authorization if needed. */
export async function listMonitors(): Promise<Monitor[]> {
  const data = await authorizedRequest("/monitors");
  if (!Array.isArray(data)) throw new AuthError("Сервер вернул некорректный ответ.", 0, "invalid_response");
  return data.map(parseMonitor);
}

/** Creates a monitor for the current user; rejects API failures and invalid response data. */
export async function createMonitor(input: MonitorInput): Promise<Monitor> {
  return parseMonitor(await authorizedRequest("/monitors", { method: "POST", body: input }));
}

/** Revokes the refresh session before clearing local access; failures leave it available for retry. */
export async function endSession(): Promise<void> {
  await request("/logout", { method: "POST" });
  accessToken = null;
}
