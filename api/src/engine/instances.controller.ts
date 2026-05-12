import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { resolveActingFor } from "../auth/acting-for";
import { UsersService } from "../users/users.service";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { CancelInstanceDto } from "./dto/cancel-instance.dto";
import { EditVariablesDto } from "./dto/edit-variables.dto";
import { SuspendInstanceDto } from "./dto/suspend-instance.dto";
import { ReplayInstanceDto } from "./dto/replay-instance.dto";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";
import { ProcessPermissionsService } from "../permissions/process-permissions.service";
import { ForbiddenException } from "@nestjs/common";

/** Admin-only guard for mutating ops (edit vars, suspend, resume).
 *  Reuses the systemRole on the JWT so we don't introduce a new
 *  RBAC surface until OS1 lands. */
function assertAdmin(req: AuthenticatedRequest) {
  if (req.user.systemRole !== "owner" && req.user.systemRole !== "admin") {
    throw new ForbiddenException("Admin-only operation.");
  }
}

@Controller("instances")
@UseGuards(JwtAuthGuard)
export class InstancesController {
  constructor(
    private readonly engine: EngineService,
    private readonly idempotency: IdempotencyService,
    private readonly users: UsersService,
    private readonly permissions: ProcessPermissionsService,
  ) {}

  private callerCtx(req: AuthenticatedRequest) {
    return {
      userId: req.user.sub,
      tenantId: req.user.tenantId,
      systemRole: req.user.systemRole,
      roles: req.user.roles ?? [],
    };
  }

  /** GET /instances?status=<status>
   *  Tenant-wide list of instances (newest first, capped at 200).
   *  Optional `status` query filters to one of running/completed/
   *  failed/cancelled. Used by the "Running" page to show what's in
   *  flight without picking a process first. */
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("businessKey") businessKey?: string,
  ) {
    const allowed = ["running", "completed", "failed", "cancelled", "suspended"] as const;
    if (status && !allowed.includes(status as (typeof allowed)[number])) {
      throw new BadRequestException(
        `status must be one of: ${allowed.join(", ")}`,
      );
    }
    const rows = await this.engine.listInstancesForTenant({
      tenantId: req.user.tenantId,
      status: status as (typeof allowed)[number] | undefined,
      businessKey: businessKey?.trim() || undefined,
    });
    // OS1 / H3 — restrict to instances of processes the caller can
    // view. Admins pass through unchanged via the resolver's escape
    // hatch.
    const visible = await this.permissions.filterVisible(
      this.callerCtx(req),
      rows.map((r) => r.processId),
    );
    return rows.filter((r) => visible.has(r.processId));
  }

  /** GET /instances/:id
   *  Single-instance detail: state, variables, live tokens, last 50
   *  audit events. The debug + operability view. */
  @Get(":id")
  async getInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const inst = await this.engine.getInstance({
      instanceId: id,
      tenantId: req.user.tenantId,
    });
    // OS1 / H3 — block direct fetch of an instance whose process the
    // caller has no view on.
    await this.permissions.assert(this.callerCtx(req), inst.processId, "view");
    return inst;
  }

  /** POST /instances/:id/cancel
   *  Cancel a running instance: cancels every live token, flips
   *  status to `cancelled`, emits an audit row. Idempotent — if the
   *  instance is already terminal we return its current state, no
   *  error.
   *
   *  Replay safety: pass `Idempotency-Key` to make retries safe. */
  @Post(":id/cancel")
  async cancelInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CancelInstanceDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const effective = await resolveActingFor(req, this.users);
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "cancel-instance",
      key: idempotencyKey,
      requestBody: { instanceId: id, reason: dto.reason ?? null, actingBy: effective.actingBy },
      handler: () =>
        this.engine.cancelInstance({
          instanceId: id,
          tenantId: req.user.tenantId,
          userId: effective.userId,
          actingBy: effective.actingBy,
          reason: dto.reason,
        }),
    });
  }

  /** POST /instances/:id/variables
   *  Admin-only. Shallow-merge `patch` into the instance's variable
   *  bag and emit one `variable-edited` audit row per key with
   *  old/new values + the mandatory reason.
   *  Replay safety: pass `Idempotency-Key` header so a network retry
   *  doesn't apply the patch twice (and duplicate the audit rows). */
  @Post(":id/variables")
  async editVariables(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: EditVariablesDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    assertAdmin(req);
    const effective = await resolveActingFor(req, this.users);
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "edit-variables",
      key: idempotencyKey,
      // Include actingBy + reason + patch in the body hash so replaying
      // the same key with a different patch is treated as a conflict
      // (not a silent cache hit).
      requestBody: {
        instanceId: id,
        patch: dto.patch,
        reason: dto.reason,
        actingBy: effective.actingBy,
      },
      handler: () =>
        this.engine.editInstanceVariables({
          instanceId: id,
          tenantId: req.user.tenantId,
          userId: effective.userId,
          actingBy: effective.actingBy,
          patch: dto.patch,
          reason: dto.reason,
        }),
    });
  }

  @Post(":id/suspend")
  async suspendInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SuspendInstanceDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    assertAdmin(req);
    const effective = await resolveActingFor(req, this.users);
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "suspend-instance",
      key: idempotencyKey,
      requestBody: {
        instanceId: id,
        reason: dto.reason ?? null,
        actingBy: effective.actingBy,
      },
      handler: () =>
        this.engine.suspendInstance({
          instanceId: id,
          tenantId: req.user.tenantId,
          userId: effective.userId,
          actingBy: effective.actingBy,
          reason: dto.reason,
        }),
    });
  }

  @Post(":id/resume")
  async resumeInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    assertAdmin(req);
    const effective = await resolveActingFor(req, this.users);
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "resume-instance",
      key: idempotencyKey,
      requestBody: { instanceId: id, actingBy: effective.actingBy },
      handler: () =>
        this.engine.resumeInstance({
          instanceId: id,
          tenantId: req.user.tenantId,
          userId: effective.userId,
          actingBy: effective.actingBy,
        }),
    });
  }

  @Post(":id/replay")
  async replayInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: ReplayInstanceDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    assertAdmin(req);
    const effective = await resolveActingFor(req, this.users);
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "replay-instance",
      key: idempotencyKey,
      requestBody: {
        instanceId: id,
        targetNodeId: dto.targetNodeId,
        reason: dto.reason,
        variablesPatch: dto.variablesPatch ?? null,
        actingBy: effective.actingBy,
      },
      handler: () =>
        this.engine.replayFromStep({
          instanceId: id,
          tenantId: req.user.tenantId,
          userId: effective.userId,
          actingBy: effective.actingBy,
          targetNodeId: dto.targetNodeId,
          reason: dto.reason,
          variablesPatch: dto.variablesPatch,
        }),
    });
  }
}
