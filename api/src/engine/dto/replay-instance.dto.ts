import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/** Body for POST /instances/:id/replay. Admin-only. Cancels every
 *  live token, kills queued jobs, optionally mutates variables, and
 *  places a fresh token at `targetNodeId`. */
export class ReplayInstanceDto {
  /** Node id on the process canvas to replay into. Must exist on the
   *  instance's versioned canvas — the engine validates. */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  targetNodeId: string;

  /** Mandatory human-readable reason. The audit story for a replay is
   *  the most load-bearing — auditors need to understand why someone
   *  rewound an instance. Industry products make this optional; we
   *  make it a contract requirement. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  /** Optional shallow-merge variable patch applied before the new
   *  token advances. `null` values delete keys (matches edit-vars
   *  semantics). */
  @IsOptional()
  @IsObject()
  variablesPatch?: Record<string, unknown>;
}
