import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineController } from "./engine.controller";
import { EngineService } from "./engine.service";

@Module({
  imports: [AuthModule],
  controllers: [EngineController],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
