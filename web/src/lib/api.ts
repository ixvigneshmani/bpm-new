const API_BASE = "/api";

/** Extra fields every apiX method accepts. `headers` gets spread into
 *  the request headers AFTER the default auth/content-type, so callers
 *  can add Idempotency-Key, X-Request-Id, etc. without losing auth.
 *  `signal` enables the abort-on-unmount pattern in React. */
export type ApiRequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

function getHeaders(
  withBody: boolean,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = localStorage.getItem("flowpro_token");
  return {
    ...(withBody ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem("flowpro_token");
      localStorage.removeItem("flowpro_user");
    }
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiGet<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: getHeaders(false, opts?.headers),
    signal: opts?.signal,
  });
  return handleResponse<T>(res);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: ApiRequestOptions,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: getHeaders(true, opts?.headers),
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  return handleResponse<T>(res);
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  opts?: ApiRequestOptions,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: getHeaders(true, opts?.headers),
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  opts?: ApiRequestOptions,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: getHeaders(true, opts?.headers),
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: getHeaders(false, opts?.headers),
    signal: opts?.signal,
  });
  return handleResponse<T>(res);
}
