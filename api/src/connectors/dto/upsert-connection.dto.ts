import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateConnectionDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,63}$/, {
    message:
      "connectorType must be lowercase, start with a letter, and contain only letters/digits/underscore/dash (max 64 chars).",
  })
  connectorType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** Plaintext config keyed by field names declared in the connector's
   *  connectionSchema. The service encrypts secret fields per the
   *  definition's `secretFields` list before persisting. */
  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class TestConnectionDto {
  /** Operator-supplied input matching the connector's testAction
   *  inputSchema. Free-form object — runtime shape check happens
   *  inside the test handler. */
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}
