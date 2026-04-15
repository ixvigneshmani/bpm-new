import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
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
  settings: text("SETTINGS"),
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
