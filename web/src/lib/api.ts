const API_BASE = "/api";

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = localStorage.getItem("flowpro_token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = localStorage.getItem("flowpro_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem("flowpro_token");
      localStorage.removeItem("flowpro_user");
      window.location.href = "/login";
    }
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  return res.json();
}
