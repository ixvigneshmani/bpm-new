import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class CreateProcessDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}
