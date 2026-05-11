const API_BASE = "/api";

const TOKEN_KEY = "flowpro_token";
const REFRESH_KEY = "flowpro_refresh";
const USER_KEY = "flowpro_user";

/** Extra fields every apiX method accepts. `headers` gets spread into
 *  the request headers AFTER the default auth/content-type, so callers
 *  can add Idempotency-Key, X-Request-Id, etc. without losing auth.
 *  `signal` enables the abort-on-unmount pattern in React.
 *
 *  `actingForOverride` freezes the X-Acting-For value for this call.
 *  Dialogs that submit state-changing requests should snapshot the
 *  current impersonation target on open (via `useActingForSnapshot`)
 *  and pass it here — otherwise a mid-submit switch would silently
 *  rewrite audit attribution (reviewer flagged as a real bug in D).
 *  - `undefined`  → default: read live localStorage value (legacy).
 *  - `null`       → force no impersonation for this call.
 *  - `"<uuid>"`   → use this exact target regardless of localStorage. */
export type ApiRequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  actingForOverride?: string | null;
};

function getHeaders(
  withBody: boolean,
  extra?: Record<string, string>,
  actingForOverride?: string | null,
): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  // Act-as impersonation (Feature D): every API call during an Act-as
  // session carries X-Acting-For. `actingForOverride` takes precedence
  // so form dialogs can freeze the target at open-time and avoid the
  // mid-submit switch bug.
  let actingFor: string | null = null;
  if (actingForOverride === null) {
    actingFor = null;
  } else if (typeof actingForOverride === "string") {
    actingFor = actingForOverride;
  } else {
    try {
      const raw = localStorage.getItem("flowpro_acting_for");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.userId) actingFor = parsed.userId;
      }
    } catch {
      localStorage.removeItem("flowpro_acting_for");
    }
  }
  return {
    ...(withBody ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(actingFor ? { "X-Acting-For": actingFor } : {}),
    ...(extra ?? {}),
  };
}

/** Single-flight refresh: if two concurrent 401s race, both await the
 *  same in-flight refresh call so we don't double-rotate and trip the
 *  server's theft-detection. */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(REFRESH_KEY, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function clearAllAndRedirect() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  // Force a hard navigation so React tree resets fully — softer routing
  // can race with in-flight requests that still hold the old user.
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

async function handleResponse<T>(
  res: Response,
  retry: () => Promise<Response>,
  retried: boolean,
): Promise<T> {
  if (res.status === 401 && !retried) {
    const ok = await tryRefresh();
    if (ok) {
      const retryRes = await retry();
      return handleResponse<T>(retryRes, retry, true);
    }
    clearAllAndRedirect();
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function makeFetch(
  url: string,
  method: string,
  body: unknown,
  opts: ApiRequestOptions | undefined,
  withBody: boolean,
): () => Promise<Response> {
  return () =>
    fetch(url, {
      method,
      headers: getHeaders(withBody, opts?.headers, opts?.actingForOverride),
      body: withBody ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
    });
}

export async function apiGet<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
  const url = `${API_BASE}${path}`;
  const exec = makeFetch(url, "GET", null, opts, false);
  return handleResponse<T>(await exec(), exec, false);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: ApiRequestOptions,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const exec = makeFetch(url, "POST", body, opts, true);
  return handleResponse<T>(await exec(), exec, false);
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  opts?: ApiRequestOptions,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const exec = makeFetch(url, "PUT", body, opts, true);
  return handleResponse<T>(await exec(), exec, false);
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  opts?: ApiRequestOptions,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const exec = makeFetch(url, "PATCH", body, opts, true);
  return handleResponse<T>(await exec(), exec, false);
}

export async function apiDelete<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
  const url = `${API_BASE}${path}`;
  const exec = makeFetch(url, "DELETE", null, opts, false);
  return handleResponse<T>(await exec(), exec, false);
}
