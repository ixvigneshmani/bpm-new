import * as Sentry from "@sentry/node";

let initialized = false;

/** Initialize Sentry if SENTRY_DSN is set; otherwise no-op. Safe to
 *  call once at boot. Subsequent calls are ignored. We deliberately
 *  do NOT auto-instrument HTTP — Fastify/Nest already give us request
 *  context via pino + the global exception filter forwards errors
 *  with the correlation id. */
export function initSentry(opts: {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
}): boolean {
  if (initialized) return true;
  if (!opts.dsn) return false;
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    // Performance tracing off by default — we'll add it with OS6 if
    // there's signal that it's worth the overhead.
    tracesSampleRate: 0,
    // Profiling off; same rationale.
    profilesSampleRate: 0,
  });
  initialized = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

/** Forward an exception to Sentry with the correlation context
 *  attached. Called from the GlobalExceptionFilter for any 5xx. */
export function captureException(
  err: unknown,
  ctx: { correlationId?: string; tenantId?: string; userId?: string; route?: string },
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (ctx.correlationId) scope.setTag("correlationId", ctx.correlationId);
    if (ctx.tenantId) scope.setTag("tenantId", ctx.tenantId);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.route) scope.setTag("route", ctx.route);
    Sentry.captureException(err);
  });
}
