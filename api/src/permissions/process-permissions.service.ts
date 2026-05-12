import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import * as schema from "../database/schema";
import { CorrelationContext } from "../common/observability/correlation-context";

export type ProcessPermission =
  | "view"
  | "start"
  | "edit"
  | "publish"
  | "admin";

export type GranteeType = "user" | "role";

/** Hierarchy: holding a higher permission implies the lower ones.
 *  `start` is intentionally orthogonal — you can start without
 *  being able to edit. */
const IMPLIES: Record<ProcessPermission, ProcessPermission[]> = {
  admin: ["admin", "publish", "edit", "view", "start"],
  publish: ["publish", "edit", "view"],
  edit: ["edit", "view"],
  view: ["view"],
  start: ["start"],
};

interface CallerContext {
  userId: string;
  tenantId: string;
  systemRole: string;
  roles: string[];
}

@Injectable()
export class ProcessPermissionsService {
  constructor(
    @Inject(DATABASE) private db: Database,
  ) {}

  /** Returns true if the caller may perform `permission` on the
   *  process. Owners and admins always pass. Otherwise: explicit
   *  user grants > role grants > defaults (view + start open;
   *  edit/publish/admin deny). */
  async can(
    caller: CallerContext,
    processId: string,
    permission: ProcessPermission,
  ): Promise<boolean> {
    if (caller.systemRole === "owner" || caller.systemRole === "admin") {
      return true;
    }

    const grants = await this.db
      .select({ permission: schema.processPermissions.permission })
      .from(schema.processPermissions)
      .where(
        and(
          eq(schema.processPermissions.tenantId, caller.tenantId),
          eq(schema.processPermissions.processId, processId),
        ),
      );

    const granteeMatches = await this.db
      .select({
        permission: schema.processPermissions.permission,
        granteeType: schema.processPermissions.granteeType,
        granteeId: schema.processPermissions.granteeId,
      })
      .from(schema.processPermissions)
      .where(
        and(
          eq(schema.processPermissions.tenantId, caller.tenantId),
          eq(schema.processPermissions.processId, processId),
        ),
      );

    const heldPerms = new Set<ProcessPermission>();
    for (const g of granteeMatches) {
      const isUserGrant =
        g.granteeType === "user" && g.granteeId === caller.userId;
      const isRoleGrant =
        g.granteeType === "role" && caller.roles.includes(g.granteeId);
      if (isUserGrant || isRoleGrant) {
        for (const implied of IMPLIES[g.permission as ProcessPermission]) {
          heldPerms.add(implied);
        }
      }
    }

    if (heldPerms.has(permission)) return true;

    // Default policy when there are NO grants on this process: keep
    // current behaviour — view + start open to all tenant members.
    // Once any grant exists, the process is "restricted" and only
    // explicit grants + system admins see it.
    if (grants.length === 0 && (permission === "view" || permission === "start")) {
      return true;
    }

    return false;
  }

  /** Return the full set of permissions the caller effectively holds
   *  on this process — used by the UI to lock read-only canvases and
   *  hide actions the user can't perform. Same precedence as `can`.
   *
   *  M7 — single SQL round trip instead of 5 sequential `can()` calls.
   *  Reads the grant rows once, expands the implication hierarchy in
   *  JS, applies the default-open policy when no grant exists. */
  async effective(
    caller: CallerContext,
    processId: string,
  ): Promise<ProcessPermission[]> {
    const all: ProcessPermission[] = ["view", "start", "edit", "publish", "admin"];
    if (caller.systemRole === "owner" || caller.systemRole === "admin") {
      return [...all];
    }
    const rows = await this.db
      .select({
        permission: schema.processPermissions.permission,
        granteeType: schema.processPermissions.granteeType,
        granteeId: schema.processPermissions.granteeId,
      })
      .from(schema.processPermissions)
      .where(
        and(
          eq(schema.processPermissions.tenantId, caller.tenantId),
          eq(schema.processPermissions.processId, processId),
        ),
      );

    const held = new Set<ProcessPermission>();
    let anyGrantExists = false;
    for (const r of rows) {
      anyGrantExists = true;
      const isUserGrant =
        r.granteeType === "user" && r.granteeId === caller.userId;
      const isRoleGrant =
        r.granteeType === "role" && caller.roles.includes(r.granteeId);
      if (isUserGrant || isRoleGrant) {
        for (const implied of IMPLIES[r.permission as ProcessPermission]) {
          held.add(implied);
        }
      }
    }

    // Default-open policy when there are no grants on the process:
    // view + start are available to all tenant members. Mirrors `can()`.
    if (!anyGrantExists) {
      held.add("view");
      held.add("start");
    }

    return all.filter((p) => held.has(p));
  }

  /** Throwing variant used in controller bodies. */
  async assert(
    caller: CallerContext,
    processId: string,
    permission: ProcessPermission,
  ): Promise<void> {
    const ok = await this.can(caller, processId, permission);
    if (!ok) {
      throw new ForbiddenException(
        `You do not have '${permission}' permission on this process.`,
      );
    }
  }

  /** Filter a list of process ids down to those the caller may view.
   *  Used by GET /processes so admins see everything, members see
   *  unrestricted + explicitly-granted. */
  async filterVisible(
    caller: CallerContext,
    processIds: string[],
  ): Promise<Set<string>> {
    if (caller.systemRole === "owner" || caller.systemRole === "admin") {
      return new Set(processIds);
    }
    if (processIds.length === 0) return new Set();

    const rows = await this.db
      .select({
        processId: schema.processPermissions.processId,
        granteeType: schema.processPermissions.granteeType,
        granteeId: schema.processPermissions.granteeId,
        permission: schema.processPermissions.permission,
      })
      .from(schema.processPermissions)
      .where(
        and(
          eq(schema.processPermissions.tenantId, caller.tenantId),
          inArray(schema.processPermissions.processId, processIds),
        ),
      );

    const restricted = new Set<string>();
    const grantedToCaller = new Set<string>();
    for (const r of rows) {
      restricted.add(r.processId);
      const isUserGrant =
        r.granteeType === "user" && r.granteeId === caller.userId;
      const isRoleGrant =
        r.granteeType === "role" && caller.roles.includes(r.granteeId);
      if (isUserGrant || isRoleGrant) {
        // Any grant implies at least `view` (start implies start only,
        // but start callers should still see the process in their list).
        grantedToCaller.add(r.processId);
      }
    }

    const visible = new Set<string>();
    for (const id of processIds) {
      if (!restricted.has(id) || grantedToCaller.has(id)) {
        visible.add(id);
      }
    }
    return visible;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  async list(tenantId: string, processId: string) {
    return this.db
      .select()
      .from(schema.processPermissions)
      .where(
        and(
          eq(schema.processPermissions.tenantId, tenantId),
          eq(schema.processPermissions.processId, processId),
        ),
      );
  }

  async grant(params: {
    tenantId: string;
    processId: string;
    granteeType: GranteeType;
    granteeId: string;
    permission: ProcessPermission;
    grantedBy: string;
  }) {
    // Validate process exists & belongs to tenant.
    const [process] = await this.db
      .select({ id: schema.processes.id })
      .from(schema.processes)
      .where(
        and(
          eq(schema.processes.id, params.processId),
          eq(schema.processes.tenantId, params.tenantId),
        ),
      );
    if (!process) throw new NotFoundException("Process not found");

    // Validate grantee.
    if (params.granteeType === "user") {
      const [user] = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.id, params.granteeId),
            eq(schema.users.tenantId, params.tenantId),
          ),
        );
      if (!user)
        throw new BadRequestException("Grantee user not found in tenant");
    } else if (params.granteeType === "role") {
      const [role] = await this.db
        .select({ key: schema.roles.key })
        .from(schema.roles)
        .where(
          and(
            eq(schema.roles.key, params.granteeId),
            eq(schema.roles.tenantId, params.tenantId),
          ),
        );
      if (!role) throw new BadRequestException("Grantee role not found");
    } else {
      throw new BadRequestException("Invalid granteeType");
    }

    try {
      const [row] = await this.db
        .insert(schema.processPermissions)
        .values({
          tenantId: params.tenantId,
          processId: params.processId,
          granteeType: params.granteeType,
          granteeId: params.granteeId,
          permission: params.permission,
          grantedBy: params.grantedBy,
        })
        .returning();
      // H1 — append-only audit row. Insert in the same try block so a
      // failed grant doesn't leave a phantom audit entry, but we don't
      // wrap in a Drizzle transaction since the grant insert is the
      // unique-key check and if it succeeds the audit row is best-effort
      // (a noisy log + retry is preferable to refusing the user's grant
      // because the audit write hiccuped).
      await this.db.insert(schema.permissionAuditEvents).values({
        tenantId: params.tenantId,
        processId: params.processId,
        action: "granted",
        granteeType: params.granteeType,
        granteeId: params.granteeId,
        permission: params.permission,
        actorUserId: params.grantedBy,
        correlationId: CorrelationContext.getCorrelationId() ?? null,
      });
      return row;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "23505"
      ) {
        throw new ConflictException("Grant already exists");
      }
      throw err;
    }
  }

  async revoke(params: {
    tenantId: string;
    processId: string;
    grantId: string;
    actorUserId: string;
  }) {
    const [deleted] = await this.db
      .delete(schema.processPermissions)
      .where(
        and(
          eq(schema.processPermissions.id, params.grantId),
          eq(schema.processPermissions.tenantId, params.tenantId),
          eq(schema.processPermissions.processId, params.processId),
        ),
      )
      .returning();
    if (!deleted) throw new NotFoundException("Grant not found");
    // H1 — record the revoke. Capture the same grantee/permission
    // shape we just deleted so the audit row stands alone without
    // needing to join back.
    await this.db.insert(schema.permissionAuditEvents).values({
      tenantId: params.tenantId,
      processId: params.processId,
      action: "revoked",
      granteeType: deleted.granteeType,
      granteeId: deleted.granteeId,
      permission: deleted.permission,
      actorUserId: params.actorUserId,
      correlationId: CorrelationContext.getCorrelationId() ?? null,
    });
    return { revoked: true };
  }

  /** H1 — read the audit trail for a process. Used by the Permissions
   *  page's "History" tab (UX comes in a later sprint; the endpoint is
   *  available now). Newest first, capped at 200 — pagination later
   *  if it ever fills up. */
  async listAudit(tenantId: string, processId: string) {
    return this.db
      .select({
        id: schema.permissionAuditEvents.id,
        action: schema.permissionAuditEvents.action,
        granteeType: schema.permissionAuditEvents.granteeType,
        granteeId: schema.permissionAuditEvents.granteeId,
        permission: schema.permissionAuditEvents.permission,
        actorUserId: schema.permissionAuditEvents.actorUserId,
        actorName: schema.users.displayName,
        correlationId: schema.permissionAuditEvents.correlationId,
        createdAt: schema.permissionAuditEvents.createdAt,
      })
      .from(schema.permissionAuditEvents)
      .leftJoin(
        schema.users,
        eq(schema.users.id, schema.permissionAuditEvents.actorUserId),
      )
      .where(
        and(
          eq(schema.permissionAuditEvents.tenantId, tenantId),
          eq(schema.permissionAuditEvents.processId, processId),
        ),
      )
      .orderBy(schema.permissionAuditEvents.createdAt)
      .limit(200);
  }
}
