import { IsOptional, IsString, MaxLength } from "class-validator";

export class SuspendInstanceDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
