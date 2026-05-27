-- P4 Session 11 — CallActivity dispatch.
--
-- Adds parent linkage to PROCESS_INSTANCES so a child instance knows
-- which parent token to resume on completion. Also adds CALL_DEPTH to
-- enforce a recursion guard.
--
-- PARENT_INSTANCE_ID: FK → PROCESS_INSTANCES, ON DELETE CASCADE so
--   cancelling the parent kills the child (mirror of how cancelInstance
--   already cascades scope tokens within a single instance).
-- PARENT_TOKEN_ID: FK → INSTANCE_TOKENS, ON DELETE SET NULL because
--   tokens can be deleted/superseded; the child can still complete and
--   we'll log "parent token vanished" instead of failing.
-- CALL_DEPTH: int default 0; child instances get parent.callDepth + 1.
--   Capped at 20 in engine code to prevent infinite recursion loops.
--
-- 4 new audit-event types for the callActivity lifecycle.
--
-- All operations are idempotent (IF NOT EXISTS / ADD VALUE IF NOT EXISTS).

ALTER TABLE "PROCESS_INSTANCES"
  ADD COLUMN IF NOT EXISTS "PARENT_INSTANCE_ID" uuid;

ALTER TABLE "PROCESS_INSTANCES"
  ADD COLUMN IF NOT EXISTS "PARENT_TOKEN_ID" uuid;

ALTER TABLE "PROCESS_INSTANCES"
  ADD COLUMN IF NOT EXISTS "CALL_DEPTH" integer NOT NULL DEFAULT 0;

-- FK to parent. Cascade so cancelInstance on a parent kills the child.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PROCESS_INSTANCES_PARENT_INSTANCE_FK'
  ) THEN
    ALTER TABLE "PROCESS_INSTANCES"
      ADD CONSTRAINT "PROCESS_INSTANCES_PARENT_INSTANCE_FK"
      FOREIGN KEY ("PARENT_INSTANCE_ID") REFERENCES "PROCESS_INSTANCES"("ID") ON DELETE CASCADE;
  END IF;
END $$;

-- FK to parent token. Set null on delete because tokens can be cleaned.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PROCESS_INSTANCES_PARENT_TOKEN_FK'
  ) THEN
    ALTER TABLE "PROCESS_INSTANCES"
      ADD CONSTRAINT "PROCESS_INSTANCES_PARENT_TOKEN_FK"
      FOREIGN KEY ("PARENT_TOKEN_ID") REFERENCES "INSTANCE_TOKENS"("ID") ON DELETE SET NULL;
  END IF;
END $$;

-- Index for fast lookup of children by parent (resume path).
CREATE INDEX IF NOT EXISTS "PROC_INST_PARENT_IDX"
  ON "PROCESS_INSTANCES" ("PARENT_INSTANCE_ID");

-- New audit-event types.
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'child-instance-started';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'child-instance-completed';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'child-instance-failed';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'call-completed';
