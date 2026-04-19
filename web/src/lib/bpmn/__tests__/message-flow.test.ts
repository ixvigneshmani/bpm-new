/* ─── P6.4 Message flow round-trip ──────────────────────────────────
 * - bpmn:MessageFlow emission at Collaboration scope
 * - Round-trip: flowType="message" edges survive export + re-import
 * - Without any pool: message flows dropped with warning
 * ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { serializeCanvasToBpmn } from "../serialize";
import { parseBpmnToCanvas } from "../parse";

function mkNode(p: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return { position: { x: 0, y: 0 }, data: {}, ...p } as Node;
}

describe("P6.4 message flows", () => {
  it("cross-pool message flow: emitted as bpmn:MessageFlow on the Collaboration", async () => {
    const nodes: Node[] = [
      mkNode({ id: "PA", type: "pool", data: { label: "A", bpmnType: "pool", participantName: "A" } }),
      mkNode({ id: "PB", type: "pool", position: { x: 0, y: 300 }, data: { label: "B", bpmnType: "pool", participantName: "B" } }),
      mkNode({ id: "a1", type: "userTask", parentId: "PA", data: { label: "A task", bpmnType: "userTask" } }),
      mkNode({ id: "b1", type: "userTask", parentId: "PB", data: { label: "B task", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [
      { id: "m1", source: "a1", target: "b1", data: { flowType: "message" } } as Edge,
    ];
    const { xml, warnings } = await serializeCanvasToBpmn(nodes, edges);
    // No cross-pool warning — it's a legitimate message flow now.
    expect(warnings.some((w) => /cross-pool sequence flow/i.test(w))).toBe(false);
    // MessageFlow element nested in Collaboration.
    const collab = xml.match(/<bpmn:collaboration[\s\S]*?<\/bpmn:collaboration>/i);
    expect(collab).toBeTruthy();
    expect(collab![0]).toMatch(/<bpmn:messageFlow[^>]*id="m1"[^>]*sourceRef="a1"[^>]*targetRef="b1"/i);
    // NOT emitted inside any Process.
    const processes = xml.match(/<bpmn:process[\s\S]*?<\/bpmn:process>/gi) || [];
    for (const p of processes) {
      expect(p).not.toMatch(/id="m1"/);
    }
  });

  it("round-trip: message flow survives export + re-import with flowType=message", async () => {
    const nodes: Node[] = [
      mkNode({ id: "PA", type: "pool", data: { label: "A", bpmnType: "pool", participantName: "A" } }),
      mkNode({ id: "PB", type: "pool", position: { x: 0, y: 300 }, data: { label: "B", bpmnType: "pool", participantName: "B" } }),
      mkNode({ id: "a1", type: "sendTask", parentId: "PA", data: { label: "Send", bpmnType: "sendTask" } }),
      mkNode({ id: "b1", type: "receiveTask", parentId: "PB", data: { label: "Recv", bpmnType: "receiveTask" } }),
    ];
    const edges: Edge[] = [
      { id: "m1", source: "a1", target: "b1", label: "Order", data: { flowType: "message" } } as Edge,
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    const result = await parseBpmnToCanvas(xml);
    const mf = result.edges.find((e) => e.id === "m1")!;
    expect(mf).toBeTruthy();
    expect(mf.source).toBe("a1");
    expect(mf.target).toBe("b1");
    expect((mf.data as { flowType?: string })?.flowType).toBe("message");
  });

  it("message flow without any pool: dropped with warning (requires Collaboration)", async () => {
    const nodes: Node[] = [
      mkNode({ id: "t1", type: "userTask", data: { label: "T1", bpmnType: "userTask" } }),
      mkNode({ id: "t2", type: "userTask", data: { label: "T2", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [
      { id: "m1", source: "t1", target: "t2", data: { flowType: "message" } } as Edge,
    ];
    const { xml, warnings } = await serializeCanvasToBpmn(nodes, edges);
    expect(warnings.some((w) => /message flow/i.test(w))).toBe(true);
    expect(xml).not.toContain(`id="m1"`);
  });

  it("sequence flow between different pools still drops with its own warning (not converted silently)", async () => {
    const nodes: Node[] = [
      mkNode({ id: "PA", type: "pool", data: { label: "A", bpmnType: "pool" } }),
      mkNode({ id: "PB", type: "pool", position: { x: 0, y: 300 }, data: { label: "B", bpmnType: "pool" } }),
      mkNode({ id: "a1", type: "userTask", parentId: "PA", data: { label: "A", bpmnType: "userTask" } }),
      mkNode({ id: "b1", type: "userTask", parentId: "PB", data: { label: "B", bpmnType: "userTask" } }),
    ];
    const edges: Edge[] = [
      { id: "x1", source: "a1", target: "b1" } as Edge, // no flowType
    ];
    const { xml, warnings } = await serializeCanvasToBpmn(nodes, edges);
    expect(warnings.some((w) => /cross-pool sequence flow/i.test(w))).toBe(true);
    expect(xml).not.toContain(`id="x1"`);
  });
});
