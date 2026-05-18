import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class TestSendMailDto {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;
}
