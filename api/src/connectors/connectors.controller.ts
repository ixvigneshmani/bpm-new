/* ─── Connectors Controller ─────────────────────────────────────────
 * Admin surface for the connector framework. Two areas:
 *
 *   1. Connector DEFINITIONS — read-only catalog of "what types can I
 *      configure?". Driven by the in-process ConnectorRegistry.
 *      Front-end uses this to render the schema-driven add-connection
 *      form and the designer's connector picker.
 *
 *   2. Connector INSTANCES (a.k.a. "connections") — tenant-scoped CRUD
 *      over CONNECTOR_INSTANCES, plus a per-connection Test action.
 *
 * RBAC: owner / admin only — these are tenant-wide credentials.
 * Mirrors the I1 mail-settings gate exactly.
 * ──────────────────────────────────────────────────────────────────── */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import {
  CreateConnectionDto,
  TestConnectionDto,
  UpdateConnectionDto,
} from "./dto/upsert-connection.dto";
import { ConnectorInstancesService } from "./connector-instances.service";
import { ConnectorRegistry } from "./connector-registry";

function assertAdmin(req: AuthenticatedRequest): void {
  const role = req.user.systemRole;
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenException(
      "Only owner / admin users may manage connectors.",
    );
  }
}

@Controller("connectors")
@UseGuards(JwtAuthGuard)
export class ConnectorsController {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly instances: ConnectorInstancesService,
  ) {}

  /** GET /connectors/definitions
   *  Catalog of registered connector types. UI-safe view; no handler
   *  function references leak to the wire. */
  @Get("definitions")
  definitions(@Req() req: AuthenticatedRequest) {
    assertAdmin(req);
    return this.registry.list().map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      connectionSchema: def.connectionSchema,
      secretFields: def.secretFields,
      connectionRequired: def.connectionRequired ?? true,
      hasTestAction: !!def.testAction,
      operations: def.operations.map((op) => ({
        id: op.id,
        name: op.name,
        description: op.description,
        inputSchema: op.inputSchema,
        outputKeys: op.outputKeys ?? [],
      })),
    }));
  }

  /** GET /connectors/connections?type=mail
   *  Tenant-scoped list. Filter by connector type with the optional
   *  `type` query — useful for the designer's connection picker. */
  @Get("connections")
  list(
    @Req() req: AuthenticatedRequest,
    @Query("type") type?: string,
  ) {
    assertAdmin(req);
    return this.instances.list(req.user.tenantId, type);
  }

  @Get("connections/:id")
  get(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    assertAdmin(req);
    return this.instances.getPublic(req.user.tenantId, id);
  }

  @Post("connections")
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateConnectionDto,
  ) {
    assertAdmin(req);
    return this.instances.create({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      connectorType: dto.connectorType,
      name: dto.name,
      config: dto.config,
      enabled: dto.enabled,
      isDefault: dto.isDefault,
    });
  }

  @Put("connections/:id")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    assertAdmin(req);
    // Only forward fields the caller actually included. The service
    // honors "field omitted = keep existing" semantics; defaulting to
    // empty-string here would wipe stored values. Caught in Sprint 1
    // smoke when a PUT with only {isDefault:true} blanked the name.
    return this.instances.update(req.user.tenantId, id, {
      userId: req.user.sub,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.config !== undefined ? { config: dto.config } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
    } as Parameters<typeof this.instances.update>[2]);
  }

  @Delete("connections/:id")
  @HttpCode(204)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    assertAdmin(req);
    await this.instances.remove(req.user.tenantId, id);
  }

  /** POST /connectors/connections/:id/test
   *  Invoke the connector's optional testAction. Translates handler
   *  errors to a 400 carrying the real cause — same pattern as the
   *  retired Mail controller's test endpoint after BUG-I1-01 fix. */
  @Post("connections/:id/test")
  @HttpCode(200)
  async test(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: TestConnectionDto,
  ) {
    assertAdmin(req);
    const conn = await this.instances.getDecrypted(req.user.tenantId, id);
    const def = this.registry.get(conn.connectorType);
    if (!def) {
      throw new BadRequestException(
        `Connector "${conn.connectorType}" is not registered. The connection cannot be tested.`,
      );
    }
    if (!def.testAction) {
      throw new BadRequestException(
        `Connector "${conn.connectorType}" does not support test send.`,
      );
    }
    try {
      const result = await def.testAction.handler(
        {
          tenantId: req.user.tenantId,
          instanceId: null,
          tokenId: null,
          nodeId: null,
          variables: {},
        },
        conn.config,
        dto.input ?? {},
      );
      return result;
    } catch (err) {
      throw new BadRequestException(
        `Test failed: ${(err as Error).message}`,
      );
    }
  }
}
