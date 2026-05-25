-- P3 Session 7 — Message correlation.
--
-- New table for parked intermediate-message-catch tokens. Schema mirrors
-- SCHEDULED_TIMERS: tenant-scoped, instance + token FK with cascade, FK
-- to the scope token (optional, for subprocess-scoped catches), plus the
-- correlation tuple used by the lookup query on POST /api/messages.
--
-- All idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS "MESSAGE_SUBSCRIPTIONS" (
  "ID" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "TENANT_ID" uuid NOT NULL,
  "INSTANCE_ID" uuid NOT NULL,
  "TOKEN_ID" uuid NOT NULL,
  "SCOPE_TOKEN_ID" uuid,
  "MESSAGE_NAME" varchar(255) NOT NULL,
  "CORRELATION_KEY" varchar(255) NOT NULL,
  "CREATED_AT" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "MESSAGE_SUBSCRIPTIONS_TENANT_FK"
    FOREIGN KEY ("TENANT_ID") REFERENCES "TENANTS"("ID") ON DELETE CASCADE,
  CONSTRAINT "MESSAGE_SUBSCRIPTIONS_INSTANCE_FK"
    FOREIGN KEY ("INSTANCE_ID") REFERENCES "PROCESS_INSTANCES"("ID") ON DELETE CASCADE,
  CONSTRAINT "MESSAGE_SUBSCRIPTIONS_TOKEN_FK"
    FOREIGN KEY ("TOKEN_ID") REFERENCES "INSTANCE_TOKENS"("ID") ON DELETE CASCADE,
  CONSTRAINT "MESSAGE_SUBSCRIPTIONS_SCOPE_FK"
    FOREIGN KEY ("SCOPE_TOKEN_ID") REFERENCES "INSTANCE_TOKENS"("ID") ON DELETE CASCADE
);

-- Primary lookup: POST /api/messages SELECT FOR UPDATE WHERE tenant+name+key.
CREATE INDEX IF NOT EXISTS "MESSAGE_SUBSCRIPTION_LOOKUP_IDX"
  ON "MESSAGE_SUBSCRIPTIONS" ("TENANT_ID", "MESSAGE_NAME", "CORRELATION_KEY");

-- Bulk cancel by instance (cancelInstance, scope-drain).
CREATE INDEX IF NOT EXISTS "MESSAGE_SUBSCRIPTION_INSTANCE_IDX"
  ON "MESSAGE_SUBSCRIPTIONS" ("INSTANCE_ID");

-- Bulk cancel by token (token cancel, scope-drain at scope_token granularity).
CREATE INDEX IF NOT EXISTS "MESSAGE_SUBSCRIPTION_TOKEN_IDX"
  ON "MESSAGE_SUBSCRIPTIONS" ("TOKEN_ID");

-- New audit-event types for the message lifecycle. Idempotent ADD VALUE.
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'message-subscribed';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'message-received';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'message-unsubscribed';
