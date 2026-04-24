import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { EngineModule } from "../engine/engine.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { createLlmProvider, LlmProvider } from "./providers";

/** Token used for LLM provider dependency injection. Consumers ask
 *  for it via `@Inject(LLM_PROVIDER)` rather than importing a
 *  concrete class, so tests can stub it without touching the real
 *  Anthropic / fetch code paths. */
export const LLM_PROVIDER = Symbol("LLM_PROVIDER");

@Module({
  // EngineModule exported EngineService; AI controller uses it to load
  // instance context for the analyze-instance endpoint. Engine does
  // not depend on AI, so no forwardRef needed.
  imports: [AuthModule, EngineModule],
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmProvider => createLlmProvider(config),
    },
  ],
  exports: [LLM_PROVIDER],
})
export class AiModule {}
