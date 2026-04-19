import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/** Minimal canvas snapshot the refine flow sends to Claude. We only
 *  shape-validate at the boundary; the service re-serializes and
 *  guards against oversize before putting it in the prompt. */
export class CanvasSnapshotDto {
  @IsArray()
  nodes!: Array<Record<string, unknown>>;

  @IsArray()
  edges!: Array<Record<string, unknown>>;
}

export class RefineProcessDto {
  @IsString()
  @MinLength(8, { message: "Description must be at least 8 characters." })
  @MaxLength(4000, { message: "Description must be at most 4000 characters." })
  description!: string;

  @ValidateNested()
  @Type(() => CanvasSnapshotDto)
  @IsObject()
  currentCanvas!: CanvasSnapshotDto;

  @IsOptional()
  @IsObject()
  businessDocSchema?: Record<string, unknown>;
}
