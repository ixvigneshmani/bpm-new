-- P4 Session 10 — escalation + terminate + cancel event audit types.
--
-- No new tables. Escalation propagation walks the scope chain via
-- canvas inspection (same shape as Session 6b error throw), with
-- the additional case of intermediate-catch escalation tokens which
-- live as plain INSTANCE_TOKENS rows (waitingFor='escalation') and
-- are scanned by currentNodeId against the canvas.
--
-- Cancel events ship trigger + audit + scope-kill only this session;
-- compensation handler invocation is parked for Session 16.
--
-- Idempotent.

ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'escalation-thrown';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'escalation-caught';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'escalation-uncaught';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'escalation-subscribed';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'escalation-unsubscribed';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'terminate-fired';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'cancel-thrown';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'cancel-caught';
