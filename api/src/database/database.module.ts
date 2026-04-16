import { Module, Global, OnModuleDestroy, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const DATABASE = Symbol("DATABASE");
export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: "PG_POOL",
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Pool({ connectionString: config.getOrThrow<string>("DATABASE_URL") });
      },
    },
    {
      provide: DATABASE,
      inject: ["PG_POOL"],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject("PG_POOL") private pool: Pool) {}
  async onModuleDestroy() { await this.pool.end(); }
}
