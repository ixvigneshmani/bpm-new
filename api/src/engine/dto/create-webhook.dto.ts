import {
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateWebhookDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2048)
  url!: string;

  /** Comma-separated event types or "*" for all. Defaults to "*"
   *  server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  eventTypes?: string;

  /** Restrict to events from a single process. Omit for tenant-wide. */
  @IsOptional()
  @IsUUID()
  processId?: string;
}
