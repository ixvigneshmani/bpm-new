/* ─── Variable Registry ──────────────────────────────────────────────
 * Two sources of variables feed autocomplete + type lookup:
 *   1. Business document schema (input variables — what the process
 *      starts with).
 *   2. Node-declared outputs harvested from the canvas (script result
 *      vars, receive-task payload targets, call-activity output
 *      mappings, business-rule result vars, generic outputMappings).
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import type { Node } from "@xyflow/react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import useCanvasStore, { type CanvasState } from "./canvas-store";

/* ─── Types ─── */

export type VariableType = "string" | "number" | "boolean" | "date" | "object" | "array";

export type VariableNode = {
  name: string;
  path: string;         // dot-separated path: "order.customer.email"
  type: VariableType;
  required: boolean;
  children?: VariableNode[];  // for object types
  itemType?: VariableNode[];  // for array item schema
};

export type VariableSource = "document" | "node";

export type FlatVariable = {
  path: string;
  type: VariableType;
  required: boolean;
  depth: number;
  source?: VariableSource;
  /** Human-readable origin label for node-declared vars, e.g. "Script: Calc Total". */
  originLabel?: string;
};

/* ─── Schema → Variable tree parser ─── */

function parseSchemaToTree(
  schema: Record<string, unknown>,
  parentPath = "",
): VariableNode[] {
  return Object.entries(schema).map(([key, value]) => {
    const path = parentPath ? `${parentPath}.${key}` : key;

    // Nested object
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return {
        name: key,
        path,
        type: "object" as const,
        required: false,
        children: parseSchemaToTree(value as Record<string, unknown>, path),
      };
    }

    // Array with item schema
    if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
      return {
        name: key,
        path,
        type: "array" as const,
        required: false,
        itemType: parseSchemaToTree(value[0] as Record<string, unknown>, `${path}[]`),
      };
    }

    // Primitive — the value is the type name string
    const typeStr = typeof value === "string" ? value : "string";
    const validTypes: VariableType[] = ["string", "number", "boolean", "date", "object", "array"];

    return {
      name: key,
      path,
      type: validTypes.includes(typeStr as VariableType) ? (typeStr as VariableType) : "string",
      required: false,
    };
  });
}

/* ─── Flatten the tree for autocomplete ─── */

function flattenTree(nodes: VariableNode[], depth = 0): FlatVariable[] {
  const result: FlatVariable[] = [];
  for (const node of nodes) {
    result.push({
      path: node.path,
      type: node.type,
      required: node.required,
      depth,
    });
    if (node.children) {
      result.push(...flattenTree(node.children, depth + 1));
    }
    if (node.itemType) {
      result.push(...flattenTree(node.itemType, depth + 1));
    }
  }
  return result;
}

/* ─── Node-output harvester ─── */

type AnyData = Record<string, unknown>;

function readString(obj: AnyData | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readMappings(obj: AnyData | undefined, key: string): Array<{ target?: string; type?: string }> {
  const v = obj?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((m) => m && typeof m === "object") as Array<{ target?: string; type?: string }>;
}

/** Coerce a free-form type string (from VariableMapping.type) to a VariableType. */
function coerceType(raw: string | undefined): VariableType {
  if (!raw) return "string";
  const t = raw.toLowerCase();
  if (t === "number" || t === "int" || t === "integer" || t === "float") return "number";
  if (t === "boolean" || t === "bool") return "boolean";
  if (t === "date" || t === "datetime" || t === "timestamp") return "date";
  if (t === "object" || t === "map") return "object";
  if (t === "array" || t === "list") return "array";
  return "string";
}

function harvestNodeOutputs(nodes: Node[]): FlatVariable[] {
  const out: FlatVariable[] = [];
  const seen = new Set<string>();
  const push = (path: string, type: VariableType, originLabel: string) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push({ path, type, required: false, depth: 0, source: "node", originLabel });
  };

  for (const n of nodes) {
    const data = (n.data || {}) as AnyData;
    const label = (data.label as string) || (n.type ?? "node");
    const type = n.type ?? "";

    // Script task — resultVariable
    if (type === "scriptTask") {
      const rv = readString(data.script as AnyData | undefined, "resultVariable");
      if (rv) push(rv, "string", `Script: ${label}`);
    }

    // Business rule — resultVariable on whichever binding is active
    if (type === "businessRuleTask") {
      const rv = readString(data.rule as AnyData | undefined, "resultVariable");
      if (rv) push(rv, "object", `Rule: ${label}`);
    }

    // Receive task — payload targets
    if (type === "receiveTask") {
      for (const m of readMappings(data.message as AnyData | undefined, "payloadMappings")) {
        if (m.target) push(m.target, coerceType(m.type), `Receive: ${label}`);
      }
    }

    // Call activity — child → parent output mappings
    if (type === "callActivity") {
      for (const m of readMappings(data.call as AnyData | undefined, "outputMappings")) {
        if (m.target) push(m.target, coerceType(m.type), `Call: ${label}`);
      }
    }

    // Generic outputMappings (any activity that writes back to process vars)
    for (const m of readMappings(data, "outputMappings")) {
      if (m.target) push(m.target, coerceType(m.type), `Output: ${label}`);
    }

    // userTask outcomes — the chosen action lands as `outcome: <id>`
    // in the bag. Surfacing it lets gateway-condition authors write
    // `outcome == "approve"` with autocomplete. The host app submits
    // any other variables alongside; those aren't statically known
    // so they don't appear here (they're a runtime contract between
    // host and BPM).
    if (type === "userTask") {
      const outcomes = (data as AnyData).outcomes;
      if (Array.isArray(outcomes) && outcomes.length > 0) {
        push("outcome", "string", `Outcome: ${label}`);
      }
    }
  }

  return out;
}

/* ─── Hook: useVariableRegistry ─── */

/** Extract only the node fields that could affect declared outputs. This lets
 *  us memoize the registry against a stable digest rather than the full `nodes`
 *  array — which changes on every drag/pan frame (60Hz). */
function outputDigest(nodes: Node[]): string {
  const parts: string[] = [];
  for (const n of nodes) {
    const d = (n.data || {}) as AnyData;
    if (n.type === "scriptTask") {
      parts.push(`s:${n.id}:${(d.script as AnyData)?.resultVariable ?? ""}:${d.label ?? ""}`);
    } else if (n.type === "businessRuleTask") {
      parts.push(`b:${n.id}:${(d.rule as AnyData)?.resultVariable ?? ""}:${d.label ?? ""}`);
    } else if (n.type === "receiveTask") {
      const targets = readMappings(d.message as AnyData | undefined, "payloadMappings")
        .map((m) => `${m.target ?? ""}/${m.type ?? ""}`).join(",");
      parts.push(`r:${n.id}:${targets}:${d.label ?? ""}`);
    } else if (n.type === "callActivity") {
      const targets = readMappings(d.call as AnyData | undefined, "outputMappings")
        .map((m) => `${m.target ?? ""}/${m.type ?? ""}`).join(",");
      parts.push(`c:${n.id}:${targets}:${d.label ?? ""}`);
    }
    const generic = readMappings(d, "outputMappings")
      .map((m) => `${m.target ?? ""}/${m.type ?? ""}`).join(",");
    if (generic) parts.push(`g:${n.id}:${generic}`);
    // userTask outcomes signature — drives memo invalidation when
    // the designer edits the outcomes list in the properties panel.
    if (n.type === "userTask") {
      const outcomes = d.outcomes;
      if (Array.isArray(outcomes)) {
        const sig = (outcomes as Array<{ id?: unknown }>)
          .map((x) => (typeof x.id === "string" ? x.id : ""))
          .join(",");
        if (sig) parts.push(`o:${n.id}:${sig}`);
      }
    }
  }
  return parts.join("|");
}

type NodesSnapshot = { nodes: Node[]; digest: string };
const selectNodesSnapshot = (s: CanvasState): NodesSnapshot => ({
  nodes: s.nodes,
  digest: outputDigest(s.nodes),
});
const eqByNodesDigest = (a: NodesSnapshot, b: NodesSnapshot) => a.digest === b.digest;

export function useVariableRegistry() {
  const businessDoc = useCanvasStore((s) => s.processMeta.businessDoc);
  // Subscribe with a custom equality that collapses re-renders when the
  // output-declaring shape hasn't changed (drags don't touch it).
  const { nodes, digest: nodesDigest } = useStoreWithEqualityFn(
    useCanvasStore,
    selectNodesSnapshot,
    eqByNodesDigest,
  );

  return useMemo(() => {
    const variables =
      businessDoc && typeof businessDoc === "object" ? parseSchemaToTree(businessDoc) : [];
    const docFlat = flattenTree(variables).map<FlatVariable>((v) => ({ ...v, source: "document" }));
    const nodeFlat = harvestNodeOutputs(nodes);
    const flatList: FlatVariable[] = [...docFlat, ...nodeFlat];

    const typeMap = new Map<string, VariableType>();
    for (const v of flatList) {
      // First writer wins — document schema takes precedence over node-declared.
      if (!typeMap.has(v.path)) typeMap.set(v.path, v.type);
    }

    return {
      variables,
      flatList,
      isEmpty: flatList.length === 0,

      getType(path: string): VariableType | undefined {
        return typeMap.get(path);
      },

      getCompletions(prefix: string): FlatVariable[] {
        if (!prefix) return flatList;
        const lower = prefix.toLowerCase();
        return flatList.filter((v) => v.path.toLowerCase().includes(lower));
      },

      /** Sweep-B cleanup #8 — deterministic sample scope for the
       *  designer's FEEL "evaluates to:" preview. Each declared
       *  variable gets a type-based stand-in (number → 42, string →
       *  "sample", boolean → true, date → today). Real runtime values
       *  obviously differ; the preview is for sanity-checking syntax
       *  + operator semantics, not actual outcomes. */
      getSampleScope(): Record<string, unknown> {
        const scope: Record<string, unknown> = {};
        const sampleFor = (t: VariableType): unknown => {
          switch (t) {
            case "number": return 42;
            case "string": return "sample";
            case "boolean": return true;
            case "date": return new Date().toISOString();
            case "object": return {};
            case "array": return [];
          }
        };
        const fill = (tree: VariableNode[], out: Record<string, unknown>) => {
          for (const v of tree) {
            if (v.type === "object" && v.children) {
              out[v.name] = {};
              fill(v.children, out[v.name] as Record<string, unknown>);
            } else {
              out[v.name] = sampleFor(v.type);
            }
          }
        };
        fill(variables, scope);
        // Node-declared outputs (no nested children) get a flat sample.
        for (const v of nodeFlat) {
          if (v.path.includes(".")) continue;
          if (scope[v.path] === undefined) scope[v.path] = sampleFor(v.type);
        }
        return scope;
      },
    };
    // nodes is read inside via getState() — the digest drives re-computation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessDoc, nodesDigest]);
}

/* ─── Type display helpers ─── */

export const TYPE_ICONS: Record<VariableType, string> = {
  string: "Aa",
  number: "#",
  boolean: "T/F",
  date: "Cal",
  object: "{ }",
  array: "[ ]",
};

export const TYPE_COLORS: Record<VariableType, string> = {
  string: "#2563EB",
  number: "#7C3AED",
  boolean: "#059669",
  date: "#CA8A04",
  object: "#475569",
  array: "#0891B2",
};
