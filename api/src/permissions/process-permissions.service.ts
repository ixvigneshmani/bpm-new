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
   *  hide actions the user can't perform. Same precedence as `can`. */
  async effective(
    caller: CallerContext,
    processId: string,
  ): Promise<ProcessPermission[]> {
    const all: ProcessPermission[] = ["view", "start", "edit", "publish", "admin"];
    const held: ProcessPermission[] = [];
    for (const p of all) {
      if (await this.can(caller, processId, p)) held.push(p);
    }
    return held;
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
    return { revoked: true };
  }
}
