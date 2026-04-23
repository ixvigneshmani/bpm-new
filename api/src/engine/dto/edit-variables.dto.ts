import { IsObject, IsString, MaxLength, MinLength } from "class-validator";

/** Admin variable-edit payload. Every edit requires a `reason` (min
 *  3 chars) so the audit trail answers "why was this changed?" for
 *  compliance. Matches Camunda's admin intent but makes the reason
 *  mandatory rather than optional metadata. */
export class EditVariablesDto {
  @IsObject()
  patch: Record<string, unknown>;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
