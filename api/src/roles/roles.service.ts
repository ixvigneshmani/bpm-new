import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, Database } from "../database/database.module";
import { roles, userRoles, users } from "../database/schema";
import { CreateRoleDto } from "./dto/create-role.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";

@Injectable()
export class RolesService {
  constructor(@Inject(DATABASE) private db: Database) {}

  async list(tenantId: string) {
    return this.db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(roles.key);
  }

  async create(tenantId: string, dto: CreateRoleDto) {
    const existing = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, dto.key)))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException(`Role with key "${dto.key}" already exists`);
    }
    const [row] = await this.db
      .insert(roles)
      .values({
        tenantId,
        key: dto.key,
        label: dto.label,
        description: dto.description ?? null,
        system: false,
      })
      .returning();
    return row;
  }

  async update(tenantId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.findOneOrThrow(tenantId, roleId);
    const patch: Record<string, unknown> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.description !== undefined) patch.description = dto.description;
    if (Object.keys(patch).length === 0) return role;
    const [updated] = await this.db
      .update(roles)
      .set(patch)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
      .returning();
    return updated;
  }

  async remove(tenantId: string, roleId: string) {
    const role = await this.findOneOrThrow(tenantId, roleId);
    if (role.system) {
      throw new ForbiddenException(
        "System roles (manager/employee/finance) cannot be deleted",
      );
    }
    const assignments = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId))
      .limit(1);
    if (assignments.length > 0) {
      throw new ConflictException(
        "Role has active user assignments — revoke them first",
      );
    }
    await this.db
      .delete(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)));
    return { deleted: true };
  }

  async assign(
    tenantId: string,
    roleId: string,
    targetUserId: string,
    assignedBy: string,
  ) {
    await this.findOneOrThrow(tenantId, roleId);
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, targetUserId)))
      .limit(1);
    if (!user) {
      throw new NotFoundException("User not found in this tenant");
    }
    const existing = await this.db
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          eq(userRoles.roleId, roleId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return { assigned: false, alreadyHeld: true };
    }
    await this.db.insert(userRoles).values({
      userId: targetUserId,
      roleId,
      tenantId,
      assignedBy,
    });
    return { assigned: true };
  }

  async revoke(tenantId: string, roleId: string, targetUserId: string) {
    await this.findOneOrThrow(tenantId, roleId);
    const res = await this.db
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.tenantId, tenantId),
        ),
      )
      .returning();
    if (res.length === 0) {
      throw new NotFoundException("User does not hold this role");
    }
    return { revoked: true };
  }

  /** Members of a role — used by admin UI. */
  async members(tenantId: string, roleId: string) {
    await this.findOneOrThrow(tenantId, roleId);
    return this.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        assignedAt: userRoles.assignedAt,
      })
      .from(userRoles)
      .innerJoin(users, eq(userRoles.userId, users.id))
      .where(eq(userRoles.roleId, roleId));
  }

  private async findOneOrThrow(tenantId: string, roleId: string) {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Role not found");
    }
    return row;
  }
}
