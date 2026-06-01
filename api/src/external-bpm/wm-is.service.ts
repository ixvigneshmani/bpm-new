/* ─── webMethods IS Admin client (read-only) ─────────────────────────
 * Fetches Document Type schemas from the webMethods Integration Server
 * via its HTTP /invoke interface. The MSSQL DB next door carries the
 * model topology, but type definitions (the field schema of a
 * `{Folder.path}DocName` reference) live in IS packages — only the IS
 * itself can hand them over.
 *
 * Service hit:
 *   POST {WEBMETHODS_IS_URL}/invoke/wm.server.ns/getNode
 *   form: name=Folder.path:DocName
 *   Accept: text/xml
 *
 * The reply is an IData XML document; the slice we care about is
 * `<record name="node"> → <array name="rec_fields">`, one
 * `<record javaclass="com.wm.util.Values">` per field with:
 *   field_name, field_type ("string"|"int"|"boolean"|"record"|"recref"|…),
 *   field_opt ("true"/"false"), field_dim ("0" scalar | "1" array | …),
 *   plus an optional sub-record `node_subtype` carrying the recref's
 *   target FQN when field_type === "recref".
 *
 * Caching: in-memory, 24 h TTL keyed by the FQN we just fetched (types
 * almost never change between deploys on a stable install).
 * ────────────────────────────────────────────────────────────────────── */

import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

/** Shape returned by GET /external-bpm/types/:fqn — one Document Type
 *  with its field list. `kind` mirrors webMethods' node_type ("record"
 *  is the usual one for a Document Type). */
export interface IsTypeSchema {
  /** The FQN we resolved (in the `Folder.path:DocName` form expected by
   *  the IS API). */
  fqn: string;
  /** webMethods node_type — "record" for documents. */
  kind: string;
  /** Flat list of top-level fields. Each field that is itself a recref
   *  carries its own `recrefFqn` which the client can recursively fetch
   *  to render the nested schema as a tree. */
  fields: IsField[];
}

export interface IsField {
  name: string;
  /** Primitive ("string", "int", "boolean", …), "record" (inline
   *  nested), or "recref" (named reference; `recrefFqn` is set). */
  type: string;
  /** True when the field is optional. */
  optional: boolean;
  /** True when field_dim > 0 — i.e. an array. */
  isArray: boolean;
  /** Designer-authored comment, when present. */
  comment: string | null;
  /** Set only when `type === 'recref'` — the FQN of the referenced
   *  Document Type (in `Folder.path:DocName` form). Lets the client
   *  recurse into the type tree on demand. Null when the IS didn't
   *  carry one (which would mean a generic "any record" reference). */
  recrefFqn: string | null;
}

interface CacheEntry {
  schema: IsTypeSchema;
  expiresAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 h

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // <array> reliably wraps multiple <record> children; everything else
  // can stay object/string.
  isArray: (name, jpath) =>
    name === 'record' && typeof jpath === 'string' && jpath.includes('rec_fields'),
});

/** Convert the diagram's `{Folder.path}DocName` notation to the IS
 *  service's `Folder.path:DocName`. The IS form is the only one
 *  `wm.server.ns:getNode` accepts. */
export function toIsFqn(diagramFqn: string): string {
  // {Folder.path}DocName  →  Folder.path:DocName
  const m = diagramFqn.match(/^\{([^}]*)\}(.+)$/);
  if (m) return `${m[1]}:${m[2]}`;
  return diagramFqn;
}

@Injectable()
export class WmIsService {
  private readonly log = new Logger('WmIsService');
  private readonly cache = new Map<string, CacheEntry>();


  private isConfigured(): boolean {
    return !!(
      process.env.WEBMETHODS_IS_URL &&
      process.env.WEBMETHODS_IS_USER &&
      process.env.WEBMETHODS_IS_PASS
    );
  }

  /** Fetch the field schema for a Document Type. `fqn` may be in either
   *  the diagram's `{folder}name` form or the IS `folder:name` form;
   *  both are normalised. Throws 503 when the IS is not configured,
   *  404 when the IS reports the node doesn't exist. */
  async getType(fqn: string): Promise<IsTypeSchema> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'webMethods IS is not configured — set WEBMETHODS_IS_URL / USER / PASS.',
      );
    }
    const isFqn = toIsFqn(fqn);
    const now = Date.now();
    const cached = this.cache.get(isFqn);
    if (cached && cached.expiresAt > now) return cached.schema;

    const url = `${process.env.WEBMETHODS_IS_URL!.replace(/\/+$/, '')}/invoke/wm.server.ns/getNode`;
    const auth = Buffer.from(
      `${process.env.WEBMETHODS_IS_USER}:${process.env.WEBMETHODS_IS_PASS}`,
      'utf8',
    ).toString('base64');

    const form = new URLSearchParams();
    form.set('name', isFqn);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'text/xml',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
    } catch (e) {
      this.log.error(`IS fetch failed for ${isFqn}: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'webMethods IS is unreachable — check WEBMETHODS_IS_URL and network.',
      );
    }

    if (res.status === 404) {
      throw new NotFoundException(`Type not found on IS: ${isFqn}`);
    }
    if (!res.ok) {
      // 500 with $error "node name needed" is the IS's way of saying
      // the FQN format was rejected; surface as 404.
      const body = await res.text().catch(() => '');
      if (/UnknownServiceException|node name needed/i.test(body)) {
        throw new NotFoundException(`Type not found on IS: ${isFqn}`);
      }
      throw new ServiceUnavailableException(
        `webMethods IS returned ${res.status} for ${isFqn}`,
      );
    }
    const xml = await res.text();
    const schema = this.parse(isFqn, xml);
    this.cache.set(isFqn, { schema, expiresAt: now + TTL_MS });
    return schema;
  }

  /** Manual cache flush — wired to a future "Refresh schemas" admin
   *  button so a redeploy of a Document Type can be picked up without
   *  bouncing the API. */
  flushCache(): void {
    this.cache.clear();
  }

  /** Parse the IS XML reply. Walks the `<Values version="2.0">` →
   *  `<record name="node">` → `<array name="rec_fields">` slice. */
  private parse(fqn: string, xml: string): IsTypeSchema {
    let root: unknown;
    try {
      root = xmlParser.parse(xml);
    } catch (e) {
      this.log.error(`XML parse failed for ${fqn}: ${(e as Error).message}`);
      throw new ServiceUnavailableException(`IS returned malformed XML for ${fqn}`);
    }
    const r = root as Record<string, any>;
    const values = r['Values'];
    const recs: any[] = Array.isArray(values?.record) ? values.record : values?.record ? [values.record] : [];
    const node = recs.find((x) => x && x['@name'] === 'node');
    const kind = readValue(node, 'node_type') ?? 'record';
    const recFieldsArr = findArray(node, 'rec_fields');
    const fields: IsField[] = [];
    for (const fld of recFieldsArr) {
      const name = readValue(fld, 'field_name');
      if (!name) continue;
      const type = readValue(fld, 'field_type') ?? 'string';
      const opt = readValue(fld, 'field_opt') === 'true';
      const dim = readNumber(fld, 'field_dim') ?? 0;
      const comment = (readValue(fld, 'node_comment') || '').trim() || null;
      const recrefFqn = type === 'recref' ? extractRecrefFqn(fld) : null;
      fields.push({
        name,
        type,
        optional: opt,
        isArray: dim > 0,
        comment,
        recrefFqn,
      });
    }
    return { fqn, kind, fields };
  }
}

// ── XML helpers ────────────────────────────────────────────────────
// The IS reply uses fast-xml-parser's default shape: every distinct
// element becomes an object or an array; <value>/<number> elements
// carry `@name` and a `#text` (or the parsed primitive).

function readValue(parent: any, name: string): string | null {
  if (!parent) return null;
  const direct = pickByName(parent['value'], name);
  if (direct != null) return String(direct);
  const num = pickByName(parent['number'], name);
  if (num != null) return String(num);
  return null;
}

function readNumber(parent: any, name: string): number | null {
  const v = readValue(parent, name);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickByName(node: unknown, name: string): unknown {
  if (node == null) return null;
  const arr = Array.isArray(node) ? node : [node];
  for (const item of arr) {
    if (item && typeof item === 'object' && (item as any)['@name'] === name) {
      // The element may be either a primitive (<value name="…">text</value>
      // → { '@name': '…', '#text': 'text' }) or a record (object). For
      // empty self-closed elements (<value name="x"></value>) fast-xml-
      // parser returns ONLY the attrs, no '#text' — treat that as null
      // so callers don't end up with the literal "[object Object]".
      const text = (item as any)['#text'];
      if (text !== undefined) return text;
      const keys = Object.keys(item as object).filter((k) => k !== '@name');
      if (keys.length === 0) return null;
      return item;
    }
  }
  return null;
}

function findArray(parent: any, name: string): any[] {
  if (!parent) return [];
  const arr = parent['array'];
  if (!arr) return [];
  const list = Array.isArray(arr) ? arr : [arr];
  for (const a of list) {
    if (a && a['@name'] === name) {
      const recs = a['record'];
      if (Array.isArray(recs)) return recs;
      if (recs) return [recs];
      return [];
    }
  }
  return [];
}

/** When a field is a `recref`, the IS payload stores the referenced
 *  type FQN under `<value name="rec_ref">Folder.path:DocName</value>`
 *  inside the field record (verified on BusinessDoc.taskConfig →
 *  "IXTaskMgmt.documents:TaskConfig"). Falls back to the older
 *  node_subtype/node_nsName shape just in case a different IS version
 *  uses it. Returns null when no pointer was authored. */
function extractRecrefFqn(fld: any): string | null {
  const direct = readValue(fld, 'rec_ref');
  if (direct) return direct;
  const subtypeRec = pickByName(fld['record'], 'node_subtype');
  if (subtypeRec && typeof subtypeRec === 'object') {
    const ns = readValue(subtypeRec, 'node_nsName');
    if (ns) return ns;
  }
  const ns = readValue(fld, 'node_nsName');
  if (ns) return ns;
  return null;
}
