import { Injectable, Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, Database } from "../database/database.module";
import { users, userRoles, roles } from "../database/schema";

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private db: Database) {}

  async findByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmailAndTenant(email: string, tenantId: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const user = rows[0] ?? null;
    if (user && user.tenantId !== tenantId) return null;
    return user;
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** List tenant users for the Act-as impersonation picker. Returns
   *  only the fields the picker needs; pulls role keys per user with
   *  an IN-list join so the admin can see "who holds manager" without
   *  a follow-up query. */
  async listForTenant(tenantId: string): Promise<Array<{
    id: string;
    email: string;
    displayName: string;
    isActive: boolean;
    systemRole: string;
    roles: string[];
  }>> {
    const us = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isActive: users.isActive,
        systemRole: users.role,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId));
    // One-pass role join — N users × M roles is fine at tenant scale.
    const roleRows = await this.db
      .select({ userId: userRoles.userId, key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.tenantId, tenantId));
    const rolesByUser = new Map<string, string[]>();
    for (const r of roleRows) {
      const arr = rolesByUser.get(r.userId) ?? [];
      arr.push(r.key);
      rolesByUser.set(r.userId, arr);
    }
    return us.map((u) => ({ ...u, roles: rolesByUser.get(u.id) ?? [] }));
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId));
  }

  /** Domain role keys held by a user (e.g. ["manager", "finance"]). */
  async getRoleKeys(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return rows.map((r) => r.key);
  }
}
