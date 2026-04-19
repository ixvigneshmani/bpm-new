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
