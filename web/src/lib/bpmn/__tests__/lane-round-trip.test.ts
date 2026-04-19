/* ─── P6.3 Lane round-trip ───────────────────────────────────────────
 * - LaneSet emission with flowNodeRef
 * - Nested lanes via childLaneSet
 * - Flow nodes inside a lane: parse assigns parentId = lane.id
 * - Subprocess inside a lane still round-trips its own nested children
 * ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { serializeCanvasToBpmn } from "../serialize";
import { parseBpmnToCanvas } from "../parse";

function mkNode(p: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return { position: { x: 0, y: 0 }, data: {}, ...p } as Node;
}

describe("P6.3 lanes + flowNodeRef", () => {
  it("pool with two lanes: emits LaneSet with flowNodeRef pointing at lane contents", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", data: { label: "Process", bpmnType: "pool", participantName: "Process", width: 800, height: 240 } }),
      mkNode({ id: "L1", type: "lane", parentId: "P1", position: { x: 30, y: 0 }, data: { label: "Sales", bpmnType: "lane", isHorizontal: true, width: 770, height: 120 } }),
      mkNode({ id: "L2", type: "lane", parentId: "P1", position: { x: 30, y: 120 }, data: { label: "Ops", bpmnType: "lane", isHorizontal: true, width: 770, height: 120 } }),
      mkNode({ id: "t1", type: "userTask", parentId: "L1", data: { label: "Do Sales", bpmnType: "userTask" } }),
      mkNode({ id: "t2", type: "userTask", parentId: "L2", data: { label: "Do Ops", bpmnType: "userTask" } }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    // One LaneSet under the Process
    expect(xml).toMatch(/<bpmn:laneSet[^>]*id="LaneSet_P1"/i);
    // Two Lanes with their labels
    expect(xml).toMatch(/<bpmn:lane[^>]*id="L1"[^>]*name="Sales"/i);
    expect(xml).toMatch(/<bpmn:lane[^>]*id="L2"[^>]*name="Ops"/i);
    // flowNodeRef IDREFs — bpmn-moddle serializes as <flowNodeRef>id</flowNodeRef>
    expect(xml).toMatch(/<bpmn:flowNodeRef>t1<\/bpmn:flowNodeRef>/);
    expect(xml).toMatch(/<bpmn:flowNodeRef>t2<\/bpmn:flowNodeRef>/);
    // Flow nodes live in the Process's flowElements (flat), not inside the Lane
    const proc = xml.match(/<bpmn:process[\s\S]*?<\/bpmn:process>/i)![0];
    expect(proc).toMatch(/<bpmn:userTask[^>]*id="t1"/);
    expect(proc).toMatch(/<bpmn:userTask[^>]*id="t2"/);
  });

  it("round-trip: flow nodes in lanes get parentId = lane.id on import", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", position: { x: 100, y: 100 }, data: { label: "Pool", bpmnType: "pool", participantName: "Pool", width: 800, height: 240 } }),
      mkNode({ id: "L1", type: "lane", parentId: "P1", position: { x: 30, y: 0 }, data: { label: "Lane1", bpmnType: "lane", width: 770, height: 120 } }),
      mkNode({ id: "t1", type: "userTask", parentId: "L1", position: { x: 40, y: 20 }, data: { label: "T", bpmnType: "userTask" } }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);

    const pool = result.nodes.find((n) => n.id === "P1")!;
    const lane = result.nodes.find((n) => n.id === "L1")!;
    const task = result.nodes.find((n) => n.id === "t1")!;
    expect(pool.type).toBe("pool");
    expect(lane.type).toBe("lane");
    expect(lane.parentId).toBe("P1");
    expect(task.type).toBe("userTask");
    expect(task.parentId).toBe("L1");
    // Position correctness: lane-relative (~ 40, 20 — allowing for rounding).
    expect(task.position.x).toBe(40);
    expect(task.position.y).toBe(20);
  });

  it("nested lanes: childLaneSet serializes + parses", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", data: { label: "Pool", bpmnType: "pool" } }),
      mkNode({ id: "L1", type: "lane", parentId: "P1", data: { label: "Outer", bpmnType: "lane" } }),
      mkNode({ id: "L2", type: "lane", parentId: "L1", data: { label: "Inner", bpmnType: "lane" } }),
      mkNode({ id: "t1", type: "userTask", parentId: "L2", data: { label: "T", bpmnType: "userTask" } }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    // Outer lane has a childLaneSet containing the inner lane.
    expect(xml).toMatch(/<bpmn:lane[^>]*id="L1"[\s\S]*?<bpmn:childLaneSet[\s\S]*?<bpmn:lane[^>]*id="L2"/);
    const result = await parseBpmnToCanvas(xml);
    const inner = result.nodes.find((n) => n.id === "L2")!;
    const task = result.nodes.find((n) => n.id === "t1")!;
    expect(inner.parentId).toBe("L1");
    expect(task.parentId).toBe("L2");
  });

  it("subprocess inside a lane: lane's flowNodeRef lists the subprocess; subprocess keeps its own children", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", data: { label: "Pool", bpmnType: "pool" } }),
      mkNode({ id: "L1", type: "lane", parentId: "P1", data: { label: "Lane", bpmnType: "lane" } }),
      mkNode({ id: "SP", type: "subProcess", parentId: "L1", data: { label: "SP", bpmnType: "subProcess", isExpanded: true } }),
      mkNode({ id: "inner", type: "userTask", parentId: "SP", data: { label: "Inner", bpmnType: "userTask" } }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    // Lane references the subprocess.
    expect(xml).toMatch(/<bpmn:flowNodeRef>SP<\/bpmn:flowNodeRef>/);
    // Subprocess still carries its own inner child.
    expect(xml).toMatch(/<bpmn:subProcess[^>]*id="SP"[\s\S]*?<bpmn:userTask[^>]*id="inner"/);
    const result = await parseBpmnToCanvas(xml);
    const sp = result.nodes.find((n) => n.id === "SP")!;
    const inner = result.nodes.find((n) => n.id === "inner")!;
    expect(sp.parentId).toBe("L1");
    expect(inner.parentId).toBe("SP");
  });

  it("sequence flow between two flow nodes in the same pool (different lanes) lands in the Process", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", data: { label: "P", bpmnType: "pool" } }),
      mkNode({ id: "L1", type: "lane", parentId: "P1", data: { label: "L1", bpmnType: "lane" } }),
      mkNode({ id: "L2", type: "lane", parentId: "P1", data: { label: "L2", bpmnType: "lane" } }),
      mkNode({ id: "t1", type: "userTask", parentId: "L1", data: { label: "T1", bpmnType: "userTask" } }),
      mkNode({ id: "t2", type: "userTask", parentId: "L2", data: { label: "T2", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [{ id: "f1", source: "t1", target: "t2" } as Edge];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    const proc = xml.match(/<bpmn:process[\s\S]*?<\/bpmn:process>/i)![0];
    expect(proc).toMatch(/id="f1"/);
  });
});
