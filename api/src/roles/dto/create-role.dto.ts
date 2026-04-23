import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
} from "class-validator";
import { Transform } from "class-transformer";

export class CreateRoleDto {
  /** Stable identifier used in JWT + expressions. Lowercase kebab/snake
   *  letters + digits only so it's safe in URLs and token claims. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_-]*$/, {
    message: "key must be lowercase, start with a letter, and contain only letters/digits/underscore/dash",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  label: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}
