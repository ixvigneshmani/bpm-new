import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineModule } from "../engine/engine.module";
import { ProcessesController } from "./processes.controller";
import { ProcessesService } from "./processes.service";

@Module({
  imports: [AuthModule, EngineModule],
  controllers: [ProcessesController],
  providers: [ProcessesService],
  exports: [ProcessesService],
})
export class ProcessesModule {}
