import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ProcessesModule } from "./processes/processes.module";

const env = process.env.NODE_ENV || "development";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${env}`,
    }),
    DatabaseModule,
    AuthModule,
    UsersModule,
    ProcessesModule,
  ],
})
export class AppModule {}
