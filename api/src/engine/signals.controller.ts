/* ─── Signals Controller ─────────────────────────────────────────────
 * P3 Session 8 — public broadcast endpoint for BPMN signal events.
 *
 *   POST /api/signals
 *     body: { name }
 *
 * Tenant-wide fan-out: resumes every catching token AND spawns a
 * fresh instance for every signal-start subscription matching the
 * name. Returns counters so the host can log what landed.
 *
 * Auth: JWT-guarded like every other engine endpoint. Tenant comes
 * from the JWT — a token for tenant A can NEVER fan out into tenant B.
 *
 * No payload, by BPMN spec. If hosts need payload, they use messages
 * (point-to-point) — those carry an arbitrary JSON object that gets
 * merged into the receiving instance's variables.
 *
 * No idempotency cache today. Signals are inherently broadcast and
 * fire-and-forget — re-firing the same signal twice is the host's
 * business. Catch tokens use one-shot subscriptions (deleted on
 * resume) so a retry only wakes catchers that arrived in between.
 * ──────────────────────────────────────────────────────────────────── */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { EngineService } from "./engine.service";

interface BroadcastDto {
  name?: unknown;
}

@Controller("signals")
@UseGuards(JwtAuthGuard)
export class SignalsController {
  constructor(private readonly engine: EngineService) {}

  @Post()
  @HttpCode(200)
  async broadcast(
    @Req() req: AuthenticatedRequest,
    @Body() body: BroadcastDto,
  ) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new BadRequestException("`name` is required.");
    }
    const name = body.name.trim();
    const result = await this.engine.broadcastSignal({
      tenantId: req.user.tenantId,
      signalName: name,
    });
    return {
      signalName: name,
      delivered: result.catchesResumed,
      started: result.startsTriggered,
    };
  }
}
