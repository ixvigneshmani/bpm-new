/* ─── External BPM service ───────────────────────────────────────────
 * Read-only access to an external webMethods MSSQL database. Lists
 * deployed process models and returns a graph (nodes + edges) for a
 * single model so the React Flow canvas can render it.
 *
 * IMPORTANT — READ-ONLY contract:
 *   • Only SELECT queries are ever issued (defence-in-depth: the
 *     connection pool is opened with readOnlyIntent=true).
 *   • No webMethods data is persisted to FlowPro's Postgres.
 *   • No in-memory caching — every request hits webMethods live.
 *
 * Credentials are loaded from api/.env.webmethods (gitignored).
 * ────────────────────────────────────────────────────────────────────── */

import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { ConfigService } from '@nestjs/config';
import { mapWmTypeToBpmn, type BpmnNodeKind } from './wm-type-mapping';
import { parseBpdXml } from './bpd-xml-parser';

/** Map webMethods' uppercase terminal name (RIGHT / LEFT / TOP / BOTTOM)
 *  to the React Flow handle id exposed by the Designer's BPMN nodes
 *  (s-right / t-left / etc. — see web/src/components/canvas/nodes/base/). */
function terminalToHandle(role: 'source' | 'target', term: string | null): string | null {
  if (!term) return null;
  const prefix = role === 'source' ? 's' : 't';
  const side = term.toLowerCase();
  if (side === 'right' || side === 'left' || side === 'top' || side === 'bottom') {
    return `${prefix}-${side}`;
  }
  return null;
}

export interface ExternalBpmModelSummary {
  processKey: string;
  modelVersion: string;
  deploymentVersion: number;
  label: string | null;
  enabled: boolean;
  deploymentTime: string | null;
  /** webMethods "folder" the model lives in (e.g. DOEEnforcementProc). */
  processPath: string | null;
}

export interface ExternalBpmNode {
  id: string;
  type: BpmnNodeKind;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pool or lane uid this step belongs to, when extractable from the BPD XML. */
  parentId: string | null;
}

export interface ExternalBpmContainer {
  /** "pool" | "lane" — both render as parent nodes in React Flow. */
  type: 'pool' | 'lane';
  id: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /** For lanes: the parent pool uid. null for top-level pools. */
  parentId: string | null;
}

export interface ExternalBpmEdge {
  id: string;
  source: string;
  target: string;
  /** React Flow handle id on the source node (e.g. "s-right"). Derived
   *  from the BPD XML's sourceTerminal when available, else null and
   *  the frontend picks one geometrically. */
  sourceHandle: string | null;
  targetHandle: string | null;
  conditional: boolean;
  label: string | null;
  /** Designer-authored bend points in canvas-absolute coordinates, in
   *  source order. Empty when the edge was drawn straight. The frontend
   *  scales these and feeds them to BpmnSequenceEdge.data.waypoints so
   *  edges follow the exact path the modeller drew. */
  waypoints: Array<{ x: number; y: number }>;
  /** Condition expression on the transition, e.g. "doc/action == 'APPROVED'". */
  conditionText: string | null;
}

export interface ExternalBpmGraph {
  model: ExternalBpmModelSummary;
  containers: ExternalBpmContainer[];
  nodes: ExternalBpmNode[];
  edges: ExternalBpmEdge[];
}

@Injectable()
export class ExternalBpmService implements OnModuleDestroy {
  private readonly logger = new Logger(ExternalBpmService.name);
  private poolPromise: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Lazily open a single connection pool to the webMethods DB. We keep
   *  one pool per process; mssql handles connection reuse internally. */
  private getPool(): Promise<sql.ConnectionPool> {
    if (this.poolPromise) return this.poolPromise;

    const host = this.config.get<string>('WEBMETHODS_DB_HOST');
    const database = this.config.get<string>('WEBMETHODS_DB_NAME');
    const user = this.config.get<string>('WEBMETHODS_DB_USER');
    const password = this.config.get<string>('WEBMETHODS_DB_PASSWORD');
    const port = Number(this.config.get<string>('WEBMETHODS_DB_PORT')) || 1433;

    if (!host || !database || !user || !password) {
      throw new ServiceUnavailableException(
        'External BPM not configured: WEBMETHODS_DB_* env vars are missing.',
      );
    }

    this.logger.log(`Opening read-only MSSQL pool → ${host}:${port}/${database}`);
    this.poolPromise = new sql.ConnectionPool({
      server: host,
      port,
      database,
      user,
      password,
      options: {
        encrypt: true,
        trustServerCertificate: true,
        readOnlyIntent: true,
      },
      pool: { min: 0, max: 4, idleTimeoutMillis: 30_000 },
      requestTimeout: 30_000,
    })
      .connect()
      .catch((err) => {
        this.logger.error(`Failed to connect to webMethods DB: ${err.message}`);
        this.poolPromise = null;
        throw new ServiceUnavailableException(
          'Could not reach the webMethods database. Check network and credentials.',
        );
      });

    return this.poolPromise;
  }

  /** List every source process model. Newest deployment first.
   *
   *  IMPORTANT — TYPE filter:
   *    WMPROCESSDEFINITION holds two distinct kinds of rows:
   *      TYPE = 1 → designer-authored source models (what users want to see)
   *      TYPE = 5 → webMethods-auto-generated "collaboration version"
   *                 snapshots — one per instance / per published version,
   *                 living under PROCESSPATH "_sag_collaboration". Those
   *                 are runtime artifacts, NOT models.
   *    On the DOE install: 100 of TYPE 1 vs 2,956 of TYPE 5. Without the
   *    filter the page reads like an instance dump. Confirmed via
   *    scripts/webmethods-find-model-table.ts (2026-05-28).
   */
  async listModels(): Promise<ExternalBpmModelSummary[]> {
    const pool = await this.getPool();
    const result = await pool.request().query(`
      SELECT PROCESSKEY, MODELVERSION, DEPLOYMENTVERSION,
             PROCESSLABEL, ENABLED, DEPLOYMENTTIME, PROCESSPATH
      FROM WMPROCESSDEFINITION
      WHERE TYPE = 1
      ORDER BY DEPLOYMENTTIME DESC, PROCESSLABEL ASC;
    `);
    return result.recordset.map((r) => ({
      processKey: r.PROCESSKEY,
      modelVersion: r.MODELVERSION,
      deploymentVersion: r.DEPLOYMENTVERSION,
      label: r.PROCESSLABEL,
      enabled: r.ENABLED === 1,
      deploymentTime: r.DEPLOYMENTTIME ? new Date(r.DEPLOYMENTTIME).toISOString() : null,
      processPath: r.PROCESSPATH,
    }));
  }

  /** Fetch one model + its steps + transitions, shaped for React Flow.
   *  Coordinates come straight from WMSTEPDEFINITION (Designer's own layout). */
  async getModelGraph(
    processKey: string,
    modelVersion: string,
    deploymentVersion: number,
  ): Promise<ExternalBpmGraph> {
    const pool = await this.getPool();

    // 1. Model header — also pulls the BPD XML blob so we can extract
    //    pool / lane container structure (which the relational tables
    //    don't carry).
    const headerReq = pool.request();
    headerReq.input('key', sql.NVarChar(255), processKey);
    headerReq.input('ver', sql.NVarChar(64), modelVersion);
    headerReq.input('dep', sql.Int, deploymentVersion);
    const headerRes = await headerReq.query(`
      SELECT PROCESSKEY, MODELVERSION, DEPLOYMENTVERSION,
             PROCESSLABEL, ENABLED, DEPLOYMENTTIME, PROCESSPATH,
             PROCESSFILE
      FROM WMPROCESSDEFINITION
      WHERE PROCESSKEY = @key AND MODELVERSION = @ver AND DEPLOYMENTVERSION = @dep;
    `);
    if (headerRes.recordset.length === 0) {
      throw new ServiceUnavailableException('Model not found in webMethods');
    }
    const h = headerRes.recordset[0];
    const model: ExternalBpmModelSummary = {
      processKey: h.PROCESSKEY,
      modelVersion: h.MODELVERSION,
      deploymentVersion: h.DEPLOYMENTVERSION,
      label: h.PROCESSLABEL,
      enabled: h.ENABLED === 1,
      deploymentTime: h.DEPLOYMENTTIME ? new Date(h.DEPLOYMENTTIME).toISOString() : null,
      processPath: h.PROCESSPATH,
    };
    // PROCESSFILE is stored as the legacy `image` type — comes back as a
    // raw Buffer. SQL Server won't let us CAST it to NVARCHAR(MAX)
    // directly (error 529: "Explicit conversion from data type image to
    // nvarchar(max) is not allowed"), so we decode the bytes here.
    // BPD XML declares encoding="UTF-8" in its prolog.
    const xmlBytes: Buffer | string | null = h.PROCESSFILE ?? null;
    const xmlString =
      Buffer.isBuffer(xmlBytes)
        ? xmlBytes.toString('utf8')
        : typeof xmlBytes === 'string'
          ? xmlBytes
          : null;
    // Parse pool / lane / step-membership from the BPD XML. Returns empty
    // collections (no error) if the blob is missing or malformed; the
    // graph then renders flat without pool framing, as before.
    const containerMap = parseBpdXml(xmlString);

    // 2. Steps
    const stepsReq = pool.request();
    stepsReq.input('key', sql.NVarChar(255), processKey);
    stepsReq.input('ver', sql.NVarChar(64), modelVersion);
    stepsReq.input('dep', sql.Int, deploymentVersion);
    const stepsRes = await stepsReq.query(`
      SELECT STEPID, STEPLABEL, TYPE,
             ICON_X, ICON_Y, ICON_WIDTH, ICON_HEIGHT
      FROM WMSTEPDEFINITION
      WHERE PROCESSKEY = @key AND MODELVERSION = @ver AND DEPLOYMENTVERSION = @dep;
    `);

    // 3. Transitions
    const txReq = pool.request();
    txReq.input('key', sql.NVarChar(255), processKey);
    txReq.input('ver', sql.NVarChar(64), modelVersion);
    txReq.input('dep', sql.Int, deploymentVersion);
    const txRes = await txReq.query(`
      SELECT SOURCESTEPID, TARGETSTEPID, TYPE, VISUALTYPE, LABEL
      FROM WMSTEPTRANSITIONDEFINITION
      WHERE PROCESSKEY = @key AND MODELVERSION = @ver AND DEPLOYMENTVERSION = @dep;
    `);

    // 4. IS_START / IS_STOP are 0 across this install (confirmed at discovery),
    //    so derive the start nodes ourselves: any step with no incoming edge
    //    AND whose TYPE isn't an end-event becomes a synthetic startEvent.
    const incoming = new Set<string>();
    for (const t of txRes.recordset) incoming.add(t.TARGETSTEPID);

    // Lane lookup by uid — used to translate WMSTEPDEFINITION's
    // pool-relative step coords into swimlane-relative coords when a
    // step lives inside a swimlane (so React Flow's parent chain
    // renders it at the right spot inside the swimlane band).
    const lanesById = new Map<string, (typeof containerMap.lanes)[number]>();
    for (const l of containerMap.lanes) lanesById.set(l.id, l);

    const nodes: ExternalBpmNode[] = stepsRes.recordset.map((s) => {
      const mappedType = mapWmTypeToBpmn(s.TYPE);
      const isImplicitStart = !incoming.has(s.STEPID) && mappedType !== 'endEvent';
      // Prefer swimlane membership; fall back to pool only when the
      // step's Y didn't land in any swimlane band.
      const swimlaneId = containerMap.stepToLane.get(s.STEPID);
      const parentId =
        swimlaneId ?? containerMap.stepToPool.get(s.STEPID) ?? null;
      const rawX = s.ICON_X ?? 0;
      const rawY = s.ICON_Y ?? 0;
      // If parented to a swimlane, the step's stored Y is pool-relative
      // and we need to subtract the swimlane's pool-relative Y to make
      // it swimlane-relative (React Flow parent-child semantics).
      const sw = swimlaneId ? lanesById.get(swimlaneId) : null;
      const x = rawX;
      const y = sw ? rawY - sw.y : rawY;
      return {
        id: s.STEPID,
        type: isImplicitStart ? 'startEvent' : mappedType,
        label: s.STEPLABEL,
        x,
        y,
        width: s.ICON_WIDTH ?? 60,
        height: s.ICON_HEIGHT ?? 60,
        parentId,
      };
    });

    // Look up the BPD XML's per-edge metadata: which side of each node
    // the transition attaches to (terminals), the bendpoints the
    // designer drew, and the condition expression. Without bendpoints
    // the orthogonal router takes shortest-path lines that cut through
    // other nodes. webMethods stores ~2 bendpoints per edge on average
    // for non-trivial models.
    //
    // Some transitions in WMSTEPTRANSITIONDEFINITION have multiple
    // rows for the same (source,target) pair (parallel flows). We
    // build a per-pair queue so each DB row pulls a distinct XML entry.
    const metaQueues = new Map<string, ExternalBpmEdge['waypoints'][]>();
    const metaTerminalsQueues = new Map<
      string,
      Array<{
        sourceTerminal: string | null;
        targetTerminal: string | null;
        conditionText: string | null;
      }>
    >();
    for (const tm of containerMap.transitionMeta) {
      const key = `${tm.source}->${tm.target}`;
      if (!metaQueues.has(key)) metaQueues.set(key, []);
      metaQueues.get(key)!.push(tm.waypoints);
      if (!metaTerminalsQueues.has(key)) metaTerminalsQueues.set(key, []);
      metaTerminalsQueues.get(key)!.push({
        sourceTerminal: tm.sourceTerminal,
        targetTerminal: tm.targetTerminal,
        conditionText: tm.conditionText,
      });
    }

    const edges: ExternalBpmEdge[] = txRes.recordset.map((t, i) => {
      const key = `${t.SOURCESTEPID}->${t.TARGETSTEPID}`;
      const waypoints = metaQueues.get(key)?.shift() ?? [];
      const term = metaTerminalsQueues.get(key)?.shift() ?? {
        sourceTerminal: null,
        targetTerminal: null,
        conditionText: null,
      };
      return {
        // SOURCESTEPID + TARGETSTEPID is not always unique on its own (parallel
        // edges happen), so include the row index to keep React Flow happy.
        id: `${t.SOURCESTEPID}__${t.TARGETSTEPID}__${i}`,
        source: t.SOURCESTEPID,
        target: t.TARGETSTEPID,
        sourceHandle: terminalToHandle('source', term.sourceTerminal),
        targetHandle: terminalToHandle('target', term.targetTerminal),
        conditional: t.TYPE === 0 && t.VISUALTYPE === 2,
        // Show the designer's condition expression when present, else
        // fall back to the relational LABEL column.
        label: term.conditionText ?? t.LABEL,
        waypoints,
        conditionText: term.conditionText,
      };
    });

    // Drop empty container scaffolding. webMethods occasionally has pool
    // / lane elements in the BPD XML whose only members are uids that
    // never made it into WMSTEPDEFINITION at deploy time (PermitProcess
    // had two such pools — P2 and P7 — each referencing a single uid
    // not present in the runtime tables). Rendering them as empty
    // boxes clutters the canvas and confuses the swimlane semantics.
    const usedPoolIds = new Set<string>();
    const usedLaneIds = new Set<string>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      // n.parentId can point to either a pool or a lane.
      const lane = containerMap.lanes.find((l) => l.id === n.parentId);
      if (lane) {
        usedLaneIds.add(lane.id);
        usedPoolIds.add(lane.poolId);
      } else {
        usedPoolIds.add(n.parentId);
      }
    }

    const containers: ExternalBpmContainer[] = [
      ...containerMap.pools
        .filter((p) => usedPoolIds.has(p.id))
        .map<ExternalBpmContainer>((p) => ({
          type: 'pool',
          id: p.id,
          label: p.label,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          parentId: null,
        })),
      ...containerMap.lanes
        .filter((l) => usedLaneIds.has(l.id))
        .map<ExternalBpmContainer>((l) => ({
          type: 'lane',
          id: l.id,
          label: l.label,
          x: l.x,
          y: l.y,
          width: l.width,
          height: l.height,
          parentId: l.poolId,
        })),
    ];

    // If a node's parentId refers to a container we just dropped (lane
    // exists in XML but isn't used by any DB step, etc.), null out the
    // parentId so the node doesn't end up orphaned at render time.
    const keptContainerIds = new Set(containers.map((c) => c.id));
    for (const n of nodes) {
      if (n.parentId && !keptContainerIds.has(n.parentId)) {
        n.parentId = null;
      }
    }

    return { model, containers, nodes, edges };
  }

  async onModuleDestroy() {
    if (this.poolPromise) {
      try {
        const pool = await this.poolPromise;
        await pool.close();
        this.logger.log('webMethods MSSQL pool closed.');
      } catch (err) {
        this.logger.warn(`Error closing webMethods pool: ${(err as Error).message}`);
      }
    }
  }
}
