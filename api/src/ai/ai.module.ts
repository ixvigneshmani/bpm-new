import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineModule } from "../engine/engine.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  // EngineModule exported EngineService; AI controller uses it to load
  // instance context for the analyze-instance endpoint. Engine does
  // not depend on AI, so no forwardRef needed.
  imports: [AuthModule, EngineModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
