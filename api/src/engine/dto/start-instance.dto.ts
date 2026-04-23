import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class StartInstanceDto {
  /** Optional initial variables bag merged into the new instance.
   *  E4 gateway conditions evaluate against this; E2 just stores it. */
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  /** Optional host-app correlation key. Stored on PROCESS_INSTANCES
   *  and queryable via `GET /instances?businessKey=…`. Use it to link
   *  a BPM instance to a row in the calling system (e.g. leaveReqId,
   *  PO number). Host apps should NOT use the instanceId for this —
   *  they don't get it back until the start call completes, and some
   *  flows need the correlation from the moment the process kicks off. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  businessKey?: string;
}
