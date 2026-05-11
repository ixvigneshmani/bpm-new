/* ─── Act-as impersonation resolver ────────────────────────────────────
 * Usage from a controller:
 *
 *   const effective = await resolveActingFor(req, this.users);
 *
 * If the admin passed `X-Acting-For: <userId>`, `effective.userId` is
 * the TARGET user and `effective.actingBy` is the admin's id; every
 * mutation uses `effective.userId` for business logic and stamps
 * `actingBy` on every audit row. If no header, the helper returns
 * `{ userId: req.user.sub, actingBy: null }` — transparent no-op.
 *
 * Why not a Nest guard or interceptor? The per-request cost is a
 * single user lookup, and leaving it as an explicit call site makes
 * the impersonation opt-in per endpoint — we DON'T want edit-vars or
 * claim to accidentally impersonate without the controller knowing.
 * Industry products (Camunda, Flowable) sometimes bake impersonation
 * into their JWT via an `act` claim; we chose an explicit per-request
 * header so auditors can trace the exact HTTP call.
 * ──────────────────────────────────────────────────────────────────── */

import { BadRequestException, ForbiddenException, Logger } from "@nestjs/common";
import { UsersService } from "../users/users.service";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";

const logger = new Logger("ActingFor");

export type EffectiveActor = {
  /** The user id to use for business logic. If no impersonation,
   *  equals the JWT subject. */
  userId: string;
  /** The admin's id, set only when impersonating. Stamp on audit. */
  actingBy: string | null;
  /** Roles for authorization checks — target's roles when
   *  impersonating, caller's roles otherwise. Example: claimTask
   *  requires the CANDIDATE_ROLE to be held by the EFFECTIVE user,
   *  not the admin. */
  roles: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveActingFor(
  req: AuthenticatedRequest,
  users: UsersService,
): Promise<EffectiveActor> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headers = (req as any).headers as Record<string, string | undefined> | undefined;
  const raw = headers?.["x-acting-for"] ?? headers?.["X-Acting-For"];
  if (!raw || raw.trim() === "") {
    return {
      userId: req.user.sub,
      actingBy: null,
      roles: req.user.roles ?? [],
    };
  }
  const actingForId = raw.trim();
  if (!UUID_RE.test(actingForId)) {
    throw new BadRequestException("X-Acting-For must be a UUID.");
  }
  // Only platform admins/owners may impersonate. This is the hard
  // policy: tenant members can't impersonate each other even with a
  // crafted header.
  if (req.user.systemRole !== "owner" && req.user.systemRole !== "admin") {
    throw new ForbiddenException(
      "Only owner / admin users may impersonate via X-Acting-For.",
    );
  }
  // Guard: can't impersonate self — harmless but signals confusion.
  if (actingForId === req.user.sub) {
    throw new BadRequestException(
      "X-Acting-For targets yourself — drop the header.",
    );
  }
  const target = await users.findById(actingForId);
  // Collapse "not found", "different tenant", "inactive" into a SINGLE
  // 403 with a deliberately-generic message. Distinguishing between
  // them lets an admin enumerate which UUIDs correspond to real users
  // (404) versus cross-tenant users (403) — minor info leak, but a
  // red flag in any security review.
  if (!target || target.tenantId !== req.user.tenantId || !target.isActive) {
    throw new ForbiddenException(
      "Impersonation target is not available.",
    );
  }
  const roles = await users.getRoleKeys(target.id);
  req.actingFor = {
    userId: target.id,
    email: target.email,
    displayName: target.displayName,
    roles,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = req as any;
  const method = r.method ?? r.raw?.method ?? "?";
  const url = r.url ?? r.raw?.url ?? "?";
  const ip = r.ip ?? "?";
  logger.warn(
    `acting-for: actor=${req.user.sub} target=${target.id} method=${method} url=${url} ip=${ip}`,
  );

  return {
    userId: target.id,
    actingBy: req.user.sub,
    roles,
  };
}
