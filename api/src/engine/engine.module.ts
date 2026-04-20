import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CleanupService } from "./cleanup.service";
import { EngineController } from "./engine.controller";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";
import { InstancesController } from "./instances.controller";
import { OutboxService } from "./outbox.service";
import { ServiceTaskRegistry } from "./service-task-registry";
import { ServiceTaskService } from "./service-task.service";
import { TasksController } from "./tasks.controller";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { WorkerService } from "./worker.service";

@Module({
  imports: [AuthModule],
  controllers: [
    EngineController,
    InstancesController,
    TasksController,
    WebhooksController,
  ],
  providers: [
    EngineService,
    IdempotencyService,
    WorkerService,
    CleanupService,
    OutboxService,
    WebhooksService,
    ServiceTaskRegistry,
    ServiceTaskService,
  ],
  exports: [EngineService, WorkerService, ServiceTaskRegistry],
})
export class EngineModule {}
