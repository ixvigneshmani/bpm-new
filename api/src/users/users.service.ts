import { Injectable, Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, Database } from "../database/database.module";
import { users } from "../database/schema";

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
}
