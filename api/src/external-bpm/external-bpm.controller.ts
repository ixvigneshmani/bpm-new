/* ─── External BPM controller ────────────────────────────────────────
 * Two read-only endpoints under /external-bpm:
 *   GET /external-bpm/models           → list deployed webMethods models
 *   GET /external-bpm/models/preview   → graph for a single model
 *
 * The preview endpoint takes the composite key in query params (rather
 * than path segments) so PROCESSKEY values containing slashes — e.g.
 * `_sag_collaboration/00099802…` — don't have to be URL-escaped through
 * the path. JWT auth required, same as every other surface.
 * ────────────────────────────────────────────────────────────────────── */

import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExternalBpmService } from './external-bpm.service';
import { WmIsService } from './wm-is.service';

@Controller('external-bpm')
@UseGuards(JwtAuthGuard)
export class ExternalBpmController {
  constructor(
    private readonly svc: ExternalBpmService,
    private readonly wmIs: WmIsService,
  ) {}

  @Get('models')
  async list() {
    return this.svc.listModels();
  }

  @Get('models/preview')
  async preview(
    @Query('processKey') processKey: string,
    @Query('modelVersion') modelVersion: string,
    @Query('deploymentVersion') deploymentVersion: string,
  ) {
    if (!processKey || !modelVersion || !deploymentVersion) {
      throw new BadRequestException(
        'processKey, modelVersion, and deploymentVersion are all required',
      );
    }
    const dep = Number(deploymentVersion);
    if (!Number.isInteger(dep)) {
      throw new BadRequestException('deploymentVersion must be an integer');
    }
    return this.svc.getModelGraph(processKey, modelVersion, dep);
  }

  /** Resolve a Document Type FQN to its field schema, via the IS Admin
   *  API. `fqn` accepts both the diagram's `{folder}name` form and the
   *  IS `folder:name` form; both are URL-encoded in the path segment.
   *  Server-cached for 24 h per type. */
  @Get('types/:fqn')
  async getType(@Param('fqn') fqn: string) {
    if (!fqn) throw new BadRequestException('type fqn is required');
    return this.wmIs.getType(decodeURIComponent(fqn));
  }
}
