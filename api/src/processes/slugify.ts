/* ─── Slug helpers (D1) ─────────────────────────────────────────────
 * Slugs are FlowPro's stable cross-environment identifier for a
 * process. UUIDs are env-local; slugs survive export/import.
 *
 * Format: lowercase, kebab-case, alphanumeric + single hyphens, no
 * leading/trailing hyphen, capped at 64 chars. Uniqueness is
 * tenant-scoped and enforced by the PROCESS_TENANT_SLUG_IDX
 * unique index in schema.ts.
 *
 * Collision rule: when slugify(name) collides with an existing slug
 * in the same tenant, append `-2`, `-3`, … until unique. The base
 * slug is truncated so the suffix fits within the 64-char cap.
 * ──────────────────────────────────────────────────────────────────── */

/** Convert an arbitrary string to a slug. NOT uniqueness-aware —
 *  callers must pair this with `findUniqueSlug` against the DB if
 *  they need a guaranteed-free slug. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  // Cap at 64 — matches PROCESSES.SLUG varchar length.
  return base.slice(0, 64) || "process";
}

/** Apply a numeric suffix to a base slug, respecting the 64-char
 *  cap. If the suffixed result would exceed the cap, the base is
 *  truncated to make room. */
export function appendSlugSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  if (base.length + suffix.length <= 64) return base + suffix;
  return base.slice(0, 64 - suffix.length) + suffix;
}

/** Regex used by API DTOs to validate operator-supplied slugs.
 *  Same shape as the slugify output. Exported so DTOs and the
 *  rename endpoint can share it. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
