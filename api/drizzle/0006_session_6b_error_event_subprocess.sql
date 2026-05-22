-- P2 Session 6b — new INSTANCE_EVENT_TYPE enum values for error throw
-- + event subprocess lifecycle. Additive only; no data migration.
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'error-thrown';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'error-uncaught';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'event-subprocess-subscribed';
ALTER TYPE "public"."INSTANCE_EVENT_TYPE" ADD VALUE IF NOT EXISTS 'event-subprocess-fired';
