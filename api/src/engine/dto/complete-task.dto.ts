import { IsObject, IsOptional } from "class-validator";

export class CompleteTaskDto {
  /** Form output to merge into the instance variable bag. Optional —
   *  some user tasks just gate on "did the human acknowledge?" with
   *  no data to capture. */
  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;
}
