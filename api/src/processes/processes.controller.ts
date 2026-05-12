import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { EngineService } from "../engine/engine.service";
import { ProcessesService } from "./processes.service";
import { ProcessPermissionsService } from "../permissions/process-permissions.service";
import { CreateProcessDto } from "./dto/create-process.dto";
import { UpdateProcessDto } from "./dto/update-process.dto";
import { SaveDocumentDto } from "./dto/save-document.dto";
import { SaveCanvasDto } from "./dto/save-canvas.dto";
import { ImportProcessDto } from "./dto/import-process.dto";
import { AuthenticatedRequest } from "../common/types/authenticated-request";

@Controller("processes")
@UseGuards(JwtAuthGuard)
export class ProcessesController {
  constructor(
    private readonly processesService: ProcessesService,
    private readonly engineService: EngineService,
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

  // ─── Business Document Templates (must be before :id routes) ─────

  @Get("templates/list")
  listTemplates(@Req() req: AuthenticatedRequest) {
    return this.processesService.listTemplates(req.user.tenantId);
  }

  // ─── Process CRUD ─────────────────────────────────────────────────

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateProcessDto) {
    return this.processesService.create(
      req.user.tenantId,
      req.user.sub,
      dto.name,
      dto.description,
    );
  }

  @Get()
  async findAll(@Req() req: AuthenticatedRequest) {
    const rows = await this.processesService.findAll(req.user.tenantId);
    const ctx = this.callerCtx(req);
    const visible = await this.permissions.filterVisible(
      ctx,
      rows.map((r) => r.id),
    );
    // L8 — flag processes the caller sees only because of an explicit
    // grant (vs. the default-open policy). System admins always see
    // everything; for them every process is "unrestricted from their
    // POV". For members, isRestrictedForCaller = there's at least one
    // grant on this process (someone deliberately constrained access).
    const restrictedIds =
      ctx.systemRole === "owner" || ctx.systemRole === "admin"
        ? new Set<string>()
        : await this.permissions.restrictedProcessIds(
            ctx.tenantId,
            rows.map((r) => r.id),
          );
    return rows
      .filter((r) => visible.has(r.id))
      .map((r) => ({
        ...r,
        isRestrictedForCaller: restrictedIds.has(r.id),
      }));
  }

  @Get(":id")
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "view");
    const process = await this.processesService.findOneWithDocument(
      id,
      req.user.tenantId,
    );
    const effectivePermissions = await this.permissions.effective(
      this.callerCtx(req),
      id,
    );
    return { ...process, effectivePermissions };
  }

  @Patch(":id")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProcessDto,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "edit");
    return this.processesService.update(id, req.user.tenantId, dto);
  }

  @Delete(":id")
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "admin");
    return this.processesService.remove(id, req.user.tenantId);
  }

  // ─── Canvas Data ──────────────────────────────────────────────────

  @Put(":id/canvas")
  async saveCanvas(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SaveCanvasDto,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "edit");
    return this.processesService.saveCanvas(id, req.user.tenantId, dto.canvasData);
  }

  // ─── Business Document for Process ────────────────────────────────

  @Put(":id/document")
  async saveDocument(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SaveDocumentDto,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "edit");
    return this.processesService.saveDocument(
      id,
      req.user.tenantId,
      dto.schema,
      dto.source,
      dto.templateId,
    );
  }

  @Get(":id/document")
  async getDocument(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "view");
    return this.processesService.getDocument(id, req.user.tenantId);
  }

  // ─── Publish lifecycle (GAP-05) ───────────────────────────────────

  /** POST /processes/:id/publish
   *  Mark a process ACTIVE so others can start instances against it.
   *  Snapshots the current canvas into PROCESS_VERSIONS — idempotent
   *  on identical canvas (returns the existing version with reused=true),
   *  bumps to a new numbered version when the canvas has changed since
   *  the last publish. Running instances pin to their original
   *  PROCESS_VERSIONS row and are unaffected. */
  // ─── D1 — Cross-environment deployment ────────────────────────────

  /** POST /processes/import
   *  Accept a .flowpro.json bundle from another environment. Creates
   *  or updates the process by slug, validates required role-keys,
   *  snapshots into PROCESS_VERSIONS with provenance. Does NOT
   *  auto-publish — preserves the GAP-05 contract. */
  @Post("import")
  importBundle(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportProcessDto,
  ) {
    // DTO validation (class-validator) already enforced the
    // envelope; the structural cast here just bridges the DTO
    // class to the internal ProcessExportBundle type alias.
    return this.engineService.importProcess({
      bundle: dto as unknown as import("../engine/engine.service").ProcessExportBundle,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }

  /** GET /processes/:id/export
   *  Returns the latest published version of the process as a
   *  portable .flowpro.json bundle. Caller saves it to disk and
   *  POSTs it to /processes/import on the destination environment.
   *  Refuses if the process has never been published. */
  @Get(":id/export")
  async export(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "view");
    return this.engineService.exportProcess({
      processId: id,
      tenantId: req.user.tenantId,
    });
  }

  @Post(":id/publish")
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    // Publishing has external effect (other users can start instances
    // against the published version). Two-layer gate: process-level
    // `publish` permission (OS1), with system owner/admin always
    // passing via the resolver. A non-admin can be granted explicit
    // publish authority on a specific process via PROCESS_PERMISSIONS;
    // otherwise they get 403.
    await this.permissions.assert(this.callerCtx(req), id, "publish");
    return this.engineService.publishProcess({
      processId: id,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }
}
