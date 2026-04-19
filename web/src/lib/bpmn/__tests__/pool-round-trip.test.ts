/* ─── P6.2 Pool + Collaboration wrapping round-trip ──────────────────
 * Backwards compat:
 *   - When no pool exists, XML shape is identical to P5 (flat Process).
 *   - Once ≥1 pool exists, Collaboration wraps Process(es).
 * ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { serializeCanvasToBpmn } from "../serialize";
import { parseBpmnToCanvas } from "../parse";

function mkNode(p: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return { position: { x: 0, y: 0 }, data: {}, ...p } as Node;
}

describe("P6.2 pool + collaboration", () => {
  it("no pool on canvas: no Collaboration in the XML (flat Process)", async () => {
    const nodes: Node[] = [
      mkNode({ id: "s1", type: "startEvent", data: { label: "Start", bpmnType: "startEvent", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "e1", type: "endEvent", data: { label: "End", bpmnType: "endEvent", eventDefinition: { kind: "none" } } }),
    ];
    const edges: Edge[] = [{ id: "f1", source: "s1", target: "e1" } as Edge];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    expect(xml).not.toMatch(/<bpmn:collaboration/i);
    expect(xml).toMatch(/<bpmn:process[^>]*id="Process_1"/);
  });

  it("one pool with flow nodes: emits Collaboration + Participant + Process", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", position: { x: 0, y: 0 }, data: { label: "Customer", bpmnType: "pool", participantName: "Customer", isHorizontal: true, width: 800, height: 240 } }),
      mkNode({ id: "s1", type: "startEvent", parentId: "P1", position: { x: 60, y: 100 }, data: { label: "Start", bpmnType: "startEvent", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "e1", type: "endEvent", parentId: "P1", position: { x: 400, y: 100 }, data: { label: "End", bpmnType: "endEvent", eventDefinition: { kind: "none" } } }),
    ];
    const edges: Edge[] = [{ id: "f1", source: "s1", target: "e1" } as Edge];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    expect(xml).toMatch(/<bpmn:collaboration[^>]*id="Collaboration_Process_1"/i);
    expect(xml).toMatch(/<bpmn:participant[^>]*id="P1"[^>]*name="Customer"/i);
    expect(xml).toMatch(/<bpmn:process[^>]*id="Process_P1"/i);
    // The DI plane targets the Collaboration.
    expect(xml).toMatch(/<bpmndi:bpmnPlane[^>]*bpmnElement="Collaboration_Process_1"/i);
  });

  it("two pools: two Processes, two Participants, one Collaboration", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", data: { label: "A", bpmnType: "pool", participantName: "A", width: 800, height: 240 } }),
      mkNode({ id: "P2", type: "pool", position: { x: 0, y: 300 }, data: { label: "B", bpmnType: "pool", participantName: "B", width: 800, height: 240 } }),
      mkNode({ id: "a1", type: "startEvent", parentId: "P1", data: { label: "aStart", bpmnType: "startEvent", eventDefinition: { kind: "none" } } }),
      mkNode({ id: "b1", type: "startEvent", parentId: "P2", data: { label: "bStart", bpmnType: "startEvent", eventDefinition: { kind: "none" } } }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const processMatches = xml.match(/<bpmn:process\b/gi) || [];
    const participantMatches = xml.match(/<bpmn:participant\b/gi) || [];
    const collabMatches = xml.match(/<bpmn:collaboration\b/gi) || [];
    expect(processMatches).toHaveLength(2);
    expect(participantMatches).toHaveLength(2);
    expect(collabMatches).toHaveLength(1);
  });

  it("round-trip: pool + children preserve parentId and positions", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", position: { x: 100, y: 100 }, data: { label: "Customer", bpmnType: "pool", participantName: "Customer", width: 800, height: 240 } }),
      mkNode({ id: "s1", type: "startEvent", parentId: "P1", position: { x: 50, y: 80 }, data: { label: "Start", bpmnType: "startEvent", eventDefinition: { kind: "none" } } }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);

    const pool = result.nodes.find((n) => n.id === "P1")!;
    const start = result.nodes.find((n) => n.id === "s1")!;
    expect(pool.type).toBe("pool");
    expect(pool.position).toEqual({ x: 100, y: 100 });
    expect((pool.data as { participantName?: string }).participantName).toBe("Customer");

    expect(start.parentId).toBe("P1");
    expect(start.extent).toBe("parent");
    expect(start.position).toEqual({ x: 50, y: 80 });
  });

  it("orphan flow nodes when pools exist: emit warning and host them in first pool", async () => {
    const nodes: Node[] = [
      mkNode({ id: "P1", type: "pool", data: { label: "A", bpmnType: "pool", participantName: "A" } }),
      // s1 has no parentId — orphan.
      mkNode({ id: "s1", type: "startEvent", position: { x: 100, y: 100 }, data: { label: "OrphanStart", bpmnType: "startEvent", eventDefinition: { kind: "none" } } }),
    ];
    const { xml, warnings } = await serializeCanvasToBpmn(nodes, []);
    expect(warnings.some((w) => /outside any pool/.test(w))).toBe(true);
    // s1 lands inside P1's Process.
    const poolProcess = xml.match(/<bpmn:process[^>]*id="Process_P1"[\s\S]*?<\/bpmn:process>/i);
    expect(poolProcess).toBeTruthy();
    expect(poolProcess![0]).toContain('id="s1"');
  });

  it("pool DI: emits BPMNShape with isHorizontal + correct bounds", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "P1", type: "pool", position: { x: 50, y: 60 },
        data: { label: "A", bpmnType: "pool", isHorizontal: true, width: 900, height: 250 },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const shape = xml.match(/<bpmndi:bpmnShape[^>]*bpmnElement="P1"[\s\S]*?<\/bpmndi:bpmnShape>/i);
    expect(shape).toBeTruthy();
    expect(shape![0]).toMatch(/isHorizontal="true"/);
    expect(shape![0]).toMatch(/x="50"/);
    expect(shape![0]).toMatch(/y="60"/);
    expect(shape![0]).toMatch(/width="900"/);
    expect(shape![0]).toMatch(/height="250"/);
  });
});
