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
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("UPDATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("PROCESS_TENANT_IDX").on(t.tenantId)],
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
    // Frozen copy of the process canvas at start time. The interpreter
    // executes against this — never the live `processes.canvas_data` —
    // so an in-flight instance is unaffected by edits to the design.
    // Required for determinism, audit, and replay. Type is loose
    // (jsonb) but the EngineCanvas projection narrows it at read time.
    definitionSnapshot: jsonb("DEFINITION_SNAPSHOT").notNull(),
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
    createdAt: timestamp("CREATED_AT", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("PROC_INST_TENANT_CREATED_IDX").on(t.tenantId, t.createdAt.desc()),
    index("PROC_INST_PROCESS_IDX").on(t.processId),
    index("PROC_INST_TENANT_STATUS_IDX").on(t.tenantId, t.status),
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
  "variable-set",
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
