-- P3 Session 8 — Signals + event-triggered process starts.
--
-- Three new tables, one new SCHEDULED_TIMERS kind, four new audit-event
-- types. Everything idempotent. Safe to re-run.
--
-- The schema deliberately mirrors MESSAGE_SUBSCRIPTIONS so cancel
-- paths look identical across the three "parked-wait" registries.

-- ─── Signals ────────────────────────────────────────────────────────
--
-- One row per *catching* token (intermediateCatchEvent kind=signal)
-- OR per *signal-start* registration (startEvent kind=signal). The
-- INSTANCE_ID/TOKEN_ID columns are nullable — when both are NULL and
-- PROCESS_ID is set, the row represents a signal-start (no instance
-- exists yet; firing the signal CREATES one).
--
-- Lookup on POST /api/signals fans out tenant-wide: SELECT every row
-- matching (tenant, signal_name) and act on each (resume token OR
-- start instance).
CREATE TABLE IF NOT EXISTS "SIGNAL_SUBSCRIPTIONS" (
  "ID" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "TENANT_ID" uuid NOT NULL,
  "INSTANCE_ID" uuid,
  "TOKEN_ID" uuid,
  "SCOPE_TOKEN_ID" uuid,
  "PROCESS_ID" uuid,
  "SIGNAL_NAME" varchar(255) NOT NULL,
  "CREATED_AT" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "SIGNAL_SUBSCRIPTIONS_TENANT_FK"
    FOREIGN KEY ("TENANT_ID") REFERENCES "TENANTS"("ID") ON DELETE CASCADE,
  CONSTRAINT "SIGNAL_SUBSCRIPTIONS_INSTANCE_FK"
    FOREIGN KEY ("INSTANCE_ID") REFERENCES "PROCESS_INSTANCES"("ID") ON DELETE CASCADE,
  CONSTRAINT "SIGNAL_SUBSCRIPTIONS_TOKEN_FK"
    FOREIGN KEY ("TOKEN_ID") REFERENCES "INSTANCE_TOKENS"("ID") ON DELETE CASCADE,
  CONSTRAINT "SIGNAL_SUBSCRIPTIONS_SCOPE_FK"
    FOREIGN KEY ("SCOPE_TOKEN_ID") REFERENCES "INSTANCE_TOKENS"("ID") ON DELETE CASCADE,
  CONSTRAINT "SIGNAL_SUBSCRIPTIONS_PROCESS_FK"
    FOREIGN KEY ("PROCESS_ID") REFERENCES "PROCESSES"("ID") ON DELETE CASCADE,
  -- Enforce the catch-OR-start invariant: either we're catching on a
  -- live token (INSTANCE + TOKEN both set) or we're a start
  -- subscription (PROCESS set, INSTANCE + TOKEN both null). Anything
  -- else is malformed.
  CONSTRAINT "SIGNAL_SUBSCRIPTIONS_KIND_CHK" CHECK (
    ("TOKEN_ID" IS NOT NULL AND "INSTANCE_ID" IS NOT NULL AND "PROCESS_ID" IS NULL)
    OR
    ("TOKEN_ID" IS NULL AND "INSTANCE_ID" IS NULL AND "PROCESS_ID" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "SIGNAL_SUBSCRIPTION_LOOKUP_IDX"
  ON "SIGNAL_SUBSCRIPTIONS" ("TENANT_ID", "SIGNAL_NAME");

CREATE INDEX IF NOT EXISTS "SIGNAL_SUBSCRIPTION_INSTANCE_IDX"
  ON "SIGNAL_SUBSCRIPTIONS" ("INSTANCE_ID");

CREATE INDEX IF NOT EXISTS "SIGNAL_SUBSCRIPTION_TOKEN_IDX"
  ON "SIGNAL_SUBSCRIPTIONS" ("TOKEN_ID");

CREATE INDEX IF NOT EXISTS "SIGNAL_SUBSCRIPTION_PROCESS_IDX"
  ON "SIGNAL_SUBSCRIPTIONS" ("PROCESS_ID");

-- ─── Message-start subscriptions ────────────────────────────────────
--
-- One row per ACTIVE process that has a startEvent with
-- eventDefinition.kind=message. POST /api/messages falls back here
-- when no token subscription matches: a match creates a fresh
-- instance with the message payload as initial variables + the
-- correlationKey as the businessKey.
CREATE TABLE IF NOT EXISTS "MESSAGE_START_SUBSCRIPTIONS" (
  "ID" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "TENANT_ID" uuid NOT NULL,
  "PROCESS_ID" uuid NOT NULL,
  "MESSAGE_NAME" varchar(255) NOT NULL,
  "START_NODE_ID" varchar(255) NOT NULL,
  "CREATED_AT" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "MESSAGE_START_SUBSCRIPTIONS_TENANT_FK"
    FOREIGN KEY ("TENANT_ID") REFERENCES "TENANTS"("ID") ON DELETE CASCADE,
  CONSTRAINT "MESSAGE_START_SUBSCRIPTIONS_PROCESS_FK"
    FOREIGN KEY ("PROCESS_ID") REFERENCES "PROCESSES"("ID") ON DELETE CASCADE,
  -- One process can only register one start per message name. If a
  -- modeler accidentally adds two start events with the same name,
  -- publish fails fast on this constraint rather than silently picking
  -- one at delivery time.
  CONSTRAINT "MESSAGE_START_SUBSCRIPTIONS_UNIQUE"
    UNIQUE ("TENANT_ID", "MESSAGE_NAME", "PROCESS_ID")
);

CREATE INDEX IF NOT EXISTS "MESSAGE_START_LOOKUP_IDX"
  ON "MESSAGE_START_SUBSCRIPTIONS" ("TENANT_ID", "MESSAGE_NAME");

CREATE INDEX IF NOT EXISTS "MESSAGE_START_PROCESS_IDX"
  ON "MESSAGE_START_SUBSCRIPTIONS" ("PROCESS_ID");

-- ─── Timer-start kind on the existing SCHEDULED_TIMERS table ─────────
-- Existing 'kind' column is a Postgres enum SCHEDULED_TIMER_KIND.
-- Add the new value idempotently. The dispatcher registers a callback
-- for this kind in EngineService's constructor.
ALTER TYPE "public"."SCHEDULED_TIMER_KIND" ADD VALUE IF NOT EXISTS 'process-start-timer';

-- Process-start timers have no instance yet, so INSTANCE_ID must be
-- nullable. Idempotent.
ALTER TABLE "SCHEDULED_TIMERS" ALTER COLUMN "INSTANCE_ID" DROP NOT NULL;

-- ─── Audit event types ──────────────────────────────────────────────
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'signal-subscribed';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'signal-received';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'signal-thrown';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'signal-unsubscribed';
