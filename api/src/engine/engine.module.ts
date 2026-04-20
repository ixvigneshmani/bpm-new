import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineController } from "./engine.controller";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";
import { InstancesController } from "./instances.controller";
import { TasksController } from "./tasks.controller";
import { WorkerService } from "./worker.service";

@Module({
  imports: [AuthModule],
  controllers: [EngineController, InstancesController, TasksController],
  providers: [EngineService, IdempotencyService, WorkerService],
  exports: [EngineService, WorkerService],
})
export class EngineModule {}
