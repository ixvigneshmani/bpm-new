import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineService } from "./engine.service";

@Module({
  imports: [AuthModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
