import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
} from "class-validator";
import { Transform } from "class-transformer";

const NO_HTML_TAGS = /^[^<>]*$/;

export class UpdateProcessDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(NO_HTML_TAGS, {
    message: "name must not contain '<' or '>'",
  })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}
