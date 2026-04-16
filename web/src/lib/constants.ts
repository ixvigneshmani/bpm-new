// ─── Process Status ─────────────────────────────────────────────────
// Backend stores uppercase, UI displays title case

export const PROCESS_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PENDING: "PENDING",
  REVIEW: "REVIEW",
} as const;

export const STATUS_DISPLAY: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PENDING: "Pending",
  REVIEW: "Review",
};

export const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string; border: string; accent: string }> = {
  Draft: { bg: "#F2F4F7", text: "#475467", dot: "#98A2B3", border: "#D0D5DD", accent: "#98A2B3" },
  Active: { bg: "#ECFDF3", text: "#027A48", dot: "#12B76A", border: "#A6F4C5", accent: "#12B76A" },
  Pending: { bg: "#FFF6ED", text: "#B54708", dot: "#F79009", border: "#FEDF89", accent: "#F79009" },
  Review: { bg: "#EFF8FF", text: "#175CD3", dot: "#2E90FA", border: "#B2DDFF", accent: "#2E90FA" },
};

// ─── Wizard Step ────────────────────────────────────────────────────
// Backend stores uppercase, frontend store uses lowercase

export const WIZARD_STEP = {
  DETAILS: "DETAILS",
  DOCUMENT: "DOCUMENT",
  CANVAS: "CANVAS",
} as const;

export const STEP_MAP: Record<string, "details" | "document" | "canvas"> = {
  DETAILS: "details",
  DOCUMENT: "document",
  CANVAS: "canvas",
};

// ─── Document Source ────────────────────────────────────────────────

export const DOC_SOURCE_MAP: Record<string, "template" | "paste" | "empty"> = {
  TEMPLATE: "template",
  PASTE: "paste",
  EMPTY: "empty",
};

export const DOC_SOURCE_REVERSE: Record<string, string> = {
  template: "TEMPLATE",
  paste: "PASTE",
  empty: "EMPTY",
};
