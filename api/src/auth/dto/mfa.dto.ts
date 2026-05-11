import { IsNotEmpty, IsString } from "class-validator";

export class MfaCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class MfaLoginDto {
  @IsString()
  @IsNotEmpty()
  mfaChallenge!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}
