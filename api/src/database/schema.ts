import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────

export const tenantPlanEnum = pgEnum("TENANT_PLAN", [
  "free",
  "pro",
  "enterprise",
]);

export const userRoleEnum = pgEnum("USER_ROLE", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const authProviderEnum = pgEnum("AUTH_PROVIDER", [
  "credentials",
  "google",
  "microsoft",
  "saml",
]);

export const sessionStatusEnum = pgEnum("SESSION_STATUS", [
  "active",
  "expired",
  "revoked",
]);

// ─── TENANTS ─────────────────────────────────────────────────────────

export const tenants = pgTable("TENANTS", {
  id: uuid("ID").primaryKey().defaultRandom(),
  name: varchar("NAME", { length: 255 }).notNull(),
  slug: varchar("SLUG", { length: 100 }).notNull().unique(),
  plan: tenantPlanEnum("PLAN").notNull().default("free"),
  logoUrl: text("LOGO_URL"),
  domain: varchar("DOMAIN", { length: 255 }),
  settings: jsonb("SETTINGS"),
  createdAt: timestamp("CREATED_AT", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── WORKSPACES ──────────────────────────────────────────────────────

export const workspaces = pgTable(
  "WORKSPACES",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("NAME", { length: 255 }).notNull(),
    slug: varchar("SLUG", { length: 100 }).notNull(),
    description: text("DESCRIPTION"),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("WS_TENANT_SLUG_IDX").on(t.tenantId, t.slug)],
);

// ─── USERS ───────────────────────────────────────────────────────────

export const users = pgTable(
  "USERS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: varchar("EMAIL", { length: 320 }).notNull(),
    displayName: varchar("DISPLAY_NAME", { length: 255 }).notNull(),
    avatarUrl: text("AVATAR_URL"),
    passwordHash: text("PASSWORD_HASH"),
    role: userRoleEnum("ROLE").notNull().default("member"),
    locale: varchar("LOCALE", { length: 10 }).default("en"),
    isActive: boolean("IS_ACTIVE").notNull().default(true),
    mfaEnabled: boolean("MFA_ENABLED").notNull().default(false),
    mfaSecret: varchar("MFA_SECRET", { length: 64 }),
    emailVerifiedAt: timestamp("EMAIL_VERIFIED_AT", { withTimezone: true }),
    lastLoginAt: timestamp("LAST_LOGIN_AT", { withTimezone: true }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("USER_TENANT_EMAIL_IDX").on(t.tenantId, t.email),
    index("USER_TENANT_IDX").on(t.tenantId),
  ],
);

// ─── AUTH_ACCOUNTS (SSO) ─────────────────────────────────────────────

export const authAccounts = pgTable(
  "AUTH_ACCOUNTS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    userId: uuid("USER_ID")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: authProviderEnum("PROVIDER").notNull(),
    providerAccountId: varchar("PROVIDER_ACCOUNT_ID", {
      length: 255,
    }).notNull(),
    accessToken: text("ACCESS_TOKEN"),
    refreshToken: text("REFRESH_TOKEN"),
    tokenExpiresAt: timestamp("TOKEN_EXPIRES_AT", { withTimezone: true }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("AUTH_PROVIDER_ACCOUNT_IDX").on(
      t.provider,
      t.providerAccountId,
    ),
    index("AUTH_USER_IDX").on(t.userId),
  ],
);

// ─── SESSIONS ────────────────────────────────────────────────────────

export const sessions = pgTable(
  "SESSIONS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    userId: uuid("USER_ID")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tokenHash: varchar("TOKEN_HASH", { length: 128 }).notNull().unique(),
    status: sessionStatusEnum("STATUS").notNull().default("active"),
    ipAddress: varchar("IP_ADDRESS", { length: 45 }),
    userAgent: text("USER_AGENT"),
    expiresAt: timestamp("EXPIRES_AT", { withTimezone: true }).notNull(),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("SESSION_USER_IDX").on(t.userId),
    index("SESSION_TOKEN_IDX").on(t.tokenHash),
  ],
);

export const mfaRecoveryCodes = pgTable(
  "MFA_RECOVERY_CODES",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    userId: uuid("USER_ID")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: varchar("CODE_HASH", { length: 128 }).notNull(),
    usedAt: timestamp("USED_AT", { withTimezone: true }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("MFA_RECOVERY_USER_IDX").on(t.userId),
    uniqueIndex("MFA_RECOVERY_USER_HASH_IDX").on(t.userId, t.codeHash),
  ],
);

// ─── WORKSPACE_MEMBERS ──────────────────────────────────────────────

export const workspaceMembers = pgTable(
  "WORKSPACE_MEMBERS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    workspaceId: uuid("WORKSPACE_ID")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("USER_ID")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("ROLE").notNull().default("member"),
    joinedAt: timestamp("JOINED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("WS_MEMBER_IDX").on(t.workspaceId, t.userId)],
);

// ─── ROLES ──────────────────────────────────────────────────────────
// Domain roles (e.g. "manager", "employee", "finance") used for task
// routing and claim authorization. Distinct from USERS.role / USER_ROLE
// enum, which is the platform access level (owner/admin/member/viewer)
// and now lives on the JWT as `systemRole`. Roles are tenant-scoped:
// two tenants can independently define their own "manager".

export const roles = pgTable(
  "ROLES",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Stable identifier used in JWT claims and assignment expressions
     *  (e.g. `manager`). Immutable after creation by convention. */
    key: varchar("KEY", { length: 64 }).notNull(),
    label: varchar("LABEL", { length: 255 }).notNull(),
    description: text("DESCRIPTION"),
    /** System-seeded roles (manager/employee/finance on first run).
     *  Protects against accidental delete via the Roles API. */
    system: boolean("SYSTEM").notNull().default(false),
    /** EE2 — sort order for the Roles admin page. Nullable so existing
     *  rows don't need a backfill; the API treats null as "unordered,
     *  alphabetic fallback". Added as part of the EE2 migration smoke
     *  test (proves generate → migrate cycle works), but kept because
     *  the feature is genuinely useful for the Roles admin UI. */
    sortOrder: integer("SORT_ORDER"),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ROLE_TENANT_KEY_IDX").on(t.tenantId, t.key),
    index("ROLE_TENANT_IDX").on(t.tenantId),
  ],
);

// ─── USER_ROLES (junction) ──────────────────────────────────────────
// Many-to-many: a user can hold several roles (e.g. both manager and
// finance). tenantId denormalised on the row so the Roles API can
// enforce tenant scoping without a users/roles join on every query.

export const userRoles = pgTable(
  "USER_ROLES",
  {
    userId: uuid("USER_ID")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("ROLE_ID")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    assignedAt: timestamp("ASSIGNED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Who granted the role. Nullable because the granting user may be
     *  deleted later; the audit trail elsewhere keeps the full history. */
    assignedBy: uuid("ASSIGNED_BY").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("USER_ROLE_TENANT_ROLE_IDX").on(t.tenantId, t.roleId),
    index("USER_ROLE_USER_IDX").on(t.userId),
  ],
);

// ─── Process & Business Document Enums ──────────────────────────────

export const processStatusEnum = pgEnum("PROCESS_STATUS", [
  "DRAFT",
  "ACTIVE",
  "PENDING",
  "REVIEW",
]);

export const wizardStepEnum = pgEnum("WIZARD_STEP", [
  "DETAILS",
  "DOCUMENT",
  "CANVAS",
]);

export const docSourceEnum = pgEnum("DOC_SOURCE", [
  "TEMPLATE",
  "PASTE",
  "EMPTY",
]);

// ─── PROCESSES ──────────────────────────────────────────────────────

export const processes = pgTable(
  "PROCESSES",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("CREATED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("NAME", { length: 255 }).notNull(),
    description: text("DESCRIPTION"),
    canvasData: jsonb("CANVAS_DATA"),
    status: processStatusEnum("STATUS").notNull().default("DRAFT"),
    version: varchar("VERSION", { length: 20 }).default("v1.0"),
    step: wizardStepEnum("STEP").notNull().default("DETAILS"),
    /** D1 — stable cross-environment identifier. UUIDs are env-local;
     *  slugs survive export/import. Auto-generated on create from
     *  name (slugify + numeric suffix on collision). NOT NULL —
     *  every write goes through ProcessesService.create() which
     *  allocates a slug before insert, and the migration backfilled
     *  every existing row. */
    slug: varchar("SLUG", { length: 64 }).notNull(),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("PROCESS_TENANT_IDX").on(t.tenantId),
    uniqueIndex("PROCESS_TENANT_SLUG_IDX").on(t.tenantId, t.slug),
  ],
);

// ─── PROCESS_PERMISSIONS (OS1) ──────────────────────────────────────
// Per-process access grants. Layered on top of system roles
// (owner/admin still get full access without an explicit grant).
// Additive-only in v1 — absence of a grant means "fall back to the
// default policy" (view + start open to all tenant members; edit /
// publish / admin deny unless granted to owner/admin).
//
// Grantee can be a specific USER or a domain ROLE slug — matches the
// way assignments and task routing already work elsewhere in the app.
// PERMISSION is hierarchical: admin ⊃ publish ⊃ edit ⊃ view; `start`
// is orthogonal (you can be allowed to start without being allowed
// to edit).

export const processPermissionEnum = pgEnum("PROCESS_PERMISSION", [
  "view",
  "start",
  "edit",
  "publish",
  "admin",
]);

export const processGranteeTypeEnum = pgEnum("PROCESS_GRANTEE_TYPE", [
  "user",
  "role",
]);

export const processPermissions = pgTable(
  "PROCESS_PERMISSIONS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processId: uuid("PROCESS_ID")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    granteeType: processGranteeTypeEnum("GRANTEE_TYPE").notNull(),
    /** For `user` grants: the USERS.id (UUID stored as text).
     *  For `role`  grants: the ROLES.key slug (e.g. "manager"). */
    granteeId: varchar("GRANTEE_ID", { length: 128 }).notNull(),
    permission: processPermissionEnum("PERMISSION").notNull(),
    grantedBy: uuid("GRANTED_BY").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("GRANTED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("PROC_PERM_UNIQUE_IDX").on(
      t.tenantId,
      t.processId,
      t.granteeType,
      t.granteeId,
      t.permission,
    ),
    index("PROC_PERM_PROCESS_IDX").on(t.processId),
    index("PROC_PERM_GRANTEE_IDX").on(t.granteeType, t.granteeId),
  ],
);

// ─── PERMISSION_AUDIT_EVENTS (H1) ───────────────────────────────────
// Append-only history of every grant and revoke against
// PROCESS_PERMISSIONS. Compliance use case: "who gave X this access
// on date Y" — the answer must survive even after the grant has been
// revoked, so this can't live as soft-delete on PROCESS_PERMISSIONS.
//
// One row per action. PROCESSES.id is FK with onDelete=cascade so
// purging a process also purges its audit trail (acceptable: if the
// process is gone the questions are moot).

export const permissionAuditActionEnum = pgEnum("PERMISSION_AUDIT_ACTION", [
  "granted",
  "revoked",
]);

export const permissionAuditEvents = pgTable(
  "PERMISSION_AUDIT_EVENTS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processId: uuid("PROCESS_ID")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    action: permissionAuditActionEnum("ACTION").notNull(),
    granteeType: processGranteeTypeEnum("GRANTEE_TYPE").notNull(),
    granteeId: varchar("GRANTEE_ID", { length: 128 }).notNull(),
    permission: processPermissionEnum("PERMISSION").notNull(),
    /** Who performed the action. Nullable + onDelete:set null so the
     *  audit trail survives the actor's deletion. */
    actorUserId: uuid("ACTOR_USER_ID").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Correlation id of the HTTP request that produced the row.
     *  Pairs with the structured log line for full forensics. */
    correlationId: varchar("CORRELATION_ID", { length: 64 }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("PERM_AUDIT_PROCESS_CREATED_IDX").on(t.processId, t.createdAt.desc()),
    index("PERM_AUDIT_TENANT_CREATED_IDX").on(t.tenantId, t.createdAt.desc()),
    index("PERM_AUDIT_GRANTEE_IDX").on(t.granteeType, t.granteeId),
  ],
);

// ─── PROCESS_VERSIONS ───────────────────────────────────────────────
// Content-addressed snapshots of a process canvas. Replaces inlining
// the full DEFINITION_SNAPSHOT into every PROCESS_INSTANCES row:
// identical canvases dedupe by (processId, hash), and instances reference
// the version by FK instead of carrying their own ~50KB jsonb copy.
//
// Why a separate table (vs leaving the snapshot inline)?
//   • Storage: 1000 instances of the same process were 50MB of
//     duplicated jsonb; with this table they're 1 × 50KB + 1000 × 16-
//     byte FK.
//   • Versioning UX: "show me v3 of this process" becomes a real
//     query instead of "find any instance from that period and read
//     its snapshot column".
//   • Migration story: when a future feature wants to re-execute an
//     old instance against a new version, the version pointer is the
//     hand-off point.
//
// Backward compat: PROCESS_INSTANCES.DEFINITION_SNAPSHOT stays as a
// nullable column. New instances populate PROCESS_VERSION_ID instead;
// the engine's reader prefers the FK and falls back to the inline
// snapshot for rows created before this phase.

export const processVersions = pgTable(
  "PROCESS_VERSIONS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processId: uuid("PROCESS_ID")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the canonicalised canvas. (processId, hash)
     *  is unique — re-publishing an unchanged canvas reuses the row. */
    hash: varchar("HASH", { length: 64 }).notNull(),
    canvasData: jsonb("CANVAS_DATA").notNull(),
    /** Monotonically increasing version number scoped to the process.
     *  Computed at insert time as `MAX(version) + 1` for the process,
     *  starting at 1. Nullable for the brief window before the next
     *  insert can compute it; in practice always populated. */
    version: integer("VERSION"),
    publishedBy: uuid("PUBLISHED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publishedAt: timestamp("PUBLISHED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** D1 — provenance for cross-environment imports. NULL when the
     *  version was published locally; populated for imports with
     *  { sourceEnvName, sourceProcessSlug, sourceVersion, importedAt }
     *  so operators can trace "this v5 came from staging's v4". */
    importedFrom: jsonb("IMPORTED_FROM"),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("PROC_VER_PROCESS_HASH_IDX").on(t.processId, t.hash),
    index("PROC_VER_TENANT_PUBLISHED_IDX").on(t.tenantId, t.publishedAt.desc()),
    index("PROC_VER_PROCESS_VERSION_IDX").on(t.processId, t.version),
  ],
);

// ─── ENVIRONMENT_BINDINGS (D1.1) ────────────────────────────────────
// Per-tenant key/value store for environment-specific config that
// shouldn't travel cross-environment via process exports. Examples:
// SMTP host, REST connector tokens, role-id mappings (when a
// process references a slug-keyed role, the resolver may dereference
// here for backward compat with non-slug deployments).
//
// VALUE_SECRET ships PLAINTEXT for D1.1 — see project_d1_design.md
// "Follow-up: encrypt env-binding secrets" for the OS8 migration plan.
// Acceptable for internal/dev tier; NOT acceptable for regulated
// customers. Closing this loop is a same-milestone deliverable when
// OS8 lands.

export const environmentBindings = pgTable(
  "ENVIRONMENT_BINDINGS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: varchar("KEY", { length: 128 }).notNull(),
    /** 'plain' | 'secret' | 'role-key'. UI uses this to decide
     *  whether to mask the value; engine resolver uses it to pick
     *  VALUE_PLAIN vs VALUE_SECRET on read. */
    valueKind: varchar("VALUE_KIND", { length: 32 }).notNull(),
    valuePlain: text("VALUE_PLAIN"),
    /** PLAINTEXT in D1.1 — see schema header comment. Migration to
     *  encrypted-bytea + KEY_ID lands with OS8. */
    valueSecret: text("VALUE_SECRET"),
    description: text("DESCRIPTION"),
    createdBy: uuid("CREATED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ENV_BINDING_TENANT_KEY_IDX").on(t.tenantId, t.key)],
);

// ─── API_TOKENS (D1.0) ──────────────────────────────────────────────
// Tenant-scoped bearer tokens for the CLI / CI/CD use case. Issued by
// admins, presented as `Authorization: Bearer flowpro_<token>`.
// Stored hashed (SHA-256, no salt — tokens are high-entropy random).
// Scopes: 'process:read' | 'process:write' | 'process:publish' |
// 'env:read' | 'env:write'. The split between write and publish is
// the GAP-05.1 trust boundary applied to non-human auth.

export const apiTokens = pgTable(
  "API_TOKENS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    issuedBy: uuid("ISSUED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Human-readable name for the issue panel — "GitHub Actions —
     *  staging push", etc. Not unique per tenant; admins can pick
     *  whatever. */
    name: varchar("NAME", { length: 128 }).notNull(),
    /** SHA-256 hex of the raw token bytes. Lookups go: caller sends
     *  raw token → server hashes → indexed lookup. Plaintext token
     *  is shown to the issuer ONCE at creation; never recoverable. */
    tokenHash: varchar("TOKEN_HASH", { length: 64 }).notNull(),
    /** JSON array of scope strings. Stored as jsonb for query
     *  flexibility ("WHERE scopes ? 'process:publish'"). */
    scopes: jsonb("SCOPES").notNull(),
    /** NULL = no expiry. Most CI tokens should set 90d expiry as
     *  policy; v1 doesn't enforce. */
    expiresAt: timestamp("EXPIRES_AT", { withTimezone: true }),
    revokedAt: timestamp("REVOKED_AT", { withTimezone: true }),
    lastUsedAt: timestamp("LAST_USED_AT", { withTimezone: true }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("API_TOKEN_HASH_IDX").on(t.tokenHash),
    index("API_TOKEN_TENANT_IDX").on(t.tenantId),
  ],
);

// ─── BUSINESS_DOCUMENTS (reusable templates) ────────────────────────

export const businessDocuments = pgTable(
  "BUSINESS_DOCUMENTS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("CREATED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("NAME", { length: 255 }).notNull(),
    schema: jsonb("SCHEMA").notNull(),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("BIZ_DOC_TENANT_IDX").on(t.tenantId)],
);

// ─── PROCESS_DOCUMENTS (links business doc to a process) ────────────

export const processDocuments = pgTable(
  "PROCESS_DOCUMENTS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    processId: uuid("PROCESS_ID")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    documentId: uuid("DOCUMENT_ID").references(() => businessDocuments.id, {
      onDelete: "cascade",
    }),
    schemaOverride: jsonb("SCHEMA_OVERRIDE").notNull(),
    source: docSourceEnum("SOURCE").notNull(),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("PROC_DOC_PROCESS_IDX").on(t.processId)],
);

// ─── AI_INTERACTIONS (scaffold call history) ────────────────────────

// ─── WEBHOOK_SUBSCRIPTIONS ──────────────────────────────────────────
// Tenant-configured HTTP endpoints that should be notified on engine
// lifecycle events (instance-started, task-completed, etc.). Matching
// happens by event type with optional process scope. Each fire is
// HMAC-signed using the per-subscription secret so receivers can
// verify the request came from us.
//
// Dispatch: the engine writes a row into OUTBOX_EVENTS (transactional
// with the audit row). A worker handler reads the outbox, looks up
// matching subscriptions, enqueues one ENGINE_JOBS row per (event ×
// subscription), and the worker delivers + retries with backoff.

export const webhookSubscriptionStatusEnum = pgEnum(
  "WEBHOOK_SUB_STATUS",
  ["active", "paused", "disabled"],
);

export const webhookSubscriptions = pgTable(
  "WEBHOOK_SUBSCRIPTIONS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Optional: scope to a single process. Null = tenant-wide. */
    processId: uuid("PROCESS_ID").references(() => processes.id, {
      onDelete: "cascade",
    }),
    name: varchar("NAME", { length: 255 }).notNull(),
    url: varchar("URL", { length: 2048 }).notNull(),
    /** Comma-separated list of INSTANCE_EVENT_TYPE values to fire on,
     *  or "*" for all. Free-form to keep the schema simple; the
     *  dispatcher splits + matches at runtime. */
    eventTypes: text("EVENT_TYPES").notNull().default("*"),
    /** Shared secret used for the X-Engine-Signature HMAC. Stored
     *  encrypted at rest (OS8) in the `enc:v1:<iv>:<ciphertext>` format
     *  produced by CryptoService. A 32-byte hex secret (64 ASCII chars)
     *  encrypts to ~132 chars, so the column is sized to 512 with room
     *  for future v2/v3 envelopes (KMS-wrapped DEK adds ~200 chars). */
    secret: varchar("SECRET", { length: 512 }).notNull(),
    status: webhookSubscriptionStatusEnum("STATUS").notNull().default("active"),
    createdBy: uuid("CREATED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("WEBHOOK_SUB_TENANT_IDX").on(t.tenantId),
    index("WEBHOOK_SUB_PROCESS_IDX").on(t.processId),
  ],
);

// ─── OUTBOX_EVENTS ──────────────────────────────────────────────────
// Transactional outbox for engine lifecycle events. The engine writes
// a row here in the SAME txn as the corresponding INSTANCE_EVENTS
// audit row, guaranteeing at-least-once delivery semantics: if the
// txn commits, both audit + outbox land; if it rolls back, neither do.
// The dispatcher reads `pending` rows on a separate tick and
// publishes via WEBHOOK_SUBSCRIPTIONS / future Kafka / etc.

export const outboxEventStatusEnum = pgEnum("OUTBOX_EVENT_STATUS", [
  "pending",
  "dispatched",
  "failed",
]);

export const outboxEvents = pgTable(
  "OUTBOX_EVENTS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processId: uuid("PROCESS_ID"),
    instanceId: uuid("INSTANCE_ID"),
    eventType: varchar("EVENT_TYPE", { length: 64 }).notNull(),
    payload: jsonb("PAYLOAD").notNull(),
    status: outboxEventStatusEnum("STATUS").notNull().default("pending"),
    dispatchedAt: timestamp("DISPATCHED_AT", { withTimezone: true }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Hot path for the dispatcher: pending rows oldest first.
    index("OUTBOX_STATUS_CREATED_IDX").on(t.status, t.createdAt),
    index("OUTBOX_TENANT_CREATED_IDX").on(t.tenantId, t.createdAt.desc()),
  ],
);

// ─── CONNECTOR_INSTANCES ────────────────────────────────────────────
// I4 — Connector framework. One row per configured account/relay/etc.
// for a given connector type. Tenant-scoped; secrets inside CONFIG are
// encrypted at rest by ConnectorInstancesService using CryptoService,
// per the connector definition's `secretFields` list.
//
// Identity model:
//   • (tenantId, connectorType, name) is unique — name is the
//     cross-env identity used by D1 bundles (instead of the uuid id).
//   • At most one row per (tenantId, connectorType) has isDefault=true.
//     Enforcement lives in the service layer; we don't use a partial
//     unique index because flipping default would need a two-statement
//     dance. The service runs both in a single txn instead.
//
// Why CONFIG is a single JSONB rather than per-connector columns:
//   • Adding a new connector is a code-only change; no schema migration.
//   • Schema lives in the connector definition (server-side) and the
//     UI renders the form from it. DB stays generic.

export const connectorInstances = pgTable(
  "CONNECTOR_INSTANCES",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Connector definition id, e.g. "mail", "rest", "slack". Matches
     *  the `id` field on the registered ConnectorDefinition. */
    connectorType: varchar("CONNECTOR_TYPE", { length: 64 }).notNull(),
    /** Human-friendly name, unique per (tenantId, connectorType).
     *  Used as the cross-env identity by D1 bundles — see
     *  project_d1_design.md. */
    name: varchar("NAME", { length: 255 }).notNull(),
    /** Per-connector config blob. Secret fields (per the connector's
     *  `secretFields` array) are encrypted by the service before
     *  insert/update; the rest stay plaintext for UI display. */
    config: jsonb("CONFIG").notNull().default({}),
    enabled: boolean("ENABLED").notNull().default(true),
    /** At most one default per (tenantId, connectorType). When the
     *  designer doesn't pick a specific connection on a task, runtime
     *  resolves to this. */
    isDefault: boolean("IS_DEFAULT").notNull().default(false),
    updatedBy: uuid("UPDATED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("CONN_INST_TENANT_TYPE_IDX").on(t.tenantId, t.connectorType),
    uniqueIndex("CONN_INST_TENANT_TYPE_NAME_IDX").on(
      t.tenantId,
      t.connectorType,
      t.name,
    ),
  ],
);

// TENANT_MAIL_SETTINGS retired 2026-05-18 (I4 Sprint 2). Replaced by
// the Mail connector + CONNECTOR_INSTANCES (connectorType='mail').
// Data migration: scripts/migrate-mail-to-connector.ts.
// SQL migration: 0005_i4_s2_drop_tenant_mail_settings.sql.

// ─── ENGINE_JOBS ────────────────────────────────────────────────────
// Durable async work queue. The interpreter enqueues a job whenever
// a node needs side-effects that shouldn't block the request thread
// (E5: service tasks; later: webhook dispatch, timer fires, retries).
// Worker poll loop claims rows via SELECT FOR UPDATE SKIP LOCKED so
// horizontally-scaled API processes don't double-execute.
//
// Token relationship: a job typically belongs to a token that's
// suspended on `waitingFor=service-task` (etc.); when the job
// completes, the worker resumes the token via the same advance-loop
// path completeTask uses. Decoupling means a slow/failing handler
// can't tie up an HTTP request thread or hold an open DB txn.

export const engineJobStatusEnum = pgEnum("ENGINE_JOB_STATUS", [
  "queued",
  "running",
  "completed",
  "failed",
  "dead",
]);

export const engineJobs = pgTable(
  "ENGINE_JOBS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Optional links: not every job ties to a specific token (e.g.
    // webhook-dispatch fires on instance lifecycle, may not have a
    // single owning token). Nullable + no FK so audit survives token
    // deletion — same pattern as INSTANCE_EVENTS.tokenId.
    instanceId: uuid("INSTANCE_ID"),
    tokenId: uuid("TOKEN_ID"),
    /** Job kind — picks the handler from the worker registry. E4.5
     *  defines the contract; concrete kinds land in E5+ (`service-task`,
     *  `webhook-dispatch`, `timer-fire`). */
    jobType: varchar("JOB_TYPE", { length: 64 }).notNull(),
    /** Free-form routing key inside the kind — for service-task this
     *  is the user-defined topic (e.g. `crm.upsertContact`). */
    topic: varchar("TOPIC", { length: 255 }).notNull(),
    input: jsonb("INPUT"),
    result: jsonb("RESULT"),
    status: engineJobStatusEnum("STATUS").notNull().default("queued"),
    attempts: integer("ATTEMPTS").notNull().default(0),
    maxAttempts: integer("MAX_ATTEMPTS").notNull().default(3),
    lastError: text("LAST_ERROR"),
    /** When the job is eligible to run. Set in the future by the
     *  exponential-backoff retry path. The worker query is
     *  `WHERE status='queued' AND scheduledFor <= now()`. */
    scheduledFor: timestamp("SCHEDULED_FOR", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set by the worker when it claims the job. `lockedBy` is a
     *  worker id (pid + random suffix) used for diagnostics — stale
     *  `running` rows can be reclaimed by checking lockedAt age. */
    lockedAt: timestamp("LOCKED_AT", { withTimezone: true }),
    lockedBy: varchar("LOCKED_BY", { length: 64 }),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The hot path for the worker poll: queued + due. Partial-index
    // semantics aren't expressed here (drizzle-kit doesn't support
    // `WHERE` clauses on indexes cleanly) but the leading-column
    // status is highly selective so the planner uses this efficiently.
    index("ENGINE_JOB_QUEUE_IDX").on(t.status, t.scheduledFor),
    index("ENGINE_JOB_INSTANCE_IDX").on(t.instanceId),
    index("ENGINE_JOB_TENANT_CREATED_IDX").on(t.tenantId, t.createdAt.desc()),
  ],
);

// ─── IDEMPOTENCY_KEYS ───────────────────────────────────────────────
// Replay-safe POST endpoints. Client sends an Idempotency-Key header;
// the first request stores its serialised response keyed by
// (tenant, endpoint, key). Subsequent requests with the same key
// short-circuit and return the cached response — so retries (network
// flakes, mobile reconnects, queue redelivery) never double-create
// instances or double-complete tasks. Stripe-style.
//
// `expiresAt` lets a future cleanup job sweep stale entries; 24h is
// the canonical industry default and big enough to absorb any sensible
// retry window.

export const idempotencyKeys = pgTable(
  "IDEMPOTENCY_KEYS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    endpoint: varchar("ENDPOINT", { length: 64 }).notNull(),
    key: varchar("KEY", { length: 255 }).notNull(),
    requestHash: varchar("REQUEST_HASH", { length: 64 }).notNull(),
    responseStatus: integer("RESPONSE_STATUS").notNull(),
    responseJson: jsonb("RESPONSE_JSON"),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("EXPIRES_AT", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("IDEMP_TENANT_ENDPOINT_KEY_IDX").on(
      t.tenantId,
      t.endpoint,
      t.key,
    ),
    index("IDEMP_EXPIRES_IDX").on(t.expiresAt),
  ],
);

export const aiInteractionStatusEnum = pgEnum("AI_INTERACTION_STATUS", [
  "success",
  "error",
]);

// ─── Engine Enums ───────────────────────────────────────────────────

export const processInstanceStatusEnum = pgEnum("PROCESS_INSTANCE_STATUS", [
  "running",
  "completed",
  "failed",
  "cancelled",
  // Suspended: admin paused execution. Advance loop refuses to move
  // tokens; worker poll skips jobs for suspended instances. Resume
  // flips back to `running`. Cancel from suspended is allowed.
  "suspended",
]);

export const instanceTokenStatusEnum = pgEnum("INSTANCE_TOKEN_STATUS", [
  "active",
  "waiting",
  "completed",
  "failed",
]);

// ─── PROCESS_INSTANCES ──────────────────────────────────────────────

export const processInstances = pgTable(
  "PROCESS_INSTANCES",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processId: uuid("PROCESS_ID")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    startedBy: uuid("STARTED_BY")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Frozen copy of the process canvas at start time (legacy). New
    // instances reference PROCESS_VERSIONS via processVersionId; this
    // column stays for backward compatibility with rows created before
    // E4.5b. Made nullable to allow new rows to skip it. The engine's
    // canvas reader prefers the version FK and falls back to this.
    definitionSnapshot: jsonb("DEFINITION_SNAPSHOT"),
    /** FK into the deduplicated PROCESS_VERSIONS table. Populated for
     *  every instance started after E4.5b; null for legacy rows. The
     *  pair (definitionHash, processVersionId) is redundant once all
     *  rows are migrated — kept until then for a safe rollback. */
    processVersionId: uuid("PROCESS_VERSION_ID").references(
      () => processVersions.id,
      { onDelete: "restrict" },
    ),
    // SHA-256 hex of the canonicalised snapshot. Forward-compat hook
    // for a future content-addressed PROCESS_DEFINITIONS table — lets
    // us dedupe identical snapshots and answer "which logical version
    // did this instance run?" without a separate version column.
    definitionHash: varchar("DEFINITION_HASH", { length: 64 }).notNull(),
    /** Host-app correlation key. Caller-supplied string (e.g. a PO
     *  number, a leave-request id in the source system). Scoped to
     *  (tenantId, businessKey) for fast lookup via GET
     *  /instances?businessKey=… — the industry-standard pattern for
     *  host-app ↔ BPM correlation. Nullable: ad-hoc starts from the
     *  designer don't need a business key. */
    businessKey: varchar("BUSINESS_KEY", { length: 255 }),
    status: processInstanceStatusEnum("STATUS").notNull().default("running"),
    // Use a SQL-side default so raw inserts (seeds, admin tooling) that
    // omit VARIABLES don't trip the NOT NULL — Drizzle's `.default({})`
    // only fills in app-side INSERTs.
    variables: jsonb("VARIABLES").notNull().default(sql`'{}'::jsonb`),
    errorMessage: text("ERROR_MESSAGE"),
    startedAt: timestamp("STARTED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("COMPLETED_AT", { withTimezone: true }),
    // Optimistic-locking guard, mirrors INSTANCE_TOKENS.VERSION. Needed
    // now that E3 introduces concurrent paths that flip instance state
    // (task completion can transition running → completed; cancel will
    // race in a future phase).
    version: integer("VERSION").notNull().default(0),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("PROC_INST_TENANT_CREATED_IDX").on(t.tenantId, t.createdAt.desc()),
    index("PROC_INST_PROCESS_IDX").on(t.processId),
    index("PROC_INST_TENANT_STATUS_IDX").on(t.tenantId, t.status),
    index("PROC_INST_TENANT_BUSINESSKEY_IDX").on(t.tenantId, t.businessKey),
  ],
);

// ─── INSTANCE_TOKENS ────────────────────────────────────────────────

export const instanceTokens = pgTable(
  "INSTANCE_TOKENS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    instanceId: uuid("INSTANCE_ID")
      .notNull()
      .references(() => processInstances.id, { onDelete: "cascade" }),
    currentNodeId: varchar("CURRENT_NODE_ID", { length: 255 }).notNull(),
    status: instanceTokenStatusEnum("STATUS").notNull().default("active"),
    waitingFor: varchar("WAITING_FOR", { length: 64 }),
    assignedTo: uuid("ASSIGNED_TO").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Role key (e.g. `manager`) for tokens waiting on a role-assigned
     *  userTask. Set when the engine enters the task; cleared when a
     *  user claims it (claim-first). Mutually exclusive with a direct
     *  assignedTo set at entry-time, but both can be non-null after
     *  claim (role gate + specific claimant). */
    candidateRole: varchar("CANDIDATE_ROLE", { length: 64 }),
    /** P0 task scheduling — only meaningful for tokens waiting on a
     *  userTask. Set by the engine on entry from the node's
     *  `data.scheduling`; null when no scheduling is configured. Surfaced
     *  in listTasks so the inbox can sort by due/priority. */
    dueAt: timestamp("DUE_AT", { withTimezone: true }),
    priority: integer("PRIORITY"),
    /** P1 — fork lineage. Set only on children spawned by a parallel
     *  (and later inclusive) gateway. `parentTokenId` points to the
     *  token that entered the gateway; `forkId` is shared by every
     *  sibling spawned in the same fork so Session 3's parallel JOIN
     *  can scope its "have all siblings arrived?" query correctly even
     *  when the same parent forks more than once sequentially. Both
     *  null on the root token + on every non-forked token. */
    parentTokenId: uuid("PARENT_TOKEN_ID"),
    forkId: uuid("FORK_ID"),
    /** P1 Session 3 — number of siblings spawned in this token's fork.
     *  Set at fork time on every child (parallel = #outgoing, inclusive
     *  = #conditions that matched). The parallel/inclusive JOIN reads
     *  this to decide "have all expected siblings arrived?" without
     *  reachability analysis at runtime. Null on non-forked tokens. */
    forkSize: integer("FORK_SIZE"),
    errorMessage: text("ERROR_MESSAGE"),
    // Optimistic-locking guard. Every UPDATE bumps `version`; the
    // interpreter's update statement asserts the prior version in the
    // WHERE clause so two concurrent "complete this task" calls can't
    // both win — the loser's update affects 0 rows and we retry/error.
    version: integer("VERSION").notNull().default(0),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("TOKEN_INSTANCE_IDX").on(t.instanceId),
    index("TOKEN_TENANT_STATUS_IDX").on(t.tenantId, t.status),
    index("TOKEN_ASSIGNED_IDX").on(t.assignedTo, t.status),
  ],
);

// ─── INSTANCE_EVENTS ────────────────────────────────────────────────
// Append-only audit log of everything that happened during an instance:
// node entered/exited, decision taken, variable changed, error raised.
// Powers debugging, replay, compliance, and (later) timeline UIs.
// Never UPDATE or DELETE — only INSERT.

export const instanceEventTypeEnum = pgEnum("INSTANCE_EVENT_TYPE", [
  "instance-started",
  "instance-completed",
  "instance-failed",
  "instance-cancelled",
  "node-entered",
  "node-exited",
  "edge-taken",
  "token-created",
  "token-completed",
  "token-waiting",
  "token-resumed",
  "task-claimed",
  "task-unclaimed",
  "task-completed",
  "task-reassigned",
  "task-skipped",
  // GAP-T2-B: emitted by the worker on every failed service-task
  // attempt, NOT just the final one. Payload carries
  // { attempt, maxAttempts, error, willRetry, nextAttemptAt }. The
  // existing terminal `error` + `instance-failed` events still fire
  // on the last attempt — these are additive so the activity feed
  // can show per-attempt history without losing the summary.
  "service-task-attempt-failed",
  "variable-set",
  "variable-edited",
  "variable-unresolved",
  "instance-suspended",
  "instance-resumed",
  "instance-modified",
  // P2 Session 4 — emitted when a userTask's due-date timer fires
  // (either via the scheduler or fire-immediately at task entry for
  // already-past dates). Payload: { tokenId, nodeId, dueAt, taskLabel,
  // assignedTo, candidateRole }.
  "task-due",
  "error",
]);

export const instanceEvents = pgTable(
  "INSTANCE_EVENTS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    instanceId: uuid("INSTANCE_ID")
      .notNull()
      .references(() => processInstances.id, { onDelete: "cascade" }),
    // Token may not exist for instance-level events (started/completed)
    // and may have been deleted by the time we read; nullable + no FK
    // back to INSTANCE_TOKENS keeps the audit trail immutable.
    tokenId: uuid("TOKEN_ID"),
    // Actor who triggered the event, when there is one (instance-start,
    // task-claim, task-complete, cancel, variable-set from a UI action).
    // Null for autonomous events (node-entered, edge-taken, timer fires).
    // Nullable + no FK so user deletion can't break the audit trail.
    userId: uuid("USER_ID"),
    nodeId: varchar("NODE_ID", { length: 255 }),
    eventType: instanceEventTypeEnum("EVENT_TYPE").notNull(),
    // Per-event payload: edge id for edge-taken, variable name+value
    // for variable-set, error detail for error, etc. Shape is event-
    // specific and validated by the writer, not the schema.
    payload: jsonb("PAYLOAD"),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("EVENT_INSTANCE_CREATED_IDX").on(t.instanceId, t.createdAt),
    index("EVENT_TENANT_CREATED_IDX").on(t.tenantId, t.createdAt.desc()),
  ],
);

export const aiInteractions = pgTable(
  "AI_INTERACTIONS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("USER_ID")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("KIND", { length: 64 }).notNull(),
    description: text("DESCRIPTION").notNull(),
    model: varchar("MODEL", { length: 128 }).notNull(),
    status: aiInteractionStatusEnum("STATUS").notNull(),
    responseJson: jsonb("RESPONSE_JSON"),
    errorMessage: text("ERROR_MESSAGE"),
    tokensIn: integer("TOKENS_IN"),
    tokensOut: integer("TOKENS_OUT"),
    durationMs: integer("DURATION_MS").notNull(),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("AI_INTERACTIONS_TENANT_CREATED_IDX").on(
      t.tenantId,
      t.createdAt.desc(),
    ),
  ],
);

// ─── SCHEDULED_TIMERS ──────────────────────────────────────────────
// P2 Session 4 — the engine's wake-me-up-later queue. Every row is one
// future event the engine needs to fire: a userTask due-date reminder
// today; boundary-event timers, intermediate-catch timers, and timer
// start events in Session 6.
//
// Lifecycle: scheduleTimer INSERTs `pending`. The TimerSchedulerService
// polls every 10s with `FOR UPDATE SKIP LOCKED` for due rows; per row
// flips `pending` → `firing` (two-phase fire — Decision #1 for crash
// idempotency), dispatches the callback, then DELETEs. Rows stuck in
// `firing` longer than the recovery threshold (5 min) get retried.

export const scheduledTimerStatusEnum = pgEnum("SCHEDULED_TIMER_STATUS", [
  "pending",
  "firing",
]);

export const scheduledTimerKindEnum = pgEnum("SCHEDULED_TIMER_KIND", [
  // Session 4 — userTask due-date reminder.
  "task-due-reminder",
  // Session 6 placeholders — declared now so the enum doesn't need a
  // migration when those land. Engine doesn't dispatch these yet.
  "boundary-timer",
  "intermediate-catch-timer",
  "start-event-timer",
]);

export const scheduledTimers = pgTable(
  "SCHEDULED_TIMERS",
  {
    id: uuid("ID").primaryKey().defaultRandom(),
    tenantId: uuid("TENANT_ID")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    instanceId: uuid("INSTANCE_ID")
      .notNull()
      .references(() => processInstances.id, { onDelete: "cascade" }),
    // Most timers belong to a single token; some kinds (start-event
    // timers when those land) may not — keep nullable.
    tokenId: uuid("TOKEN_ID").references(() => instanceTokens.id, {
      onDelete: "cascade",
    }),
    fireAt: timestamp("FIRE_AT", { withTimezone: true }).notNull(),
    kind: scheduledTimerKindEnum("KIND").notNull(),
    status: scheduledTimerStatusEnum("STATUS").notNull().default("pending"),
    payload: jsonb("PAYLOAD"),
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when the scheduler flips a row to `firing`. The recovery
     *  query — "is there a `firing` row older than 5 min?" — uses this
     *  to detect mid-fire crashes and re-pick the row. */
    firingStartedAt: timestamp("FIRING_STARTED_AT", { withTimezone: true }),
  },
  (t) => [
    // Primary poll query: pending + due. Sorting on fire_at makes the
    // poll FIFO-ish (earliest due fires first).
    index("SCHEDULED_TIMER_POLL_IDX").on(t.status, t.fireAt),
    // Bulk cancel by instance (cancelInstance) + by token (completeTask).
    index("SCHEDULED_TIMER_INSTANCE_IDX").on(t.instanceId),
    index("SCHEDULED_TIMER_TOKEN_IDX").on(t.tokenId),
  ],
);
