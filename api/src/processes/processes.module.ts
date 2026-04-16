import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProcessesController } from "./processes.controller";
import { ProcessesService } from "./processes.service";

@Module({
  imports: [AuthModule],
  controllers: [ProcessesController],
  providers: [ProcessesService],
  exports: [ProcessesService],
})
export class ProcessesModule {}
