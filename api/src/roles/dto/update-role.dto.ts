import { IsString, IsNotEmpty, IsOptional, MaxLength } from "class-validator";
import { Transform } from "class-transformer";

/** Key is intentionally immutable after creation — it's baked into JWTs
 *  and assignment expressions, so a rename would break live processes.
 *  Labels and descriptions are safe to change. */
export class UpdateRoleDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  label?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}
