import { IsOptional, IsString, MaxLength } from "class-validator";

export class CancelInstanceDto {
  /** Optional human-readable reason recorded in the audit row +
   *  surfaced on the instance detail page. Shown back to anyone
   *  inspecting why the instance terminated early. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
