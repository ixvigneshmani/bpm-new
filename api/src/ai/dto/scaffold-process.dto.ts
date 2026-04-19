import { IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Request body for POST /ai/scaffold-process.
 *
 *  `description` is the analyst's plain-language brief — e.g. "3-step
 *  invoice approval with manager, finance, and director review, escalate
 *  if no response in 48h." The service passes this to Claude with a
 *  structured-output tool that returns a canvas-ready {nodes, edges}
 *  payload.
 *
 *  `businessDocSchema` (optional) is the process's business-document
 *  JSON Schema (if already defined). Providing it lets the model use
 *  real variable names in gateway conditions + mappings.
 */
export class ScaffoldProcessDto {
  @IsString()
  @MinLength(8, { message: "Description must be at least 8 characters." })
  @MaxLength(4000, { message: "Description must be at most 4000 characters." })
  description!: string;

  @IsOptional()
  @IsObject()
  businessDocSchema?: Record<string, unknown>;
}
