import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineModule } from "../engine/engine.module";
import { PermissionsModule } from "../permissions/permissions.module";
import { ProcessesController } from "./processes.controller";
import { ProcessesService } from "./processes.service";
import { ProcessPermissionsController } from "./process-permissions.controller";

@Module({
  imports: [AuthModule, EngineModule, PermissionsModule],
  controllers: [ProcessesController, ProcessPermissionsController],
  providers: [ProcessesService],
  exports: [ProcessesService],
})
export class ProcessesModule {}
