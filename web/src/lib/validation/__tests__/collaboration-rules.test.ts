/* ─── P6.5 Collaboration validation rules ───────────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { runValidation } from "../index";

function mkNode(n: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return { position: { x: 0, y: 0 }, data: {}, ...n } as Node;
}

describe("P6.5 collaboration validation", () => {
  it("cross-pool sequence flow: flagged as error", () => {
    const nodes: Node[] = [
      mkNode({ id: "PA", type: "pool", data: { label: "A", bpmnType: "pool" } }),
      mkNode({ id: "PB", type: "pool", data: { label: "B", bpmnType: "pool" } }),
      mkNode({ id: "a1", type: "userTask", parentId: "PA", data: { label: "A", bpmnType: "userTask" } }),
      mkNode({ id: "b1", type: "userTask", parentId: "PB", data: { label: "B", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [{ id: "x1", source: "a1", target: "b1" } as Edge];
    const issues = runValidation(nodes, edges);
    const hit = issues.find((i) => i.ruleId === "sequence-flow-same-pool");
    expect(hit).toBeTruthy();
    expect(hit!.edgeId).toBe("x1");
  });

  it("same-pool message flow: flagged as error", () => {
    const nodes: Node[] = [
      mkNode({ id: "PA", type: "pool", data: { label: "A", bpmnType: "pool" } }),
      mkNode({ id: "t1", type: "userTask", parentId: "PA", data: { label: "T1", bpmnType: "userTask" } }),
      mkNode({ id: "t2", type: "userTask", parentId: "PA", data: { label: "T2", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [{ id: "m1", source: "t1", target: "t2", data: { flowType: "message" } } as Edge];
    const issues = runValidation(nodes, edges);
    const hit = issues.find((i) => i.ruleId === "message-flow-cross-pool");
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/same pool/i);
  });

  it("message flow with orphan endpoint (no pool at all): flagged", () => {
    const nodes: Node[] = [
      mkNode({ id: "t1", type: "userTask", data: { label: "T1", bpmnType: "userTask" } }),
      mkNode({ id: "t2", type: "userTask", data: { label: "T2", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [{ id: "m1", source: "t1", target: "t2", data: { flowType: "message" } } as Edge];
    const issues = runValidation(nodes, edges);
    const hit = issues.find((i) => i.ruleId === "message-flow-cross-pool");
    expect(hit).toBeTruthy();
  });

  it("lane without a pool ancestor: flagged", () => {
    const nodes: Node[] = [
      mkNode({ id: "L_orphan", type: "lane", data: { label: "Orphan", bpmnType: "lane" } }),
    ];
    const issues = runValidation(nodes, []);
    const hit = issues.find((i) => i.ruleId === "lane-requires-pool");
    expect(hit).toBeTruthy();
    expect(hit!.nodeId).toBe("L_orphan");
  });

  it("valid cross-pool message flow: no collaboration-related errors", () => {
    const nodes: Node[] = [
      mkNode({ id: "PA", type: "pool", data: { label: "A", bpmnType: "pool" } }),
      mkNode({ id: "PB", type: "pool", data: { label: "B", bpmnType: "pool" } }),
      mkNode({ id: "a1", type: "sendTask", parentId: "PA", data: { label: "Send", bpmnType: "sendTask" } }),
      mkNode({ id: "b1", type: "receiveTask", parentId: "PB", data: { label: "Recv", bpmnType: "receiveTask" } }),
    ];
    const edges: Edge[] = [{ id: "m1", source: "a1", target: "b1", data: { flowType: "message" } } as Edge];
    const issues = runValidation(nodes, edges);
    expect(issues.find((i) => i.ruleId === "message-flow-cross-pool")).toBeFalsy();
    expect(issues.find((i) => i.ruleId === "sequence-flow-same-pool")).toBeFalsy();
  });

  it("pool is NOT flagged as disconnected (not a flow-node participant)", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start", bpmnType: "startEvent" } }),
      mkNode({ id: "PA", type: "pool", data: { label: "Empty", bpmnType: "pool" } }),
    ];
    const issues = runValidation(nodes, []);
    const hit = issues.find((i) => i.ruleId === "disconnected-node" && i.nodeId === "PA");
    expect(hit).toBeFalsy();
  });
});
