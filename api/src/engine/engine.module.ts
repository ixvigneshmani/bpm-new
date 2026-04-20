import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineController } from "./engine.controller";
import { EngineService } from "./engine.service";
import { TasksController } from "./tasks.controller";

@Module({
  imports: [AuthModule],
  controllers: [EngineController, TasksController],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
