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
import { ProcessesService } from "./processes.service";
import { CreateProcessDto } from "./dto/create-process.dto";
import { UpdateProcessDto } from "./dto/update-process.dto";
import { SaveDocumentDto } from "./dto/save-document.dto";
import { SaveCanvasDto } from "./dto/save-canvas.dto";
import { AuthenticatedRequest } from "../common/types/authenticated-request";

@Controller("processes")
@UseGuards(JwtAuthGuard)
export class ProcessesController {
  constructor(private readonly processesService: ProcessesService) {}

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
  findAll(@Req() req: AuthenticatedRequest) {
    return this.processesService.findAll(req.user.tenantId);
  }

  @Get(":id")
  findOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.processesService.findOneWithDocument(id, req.user.tenantId);
  }

  @Patch(":id")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProcessDto,
  ) {
    return this.processesService.update(id, req.user.tenantId, dto);
  }

  @Delete(":id")
  remove(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.processesService.remove(id, req.user.tenantId);
  }

  // ─── Canvas Data ──────────────────────────────────────────────────

  @Put(":id/canvas")
  saveCanvas(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SaveCanvasDto,
  ) {
    return this.processesService.saveCanvas(id, req.user.tenantId, dto.canvasData);
  }

  // ─── Business Document for Process ────────────────────────────────

  @Put(":id/document")
  saveDocument(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SaveDocumentDto,
  ) {
    return this.processesService.saveDocument(
      id,
      req.user.tenantId,
      dto.schema,
      dto.source,
      dto.templateId,
    );
  }

  @Get(":id/document")
  getDocument(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.processesService.getDocument(id, req.user.tenantId);
  }

}
