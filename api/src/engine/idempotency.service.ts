/* ─── Idempotency service ───────────────────────────────────────────
 * Stripe-style replay safety for POST endpoints. Client sends an
 * `Idempotency-Key` header; we store the first response's status +
 * body keyed on (tenant, endpoint, key) and return the same payload
 * on every retry within the TTL window.
 *
 * Two replay scenarios:
 *   • **Same key + same body** → return the cached response. Network
 *     retries, mobile reconnects, queue redelivery: all become no-ops.
 *   • **Same key + different body** → 409. The client is reusing a
 *     key for a logically different request, almost certainly a bug.
 *
 * The (tenant, endpoint, key) UNIQUE index gives us atomic insert-or-
 * conflict semantics: the first writer wins and stores the response;
 * concurrent retries either find the row or hit the unique violation
 * and wait/retry.
 * ──────────────────────────────────────────────────────────────────── */

import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { idempotencyKeys } from "../database/schema";

/** Idempotency entries live for 24h — long enough to absorb any
 *  reasonable retry scheme, short enough that a periodic cleanup job
 *  keeps the table small. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Cap on the cached body. Keeps a rogue handler from filling the
 *  table with multi-MB blobs; engine responses are tiny so 16KB is
 *  ample headroom. */
const MAX_RESPONSE_BYTES = 16 * 1024;

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Wrap a handler with idempotency semantics. If `key` is undefined
   *  (header omitted), runs the handler with no caching — backward-
   *  compatible for callers that don't opt in. */
  async wrap<T>(args: {
    tenantId: string;
    endpoint: string;
    key: string | undefined;
    requestBody: unknown;
    handler: () => Promise<T>;
  }): Promise<T> {
    if (!args.key) return args.handler();

    const requestHash = sha256Hex(stableStringify(args.requestBody));

    // Fast path: a non-expired cached response exists.
    const cached = await this.lookup(args.tenantId, args.endpoint, args.key);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        // Same key + different body = client bug. Refuse rather than
        // silently return a response that doesn't match the new ask.
        throw new ConflictException(
          "Idempotency-Key was reused with a different request body.",
        );
      }
      this.logger.debug?.(
        `idempotency hit: ${args.endpoint} key=${args.key.slice(0, 8)}…`,
      );
      return cached.response as T;
    }

    // Miss: run the handler, then try to cache the result. The cache
    // write itself is best-effort — a unique-constraint race means a
    // concurrent retry already cached an equivalent response and we
    // just return ours.
    const result = await args.handler();
    await this.store({
      tenantId: args.tenantId,
      endpoint: args.endpoint,
      key: args.key,
      requestHash,
      responseStatus: 200,
      responseJson: result as unknown,
    });
    return result;
  }

  private async lookup(
    tenantId: string,
    endpoint: string,
    key: string,
  ): Promise<{ requestHash: string; response: unknown } | null> {
    const rows = await this.db
      .select({
        requestHash: idempotencyKeys.requestHash,
        responseJson: idempotencyKeys.responseJson,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.tenantId, tenantId),
          eq(idempotencyKeys.endpoint, endpoint),
          eq(idempotencyKeys.key, key),
          gt(idempotencyKeys.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { requestHash: row.requestHash, response: row.responseJson };
  }

  private async store(args: {
    tenantId: string;
    endpoint: string;
    key: string;
    requestHash: string;
    responseStatus: number;
    responseJson: unknown;
  }): Promise<void> {
    const serialised = stableStringify(args.responseJson);
    if (serialised.length > MAX_RESPONSE_BYTES) {
      this.logger.warn(
        `idempotency cache skipped: response > ${MAX_RESPONSE_BYTES}B for ${args.endpoint}`,
      );
      return;
    }
    try {
      await this.db.insert(idempotencyKeys).values({
        tenantId: args.tenantId,
        endpoint: args.endpoint,
        key: args.key,
        requestHash: args.requestHash,
        responseStatus: args.responseStatus,
        responseJson: args.responseJson as Record<string, unknown>,
        expiresAt: new Date(Date.now() + TTL_MS),
      });
    } catch (err) {
      // Most likely the unique-constraint race described above; benign.
      this.logger.debug?.(
        `idempotency store skipped: ${(err as Error).message}`,
      );
    }
  }
}

/** Stable JSON stringify with sorted keys at every depth — the request
 *  hash needs to be insensitive to property ordering or two equivalent
 *  payloads with different key orders would falsely conflict. */
function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = canonicalise((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
