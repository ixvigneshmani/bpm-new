import { IsOptional, IsString, MaxLength } from "class-validator";

export class SkipTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
