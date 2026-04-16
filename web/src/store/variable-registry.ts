/* ─── Variable Registry ──────────────────────────────────────────────
 * Derives a typed variable tree from the business document schema.
 * Provides autocomplete, type lookup, and a browsable tree for the
 * properties panel and FEEL expression inputs.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import useCanvasStore from "./canvas-store";

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

export type FlatVariable = {
  path: string;
  type: VariableType;
  required: boolean;
  depth: number;
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

/* ─── Hook: useVariableRegistry ─── */

export function useVariableRegistry() {
  const businessDoc = useCanvasStore((s) => s.processMeta.businessDoc);

  return useMemo(() => {
    if (!businessDoc || typeof businessDoc !== "object") {
      return {
        variables: [] as VariableNode[],
        flatList: [] as FlatVariable[],
        getType: (_path: string) => undefined as VariableType | undefined,
        getCompletions: (_prefix: string) => [] as FlatVariable[],
        isEmpty: true,
      };
    }

    const variables = parseSchemaToTree(businessDoc);
    const flatList = flattenTree(variables);

    const typeMap = new Map<string, VariableType>();
    for (const v of flatList) {
      typeMap.set(v.path, v.type);
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
    };
  }, [businessDoc]);
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
