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

  // ─── P2 Session 5: subprocess-inner-start rule ───────────────────
  it("flags an error when a subprocess has no `none`-type inner start event", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "end", type: "endEvent", data: { label: "End" } }),
      mkNode({ id: "SP", type: "subProcess", data: { label: "SP", bpmnType: "subProcess" } }),
      // Inner timer start — NOT a `none` start, so engine can't enter.
      mkNode({ id: "is", type: "startEvent", parentId: "SP", data: { label: "Timer in", eventDefinition: { kind: "timer", timerType: "duration", value: "PT5M" } } }),
      mkNode({ id: "ie", type: "endEvent", parentId: "SP", data: { label: "Inner end" } }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "start", target: "SP" } as Edge,
      { id: "e2", source: "SP", target: "end" } as Edge,
      { id: "ei", source: "is", target: "ie" } as Edge,
    ];
    const issues = runValidation(nodes, edges);
    const hit = issues.find((i) => i.ruleId === "subprocess-inner-start" && i.nodeId === "SP");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("error");
    expect(hit!.message).toMatch(/no `none`-type inner start/i);
  });

  it("flags info when a subprocess has multiple `none`-type inner start events", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "SP", type: "subProcess", data: { label: "SP", bpmnType: "subProcess" } }),
      mkNode({ id: "is1", type: "startEvent", parentId: "SP", data: { label: "Start 1", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "is2", type: "startEvent", parentId: "SP", data: { label: "Start 2", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "ie", type: "endEvent", parentId: "SP", data: { label: "Inner end" } }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "start", target: "SP" } as Edge,
    ];
    const issues = runValidation(nodes, edges);
    const hit = issues.find((i) => i.ruleId === "subprocess-inner-start" && i.nodeId === "SP");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("info");
    expect(hit!.message).toMatch(/multiple|2|first by canvas order/i);
  });

  it("does NOT flag a subprocess with exactly one `none` inner start event", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "SP", type: "subProcess", data: { label: "SP", bpmnType: "subProcess" } }),
      mkNode({ id: "is", type: "startEvent", parentId: "SP", data: { label: "Inner start", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "ie", type: "endEvent", parentId: "SP", data: { label: "Inner end" } }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "start", target: "SP" } as Edge,
      { id: "ei", source: "is", target: "ie" } as Edge,
    ];
    const issues = runValidation(nodes, edges);
    const hit = issues.find((i) => i.ruleId === "subprocess-inner-start" && i.nodeId === "SP");
    expect(hit).toBeFalsy();
  });

  // ─── P2 Session 5: subprocess-runtime rule narrowed to eventSubProcess ──
  it("subprocess-runtime no longer fires for subProcess/transaction/adHocSubProcess after Session 5", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "SP", type: "subProcess", data: { label: "SP", bpmnType: "subProcess" } }),
      mkNode({ id: "TX", type: "transaction", data: { label: "TX", bpmnType: "transaction" } }),
      mkNode({ id: "AD", type: "adHocSubProcess", data: { label: "AD", bpmnType: "adHocSubProcess" } }),
      mkNode({ id: "is1", type: "startEvent", parentId: "SP", data: { label: "S", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "is2", type: "startEvent", parentId: "TX", data: { label: "S", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "is3", type: "startEvent", parentId: "AD", data: { label: "S", eventDefinition: { kind: "none" } } }),
    ];
    const issues = runValidation(nodes, []);
    const hits = issues.filter((i) => i.ruleId === "subprocess-runtime");
    expect(hits).toHaveLength(0);
  });

  it("subprocess-runtime still fires for eventSubProcess (Session 6 work)", () => {
    const nodes: Node[] = [
      mkNode({ id: "start", type: "startEvent", data: { label: "Start" } }),
      mkNode({ id: "ESP", type: "eventSubProcess", data: { label: "ESP", bpmnType: "eventSubProcess" } }),
      mkNode({ id: "is", type: "startEvent", parentId: "ESP", data: { label: "Trig", eventDefinition: { kind: "message", messageName: "Foo" } } }),
      mkNode({ id: "ie", type: "endEvent", parentId: "ESP", data: { label: "End" } }),
    ];
    const issues = runValidation(nodes, []);
    const hit = issues.find((i) => i.ruleId === "subprocess-runtime" && i.nodeId === "ESP");
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/Session 6/);
  });
});
