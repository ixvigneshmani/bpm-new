const API_BASE = "/api";

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
  const token = localStorage.getItem("flowpro_token");
  // Act-as impersonation (Feature D): every API call during an Act-as
  // session carries X-Acting-For. `actingForOverride` takes precedence
  // so form dialogs can freeze the target at open-time and avoid the
  // mid-submit switch bug.
  let actingFor: string | null = null;
  if (actingForOverride === null) {
    // Explicitly disabled for this call.
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
    headers: getHeaders(false, opts?.headers, opts?.actingForOverride),
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
    headers: getHeaders(true, opts?.headers, opts?.actingForOverride),
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
    headers: getHeaders(true, opts?.headers, opts?.actingForOverride),
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
    headers: getHeaders(true, opts?.headers, opts?.actingForOverride),
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: getHeaders(false, opts?.headers, opts?.actingForOverride),
    signal: opts?.signal,
  });
  return handleResponse<T>(res);
}
