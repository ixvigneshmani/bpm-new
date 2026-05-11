import { Module } from "@nestjs/common";
import { ProcessPermissionsService } from "./process-permissions.service";

@Module({
  providers: [ProcessPermissionsService],
  exports: [ProcessPermissionsService],
})
export class PermissionsModule {}
