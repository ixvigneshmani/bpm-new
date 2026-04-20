import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineController } from "./engine.controller";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";
import { InstancesController } from "./instances.controller";
import { TasksController } from "./tasks.controller";

@Module({
  imports: [AuthModule],
  controllers: [EngineController, InstancesController, TasksController],
  providers: [EngineService, IdempotencyService],
  exports: [EngineService],
})
export class EngineModule {}
