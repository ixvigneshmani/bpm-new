import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

/** Body for POST /ai/analyze-instance. A BPM operator's natural-
 *  language question about a specific process instance; the service
 *  loads the instance state, canvas, and audit events and calls
 *  Claude to produce a short markdown analysis.
 *
 *  Admin-only at the controller level so random tenant members
 *  don't rack up AI spend. */
export class AnalyzeInstanceDto {
  @IsUUID()
  instanceId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  question: string;
}
