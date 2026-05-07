/* ─── Import bundle DTO (D1.0) ──────────────────────────────────────
 * Validates the .flowpro.json bundle posted to /processes/import.
 * Mirrors ProcessExportBundle from engine.service.ts but defined as a
 * class with class-validator decorators for runtime validation.
 *
 * The schema is permissive on the inner canvas/businessDoc fields
 * because those are jsonb on the destination side and the engine
 * does its own structural validation when the process eventually
 * runs. We only enforce the envelope.
 * ──────────────────────────────────────────────────────────────────── */

import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { SLUG_PATTERN } from "../slugify";

class ImportBundleProcess {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(SLUG_PATTERN, {
    message: "process.slug must be a valid kebab-case slug",
  })
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  /** Source-env version number. Stored on the destination version
   *  row's IMPORTED_FROM payload for traceability; the destination
   *  assigns its own monotonic version. */
  @IsInt()
  @Min(1)
  version!: number;

  @IsString()
  @MaxLength(64)
  hash!: string;

  @IsObject()
  canvas!: Record<string, unknown>;

  @IsOptional()
  businessDoc?: Record<string, unknown> | null;
}

export class ImportProcessDto {
  @IsIn(["flowpro/v1"], {
    message: "Unsupported bundle format. Expected flowpro/v1.",
  })
  format!: "flowpro/v1";

  @IsString()
  exportedAt!: string;

  @IsObject()
  exportedFrom!: { tenantId: string; tenantName: string | null };

  @ValidateNested()
  @Type(() => ImportBundleProcess)
  process!: ImportBundleProcess;

  @IsOptional()
  @IsObject()
  envBindings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
