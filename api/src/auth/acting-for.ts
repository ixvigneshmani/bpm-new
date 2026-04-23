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

import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { UsersService } from "../users/users.service";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";

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
  if (!target) {
    throw new NotFoundException("Impersonation target user not found.");
  }
  // Tenant isolation: admins can't act-as a user in a different tenant
  // even though the JWT's systemRole might technically span. Hard
  // boundary for compliance.
  if (target.tenantId !== req.user.tenantId) {
    throw new ForbiddenException(
      "Impersonation target is in a different tenant.",
    );
  }
  if (!target.isActive) {
    throw new BadRequestException(
      "Impersonation target is deactivated.",
    );
  }
  const roles = await users.getRoleKeys(target.id);
  req.actingFor = {
    userId: target.id,
    email: target.email,
    displayName: target.displayName,
    roles,
  };
  return {
    userId: target.id,
    actingBy: req.user.sub,
    roles,
  };
}
