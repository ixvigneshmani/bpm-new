import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class UpdateMailSettingsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string | null;

  /** Plaintext password from the form. Sent only when the operator
   *  enters a new one — omitted/null means "keep the stored password
   *  unchanged". The server encrypts via CryptoService before insert. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string | null;

  @IsEmail()
  @MaxLength(255)
  fromEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromName?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
