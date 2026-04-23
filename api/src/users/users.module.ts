import { forwardRef, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  // forwardRef: AuthModule already imports UsersModule (to use
  // UsersService in login). The UsersController now needs
  // JwtAuthGuard from AuthModule, so we close the circle the Nest
  // way with forwardRef.
  imports: [forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
