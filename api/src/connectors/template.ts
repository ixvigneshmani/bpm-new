/* ─── ${var} template interpolation ──────────────────────────────────
 * Shared by every connector operation that wants to consume canvas-
 * authored inputs with variable substitution. Mirrors the I2 REST
 * handler's existing behaviour exactly — one level of dotted access,
 * missing variables resolve to empty string. Strict-mode validation
 * (which placeholders are reachable) lives in the canvas validator at
 * design time; runtime here is intentionally lenient.
 *
 * Why a separate file: previously the same logic was inlined in the
 * REST handler and again in NotifyEmailHandler. Three more connectors
 * would mean three more copies. One helper, one bug surface.
 * ──────────────────────────────────────────────────────────────────── */

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

/** Replace `${path}` placeholders in `template` with values from
 *  `variables`, supporting one level of dotted access (`user.email`).
 *  Missing keys → empty string. Returns the template unchanged when
 *  no placeholders are present (fast path). */
export function interpolate(
  template: string,
  variables: Record<string, unknown>,
): string {
  if (!template.includes("${")) return template;
  return template.replace(PLACEHOLDER_RE, (_, expr) => {
    const path = String(expr).trim();
    if (!path) return "";
    const parts = path.split(".");
    let cur: unknown = variables;
    for (const p of parts) {
      if (
        cur != null &&
        typeof cur === "object" &&
        Object.prototype.hasOwnProperty.call(cur, p)
      ) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return cur == null ? "" : String(cur);
  });
}

/** Walk an arbitrary input object and interpolate every string value
 *  in-place (returning a new object — original is not mutated).
 *  Recurses into nested plain objects and arrays. Non-string values
 *  pass through unchanged. */
export function interpolateDeep<T>(value: T, variables: Record<string, unknown>): T {
  if (typeof value === "string") {
    return interpolate(value, variables) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateDeep(v, variables)) as unknown as T;
  }
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, variables);
    }
    return out as unknown as T;
  }
  return value;
}
