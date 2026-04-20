/* ─── Engine Service ─────────────────────────────────────────────────
 * Token-flow interpreter for BPMN processes stored in `processes.canvas_data`.
 *
 * E1 ships the scaffold only: dependency wiring, type definitions for
 * the canvas shape the interpreter consumes, and stub methods that
 * later phases (E2 onward) fill in. No advance loop yet.
 * ──────────────────────────────────────────────────────────────────── */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DATABASE, type Database } from "../database/database.module";

/** A canvas node as the interpreter sees it. The full shape lives in
 *  `web/src/types/bpmn-node-data.ts`; the engine only reads the fields
 *  it needs to traverse + execute, so we keep this projection narrow.
 *  `data` is `unknown`-ish because event/task/gateway each carry
 *  type-specific payloads that the per-node-type handlers will narrow. */
export type EngineNode = {
  id: string;
  type: string;
  parentId?: string;
  data?: Record<string, unknown>;
};

/** A canvas edge. `data.condition` is the FEEL-lite expression the
 *  exclusive-gateway handler evaluates in E4; `data.isDefault` flags
 *  the fallback edge used when no other branch matches. */
export type EngineEdge = {
  id: string;
  source: string;
  target: string;
  data?: {
    condition?: string;
    isDefault?: boolean;
    flowType?: string;
  };
};

/** What the engine pulls out of `processes.canvas_data`. Anything else
 *  on the canvas (viewport, selection state, layout hints) is irrelevant
 *  to execution and stays in the JSONB blob untouched. */
export type EngineCanvas = {
  nodes: EngineNode[];
  edges: EngineEdge[];
};

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    @Optional() @Inject(DATABASE) private readonly db: Database | null = null,
  ) {}

  /** E2: start a new instance of a process — create a PROCESS_INSTANCES
   *  row, place one INSTANCE_TOKENS token on the start event, then
   *  advance until the token hits a wait state or end event. Returns
   *  the instance id. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async startInstance(_args: {
    processId: string;
    tenantId: string;
    userId: string;
    variables?: Record<string, unknown>;
  }): Promise<{ instanceId: string }> {
    throw new Error("EngineService.startInstance not implemented (E2)");
  }
}
