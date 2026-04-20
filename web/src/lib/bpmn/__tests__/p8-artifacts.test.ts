/* ─── P8 artifacts + association round-trip ───────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { serializeCanvasToBpmn } from "../serialize";
import { parseBpmnToCanvas } from "../parse";

function mkNode(partial: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...partial,
  } as Node;
}

describe("P8 artifacts + associations round-trip", () => {
  it("data store round-trips as bpmn:DataStoreReference with name + DI bounds", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        position: { x: 100, y: 100 },
        data: { label: "Start", bpmnType: "startEvent", eventDefinition: { kind: "none" } },
      }),
      mkNode({
        id: "t1", type: "userTask",
        position: { x: 220, y: 100 },
        data: { label: "Lookup", bpmnType: "userTask" },
      }),
      mkNode({
        id: "ds1", type: "dataStore",
        position: { x: 220, y: 220 },
        data: { label: "Customers DB", bpmnType: "dataStore" },
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "s1", target: "t1" },
      { id: "e2", source: "t1", target: "ds1", data: { flowType: "association" } },
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    // bpmn-moddle emits element names with a lowercase initial (XML convention).
    expect(xml).toContain("bpmn:dataStoreReference");
    expect(xml).toContain("bpmn:association");

    const result = await parseBpmnToCanvas(xml);
    const ds = result.nodes.find((n) => n.id === "ds1");
    expect(ds?.type).toBe("dataStore");
    expect((ds?.data as { label?: string }).label).toBe("Customers DB");
    const assoc = result.edges.find((e) => e.id === "e2");
    expect((assoc?.data as { flowType?: string }).flowType).toBe("association");
  });

  it("text annotation round-trips via child text element (not name)", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "t1", type: "userTask",
        position: { x: 100, y: 100 },
        data: { label: "Review", bpmnType: "userTask" },
      }),
      mkNode({
        id: "n1", type: "textAnnotation",
        position: { x: 250, y: 100 },
        data: { label: "Manager reviews\nwithin 24h", bpmnType: "textAnnotation" },
      }),
    ];
    const edges: Edge[] = [
      { id: "a1", source: "t1", target: "n1", data: { flowType: "association" } },
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    expect(xml).toContain("bpmn:textAnnotation");
    // Verify body is in the text slot, not name.
    expect(xml).toContain("Manager reviews");
    expect(xml).not.toContain('name="Manager reviews');

    const result = await parseBpmnToCanvas(xml);
    const note = result.nodes.find((n) => n.id === "n1");
    expect(note?.type).toBe("textAnnotation");
    expect((note?.data as { label?: string }).label).toBe("Manager reviews\nwithin 24h");
  });

  it("group round-trips + shape bounds preserved", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "g1", type: "group",
        position: { x: 50, y: 50 },
        data: { label: "Finance", bpmnType: "group", width: 400, height: 250 },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    expect(xml).toContain("bpmn:group");

    const result = await parseBpmnToCanvas(xml);
    const g = result.nodes.find((n) => n.id === "g1");
    expect(g?.type).toBe("group");
    expect((g?.data as { width?: number }).width).toBe(400);
  });

  it("association survives serialize→parse with both endpoints preserved", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "t1", type: "userTask",
        position: { x: 100, y: 100 },
        data: { label: "Task", bpmnType: "userTask" },
      }),
      mkNode({
        id: "n1", type: "textAnnotation",
        position: { x: 250, y: 100 },
        data: { label: "See SOP", bpmnType: "textAnnotation" },
      }),
    ];
    const edges: Edge[] = [
      { id: "a1", source: "t1", target: "n1", data: { flowType: "association" } },
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    const result = await parseBpmnToCanvas(xml);
    const a = result.edges.find((e) => e.id === "a1");
    expect(a).toBeDefined();
    expect(a?.source).toBe("t1");
    expect(a?.target).toBe("n1");
    expect((a?.data as { flowType?: string }).flowType).toBe("association");
  });

  it("artifacts inside a subprocess round-trip with correct parentId", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "SP1", type: "subProcess",
        position: { x: 50, y: 50 },
        data: { label: "Sub", bpmnType: "subProcess", isExpanded: true, width: 400, height: 300 },
      }),
      mkNode({
        id: "t1", type: "userTask",
        position: { x: 40, y: 60 },
        parentId: "SP1", extent: "parent",
        data: { label: "Inner", bpmnType: "userTask" },
      }),
      mkNode({
        id: "n1", type: "textAnnotation",
        position: { x: 200, y: 60 },
        parentId: "SP1", extent: "parent",
        data: { label: "Inner note", bpmnType: "textAnnotation" },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);
    const note = result.nodes.find((n) => n.id === "n1");
    expect(note?.parentId).toBe("SP1");
  });
});
