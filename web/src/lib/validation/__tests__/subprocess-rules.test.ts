/* ─── P5 scope-aware validation rules ───────────────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { runValidation } from "../index";

function mkNode(n: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return { position: { x: 0, y: 0 }, data: {}, ...n } as Node;
}

describe("P5 scope-aware validation", () => {
  it("no-start-event fires per-subprocess scope", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "SP1", type: "subProcess", data: { label: "SP", bpmnType: "subProcess", isExpanded: true } }),
      mkNode({ id: "T1", type: "userTask", parentId: "SP1", data: { label: "T", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "start", target: "SP1" } as Edge,
    ];
    const issues = runValidation(nodes, edges);
    const missing = issues.filter((i) => i.ruleId === "no-start-event");
    expect(missing).toHaveLength(1);
    expect(missing[0].nodeId).toBe("SP1");
    expect(missing[0].message).toMatch(/subprocess "SP"/);
  });

  it("event subprocess: flags empty (no start event) as a trigger error", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "SP1", type: "subProcess", data: { label: "Outer", bpmnType: "subProcess", isExpanded: true } }),
      mkNode({
        id: "ESP", type: "eventSubProcess", parentId: "SP1",
        data: { label: "On Timer", bpmnType: "eventSubProcess", triggeredByEvent: true, isExpanded: true },
      }),
    ];
    const issues = runValidation(nodes, []);
    const ids = issues.map((i) => i.ruleId);
    expect(ids).toContain("event-subprocess-trigger");
    expect(issues.find((i) => i.ruleId === "event-subprocess-trigger" && i.nodeId === "ESP")).toBeTruthy();
  });

  it("event subprocess: flags inner start event without event definition", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Root Start" } }),
      mkNode({ id: "SP1", type: "subProcess", data: { label: "Outer", bpmnType: "subProcess", isExpanded: true } }),
      mkNode({
        id: "ESP", type: "eventSubProcess", parentId: "SP1",
        data: { label: "On Timer", bpmnType: "eventSubProcess", triggeredByEvent: true, isExpanded: true },
      }),
      mkNode({
        id: "ESPSTART", type: "startEvent", parentId: "ESP",
        data: { label: "Inner", bpmnType: "startEvent", eventDefinition: { kind: "none" } },
      }),
    ];
    const issues = runValidation(nodes, []);
    const hit = issues.find((i) => i.ruleId === "event-subprocess-trigger" && i.nodeId === "ESPSTART");
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/event definition/);
  });

  it("event subprocess at root: flagged by nesting rule", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({
        id: "ESP", type: "eventSubProcess",
        data: { label: "Orphan", bpmnType: "eventSubProcess", triggeredByEvent: true, isExpanded: true },
      }),
    ];
    const issues = runValidation(nodes, []);
    const hit = issues.find((i) => i.ruleId === "event-subprocess-nesting");
    expect(hit).toBeTruthy();
    expect(hit!.nodeId).toBe("ESP");
  });

  it("boundary event attached to a gateway: flagged as invalid host", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "GW", type: "exclusiveGateway", data: { label: "GW", bpmnType: "exclusiveGateway" } }),
      mkNode({
        id: "B", type: "boundaryEvent",
        data: { label: "B", bpmnType: "boundaryEvent", attachedToRef: "GW", eventDefinition: { kind: "none" } },
      }),
    ];
    const issues = runValidation(nodes, []);
    const hit = issues.find((i) => i.ruleId === "boundary-invalid-host");
    expect(hit).toBeTruthy();
    expect(hit!.nodeId).toBe("B");
    expect(hit!.message).toMatch(/must attach to an activity/);
  });

  it("boundary event attached to a subprocess: accepted (subprocess is a valid host)", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "SP", type: "subProcess", data: { label: "SP", bpmnType: "subProcess", isExpanded: true } }),
      mkNode({
        id: "B", type: "boundaryEvent",
        data: { label: "B", bpmnType: "boundaryEvent", attachedToRef: "SP", eventDefinition: { kind: "timer", timerType: "duration", value: "PT5M" } },
      }),
    ];
    const issues = runValidation(nodes, []);
    const invalidHost = issues.filter((i) => i.ruleId === "boundary-invalid-host");
    expect(invalidHost).toHaveLength(0);
  });

  it("disconnected-node does NOT flag a subprocess frame that contains children", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "end", type: "endEvent", data: { label: "End" } }),
      mkNode({ id: "SP", type: "subProcess", data: { label: "SP", bpmnType: "subProcess", isExpanded: true } }),
      mkNode({ id: "T", type: "userTask", parentId: "SP", data: { label: "T", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "start", target: "end" } as Edge,
    ];
    const issues = runValidation(nodes, edges);
    const hit = issues.find((i) => i.ruleId === "disconnected-node" && i.nodeId === "SP");
    expect(hit).toBeFalsy();
  });
});
