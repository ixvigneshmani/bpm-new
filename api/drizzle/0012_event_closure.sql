-- P4 Event-component closure (Start/Catch/Throw/Boundary).
--
-- Adds:
--   * BOUNDARY_NODE_ID nullable column to MESSAGE_SUBSCRIPTIONS,
--     SIGNAL_SUBSCRIPTIONS, CONDITIONAL_SUBSCRIPTIONS. When set, the
--     subscription represents a BOUNDARY catcher attached to a host
--     activity, not a parked intermediate-catch token. Dispatcher uses
--     this to decide: "resume the parked token" (normal) vs "interrupt
--     the host activity and spawn token at boundary's outgoing edge"
--     (boundary).
--
--   * new SCHEDULED_TIMER_KIND value `intermediate-catch-timer` for
--     intermediate timer catches that park a token mid-flow until the
--     timer fires (mirrors the existing boundary-timer + start-event-
--     timer kinds).
--
--   * COMPENSATION_HANDLERS table — INSERT on activity completion when
--     a compensateBoundaryEvent is attached. Compensation throw walks
--     these in reverse-of-completion order, firing each handler.
--
--   * 4 new INSTANCE_EVENT_TYPE values for compensation lifecycle.
--
-- All operations idempotent.

ALTER TABLE "MESSAGE_SUBSCRIPTIONS"
  ADD COLUMN IF NOT EXISTS "BOUNDARY_NODE_ID" varchar(255);

ALTER TABLE "SIGNAL_SUBSCRIPTIONS"
  ADD COLUMN IF NOT EXISTS "BOUNDARY_NODE_ID" varchar(255);

ALTER TABLE "CONDITIONAL_SUBSCRIPTIONS"
  ADD COLUMN IF NOT EXISTS "BOUNDARY_NODE_ID" varchar(255);

ALTER TYPE "public"."SCHEDULED_TIMER_KIND"
  ADD VALUE IF NOT EXISTS 'intermediate-catch-timer';

CREATE TABLE IF NOT EXISTS "COMPENSATION_HANDLERS" (
  "ID" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "TENANT_ID" uuid NOT NULL,
  "INSTANCE_ID" uuid NOT NULL,
  -- Scope token: ID of the parent scope token (subprocess parent OR
  -- NULL for root scope). Compensation throw filters handlers by the
  -- scope it's thrown in.
  "SCOPE_TOKEN_ID" uuid,
  -- The activity that completed and has a compensation handler.
  "ACTIVITY_NODE_ID" varchar(255) NOT NULL,
  -- The compensateBoundaryEvent attached to that activity.
  "HANDLER_BOUNDARY_ID" varchar(255) NOT NULL,
  -- The activity at the boundary's outgoing edge (the actual undo
  -- activity that gets executed during compensation).
  "HANDLER_ACTIVITY_ID" varchar(255) NOT NULL,
  "COMPLETED_AT" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "COMP_HANDLERS_TENANT_FK" FOREIGN KEY ("TENANT_ID")
    REFERENCES "TENANTS"("ID") ON DELETE CASCADE,
  CONSTRAINT "COMP_HANDLERS_INSTANCE_FK" FOREIGN KEY ("INSTANCE_ID")
    REFERENCES "PROCESS_INSTANCES"("ID") ON DELETE CASCADE,
  CONSTRAINT "COMP_HANDLERS_SCOPE_FK" FOREIGN KEY ("SCOPE_TOKEN_ID")
    REFERENCES "INSTANCE_TOKENS"("ID") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "COMP_HANDLERS_INSTANCE_IDX"
  ON "COMPENSATION_HANDLERS" ("INSTANCE_ID");

CREATE INDEX IF NOT EXISTS "COMP_HANDLERS_SCOPE_COMPLETED_IDX"
  ON "COMPENSATION_HANDLERS" ("INSTANCE_ID", "SCOPE_TOKEN_ID", "COMPLETED_AT" DESC);

ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'compensation-thrown';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'compensation-handler-registered';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'compensation-handler-fired';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'compensation-completed';
