/* ─── Messages Controller ────────────────────────────────────────────
 * P3 Session 7 — public delivery endpoint for intermediate
 * message-catch events.
 *
 *   POST /api/messages
 *     body: { name, correlationKey, payload?, idempotencyKey? }
 *
 * Looks up a parked subscription, merges payload into instance
 * variables, resumes the token. 404 if no subscription matches —
 * sender's responsibility to retry (we don't buffer; same model as
 * Camunda 8 / Flowable).
 *
 * Auth: JWT-guarded like every other engine endpoint. Tenant comes
 * from the JWT, NOT the body, so a token for tenant A can't deliver
 * into tenant B.
 *
 * Idempotency: in-memory Map keyed by
 * (tenantId, name, correlationKey, payloadHash). 10-minute TTL. Lives
 * in the API process; loses state on restart. Acceptable for v1 — the
 * worst case is one extra resume across a restart, and the host
 * presumably already tolerates that for their own retry logic. Promote
 * to Redis-backed when we add the inbound-broker connectors.
 * ──────────────────────────────────────────────────────────────────── */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { EngineService } from "./engine.service";

/** In-process idempotency cache. Key = sha256 of
 *  `${tenantId}|${name}|${correlationKey}|${stableJson(payload)}`.
 *  Value = result we returned last time, so a retry returns the same
 *  shape (no double resume, no audit row, no 404 from a stale lookup
 *  if the original delivery already drained the subscription). */
type CachedDelivery = {
  result: DeliverResult;
  expiresAt: number;
};
type DeliverResult =
  | {
      outcome: "delivered";
      instanceId: string;
      instanceStatus: "running" | "completed" | "failed";
      tokenStatus: "completed" | "waiting" | "failed";
    }
  | { outcome: "no-subscription" };

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

interface DeliverDto {
  name?: unknown;
  correlationKey?: unknown;
  payload?: unknown;
  idempotencyKey?: unknown;
}

@Controller("messages")
@UseGuards(JwtAuthGuard)
export class MessagesController {
  // Map insertion order = expiry order (TTL constant), so we can sweep
  // the head cheaply on every write.
  private readonly cache = new Map<string, CachedDelivery>();

  constructor(private readonly engine: EngineService) {}

  @Post()
  @HttpCode(200)
  async deliver(
    @Req() req: AuthenticatedRequest,
    @Body() body: DeliverDto,
  ) {
    const tenantId = req.user.tenantId;

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new BadRequestException("`name` is required.");
    }
    if (
      typeof body.correlationKey !== "string" ||
      body.correlationKey.trim().length === 0
    ) {
      throw new BadRequestException("`correlationKey` is required.");
    }
    if (
      body.payload !== undefined &&
      (typeof body.payload !== "object" ||
        body.payload === null ||
        Array.isArray(body.payload))
    ) {
      throw new BadRequestException(
        "`payload` must be a JSON object if provided.",
      );
    }
    const name = body.name.trim();
    const correlationKey = body.correlationKey.trim();
    const payload = (body.payload ?? undefined) as
      | Record<string, unknown>
      | undefined;

    this.sweepExpired();
    const cacheKey = this.buildCacheKey(tenantId, name, correlationKey, payload);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Replay the last *successful* response. We do NOT cache 404s —
      // a retry-after-failure should attempt fresh, because the
      // subscription may have arrived in the meantime. Idempotency
      // protects against double-delivery; it shouldn't lock out a host
      // that retried before the subscription was committed.
      return cached.result;
    }

    const result = await this.engine.deliverMessage({
      tenantId,
      messageName: name,
      correlationKey,
      payload,
    });

    if (result.outcome === "no-subscription") {
      // Do not cache. 404s are transient.
      throw new NotFoundException(
        `No subscription for ${name} / ${correlationKey}.`,
      );
    }

    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
    return result;
  }

  private buildCacheKey(
    tenantId: string,
    name: string,
    correlationKey: string,
    payload: Record<string, unknown> | undefined,
  ): string {
    const stable = payload ? stableJsonStringify(payload) : "";
    return createHash("sha256")
      .update(`${tenantId}|${name}|${correlationKey}|${stable}`)
      .digest("hex");
  }

  /** Drop expired entries. Cheap O(n) walk; the cache stays small
   *  because the TTL is short and our throughput isn't message-broker
   *  scale (that's a different feature — see Inbound Broker Connectors). */
  private sweepExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
      else break; // Map insertion order = expiry order (TTL constant).
    }
  }
}

/** Stable stringify so {a:1,b:2} and {b:2,a:1} hash to the same key. */
function stableJsonStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJsonStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableJsonStringify(obj[k])}`)
    .join(",")}}`;
}
