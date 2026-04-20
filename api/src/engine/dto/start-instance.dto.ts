import { IsObject, IsOptional } from "class-validator";

export class StartInstanceDto {
  /** Optional initial variables bag merged into the new instance.
   *  E4 gateway conditions evaluate against this; E2 just stores it. */
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}
