import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request correlation context. Populated by the pino-http
 *  request-id hook on the HTTP path; available to any service via
 *  CorrelationContext.get(). For non-HTTP paths (workers, schedulers,
 *  outbox dispatch) the worker explicitly seeds the context before
 *  invoking the work via CorrelationContext.run(). */
export interface CorrelationFields {
  correlationId: string;
  /** Optional — populated by AuthMiddleware once the JWT is verified. */
  tenantId?: string;
  userId?: string;
  /** HTTP method + path; useful when correlating audit events with the
   *  exact API call that produced them. */
  route?: string;
}

const als = new AsyncLocalStorage<CorrelationFields>();

export const CorrelationContext = {
  get(): CorrelationFields | undefined {
    return als.getStore();
  },
  getCorrelationId(): string | undefined {
    return als.getStore()?.correlationId;
  },
  /** Run `fn` with the given correlation fields bound to the current
   *  async context. Used by the HTTP request hook AND by worker
   *  entry points (which generate their own correlation id for each
   *  job they pick up). */
  run<T>(fields: CorrelationFields, fn: () => T): T {
    return als.run(fields, fn);
  },
  /** Fastify-friendly variant — use from an `onRequest` hook where we
   *  can't wrap the downstream handler in a callback. enterWith makes
   *  the store visible to subsequent async work on the same chain. */
  enterWith(fields: CorrelationFields): void {
    als.enterWith(fields);
  },
  /** Mutate the current store in place — used by AuthMiddleware once
   *  the JWT has been verified and we know which tenant/user owns
   *  this request. Returns false if there's no active store (e.g.
   *  call from boot path). */
  enrich(fields: Partial<Omit<CorrelationFields, "correlationId">>): boolean {
    const store = als.getStore();
    if (!store) return false;
    Object.assign(store, fields);
    return true;
  },
};
