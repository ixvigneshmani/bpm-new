/* ─── Sweep B validation rules — tests ─────────────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { runValidation } from "../index";

function mkNode(n: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return { position: { x: 0, y: 0 }, data: {}, ...n } as Node;
}

function mkEdge(e: Partial<Edge> & Pick<Edge, "id" | "source" | "target">): Edge {
  return { ...e } as Edge;
}

const start = mkNode({ id: "start", type: "startEvent", data: { label: "Start" } });
const end = mkNode({ id: "end", type: "endEvent", data: { label: "End" } });

describe("user-task-assignment", () => {
  it("flags a userTask with no assignment", () => {
    const nodes = [
      start,
      mkNode({ id: "t1", type: "userTask", data: { label: "Approve" } }),
      end,
    ];
    const edges = [
      mkEdge({ id: "e1", source: "start", target: "t1" }),
      mkEdge({ id: "e2", source: "t1", target: "end" }),
    ];
    const issues = runValidation(nodes, edges);
    const i = issues.find((x) => x.ruleId === "user-task-assignment");
    expect(i?.severity).toBe("error");
    expect(i?.nodeId).toBe("t1");
  });

  it("flags an empty assignment value", () => {
    const nodes = [
      start,
      mkNode({ id: "t1", type: "userTask", data: { label: "Approve", assignment: { type: "role", value: "" } } }),
      end,
    ];
    const issues = runValidation(nodes, [
      mkEdge({ id: "e1", source: "start", target: "t1" }),
      mkEdge({ id: "e2", source: "t1", target: "end" }),
    ]);
    expect(issues.find((x) => x.ruleId === "user-task-assignment")).toBeTruthy();
  });

  it("accepts a valid role assignment", () => {
    const nodes = [
      start,
      mkNode({ id: "t1", type: "userTask", data: { label: "Approve", assignment: { type: "role", value: "manager" } } }),
      end,
    ];
    const issues = runValidation(nodes, [
      mkEdge({ id: "e1", source: "start", target: "t1" }),
      mkEdge({ id: "e2", source: "t1", target: "end" }),
    ]);
    expect(issues.find((x) => x.ruleId === "user-task-assignment")).toBeUndefined();
  });
});

describe("gateway-non-exhaustive", () => {
  it("flags a gateway with conditions on every flow and no default", () => {
    const nodes = [
      start,
      mkNode({ id: "gw", type: "exclusiveGateway", data: { label: "Decide?" } }),
      mkNode({ id: "endA", type: "endEvent", data: { label: "A" } }),
      mkNode({ id: "endB", type: "endEvent", data: { label: "B" } }),
    ];
    const edges = [
      mkEdge({ id: "e1", source: "start", target: "gw" }),
      mkEdge({ id: "e2", source: "gw", target: "endA", data: { condition: "x > 0" } as Record<string, unknown> }),
      mkEdge({ id: "e3", source: "gw", target: "endB", data: { condition: "x <= 0" } as Record<string, unknown> }),
    ];
    const issues = runValidation(nodes, edges);
    const i = issues.find((x) => x.ruleId === "gateway-non-exhaustive");
    expect(i?.severity).toBe("warning");
    expect(i?.nodeId).toBe("gw");
  });

  it("is satisfied when a default flow is set", () => {
    const nodes = [
      start,
      mkNode({ id: "gw", type: "exclusiveGateway", data: { label: "Decide?", defaultFlowId: "e3" } }),
      mkNode({ id: "endA", type: "endEvent", data: { label: "A" } }),
      mkNode({ id: "endB", type: "endEvent", data: { label: "B" } }),
    ];
    const edges = [
      mkEdge({ id: "e1", source: "start", target: "gw" }),
      mkEdge({ id: "e2", source: "gw", target: "endA", data: { condition: "x > 0" } as Record<string, unknown> }),
      mkEdge({ id: "e3", source: "gw", target: "endB", data: { condition: "x <= 0" } as Record<string, unknown> }),
    ];
    const issues = runValidation(nodes, edges);
    expect(issues.find((x) => x.ruleId === "gateway-non-exhaustive")).toBeUndefined();
  });

  it("is satisfied when at least one flow has no condition", () => {
    const nodes = [
      start,
      mkNode({ id: "gw", type: "exclusiveGateway", data: { label: "Decide?" } }),
      mkNode({ id: "endA", type: "endEvent", data: { label: "A" } }),
      mkNode({ id: "endB", type: "endEvent", data: { label: "B" } }),
    ];
    const edges = [
      mkEdge({ id: "e1", source: "start", target: "gw" }),
      mkEdge({ id: "e2", source: "gw", target: "endA", data: { condition: "x > 0" } as Record<string, unknown> }),
      mkEdge({ id: "e3", source: "gw", target: "endB" }),
    ];
    const issues = runValidation(nodes, edges);
    expect(issues.find((x) => x.ruleId === "gateway-non-exhaustive")).toBeUndefined();
  });
});

describe("service-task-impl", () => {
  it("errors on a serviceTask with no implementation", () => {
    const nodes = [
      start,
      mkNode({ id: "s", type: "serviceTask", data: { label: "Notify" } }),
      end,
    ];
    const issues = runValidation(nodes, [
      mkEdge({ id: "e1", source: "start", target: "s" }),
      mkEdge({ id: "e2", source: "s", target: "end" }),
    ]);
    expect(issues.find((x) => x.ruleId === "service-task-impl")?.severity).toBe("error");
  });

  it("errors on externalWorker without jobType", () => {
    const nodes = [
      mkNode({ id: "s", type: "serviceTask", data: { label: "X", implementation: { type: "externalWorker", config: {} } } }),
    ];
    const issues = runValidation(nodes, []);
    expect(issues.find((x) => x.ruleId === "service-task-impl")).toBeTruthy();
  });

  it("errors on connector without operation", () => {
    const nodes = [
      mkNode({ id: "s", type: "serviceTask", data: { label: "X", implementation: { type: "connector", config: { connectorId: "mail" } } } }),
    ];
    const issues = runValidation(nodes, []);
    const i = issues.find((x) => x.ruleId === "service-task-impl");
    expect(i?.message).toMatch(/no operation/);
  });

  it("accepts a fully-configured connector", () => {
    const nodes = [
      mkNode({ id: "s", type: "serviceTask", data: { label: "X", implementation: { type: "connector", config: { connectorId: "mail", operation: "send" } } } }),
    ];
    const issues = runValidation(nodes, []);
    expect(issues.find((x) => x.ruleId === "service-task-impl")).toBeUndefined();
  });
});

describe("unreachable-node", () => {
  it("flags a node downstream of a dead-end (wired but not BFS-reachable)", () => {
    // start → a, then orphan chain b → c (b and c have edges among themselves
    // but neither is reachable from start).
    const nodes = [
      start,
      mkNode({ id: "a", type: "userTask", data: { label: "A", assignment: { type: "role", value: "manager" } } }),
      mkNode({ id: "b", type: "userTask", data: { label: "B", assignment: { type: "role", value: "manager" } } }),
      mkNode({ id: "c", type: "userTask", data: { label: "C", assignment: { type: "role", value: "manager" } } }),
      end,
    ];
    const edges = [
      mkEdge({ id: "e1", source: "start", target: "a" }),
      mkEdge({ id: "e2", source: "a", target: "end" }),
      mkEdge({ id: "e3", source: "b", target: "c" }),
    ];
    const issues = runValidation(nodes, edges);
    const ur = issues.filter((x) => x.ruleId === "unreachable-node");
    const ids = ur.map((i) => i.nodeId).sort();
    expect(ids).toEqual(["b", "c"]);
  });
});

describe("feel-expression", () => {
  it("errors on an unclosed string in an edge condition", () => {
    const nodes = [
      start,
      mkNode({ id: "gw", type: "exclusiveGateway", data: { label: "?" } }),
      mkNode({ id: "endA", type: "endEvent", data: { label: "A" } }),
    ];
    const edges = [
      mkEdge({ id: "e1", source: "start", target: "gw" }),
      mkEdge({ id: "e2", source: "gw", target: "endA", data: { condition: "amount > 'unclosed" } as Record<string, unknown> }),
    ];
    const issues = runValidation(nodes, edges);
    const i = issues.find((x) => x.ruleId === "feel-expression" && x.edgeId === "e2");
    expect(i?.severity).toBe("error");
    expect(i?.message).toMatch(/Unclosed/);
  });

  it("errors on a userTask assignment expression that isn't ${...}", () => {
    const nodes = [
      mkNode({
        id: "t1", type: "userTask",
        data: { label: "Approve", assignment: { type: "expression", value: "managerId" } },
      }),
    ];
    const issues = runValidation(nodes, []);
    const i = issues.find((x) => x.ruleId === "feel-expression" && x.nodeId === "t1");
    expect(i?.severity).toBe("error");
  });

  it("accepts a valid ${var} assignment expression", () => {
    const nodes = [
      mkNode({
        id: "t1", type: "userTask",
        data: { label: "Approve", assignment: { type: "expression", value: "${managerId}" } },
      }),
    ];
    const issues = runValidation(nodes, []);
    expect(issues.find((x) => x.ruleId === "feel-expression")).toBeUndefined();
  });
});

describe("call-activity-runtime", () => {
  // P4 Session 11 — callActivity is now wired end-to-end. The rule is
  // retained as a no-op placeholder; ensure it emits no issues.
  it("no longer flags callActivity (runtime shipped in Session 11)", () => {
    const nodes = [
      mkNode({ id: "ca", type: "callActivity", data: { label: "Child" } }),
    ];
    const issues = runValidation(nodes, []);
    const i = issues.find((x) => x.ruleId === "call-activity-runtime");
    expect(i).toBeUndefined();
  });
});
