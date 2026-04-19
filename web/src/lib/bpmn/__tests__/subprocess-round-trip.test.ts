/* ─── P5 Subprocess round-trip + collapsed-size tests ─────────────────
 * Covers:
 *  - Nested subprocess serialize→parse retains parentId and positions
 *  - Event subprocess disambiguates via triggeredByEvent
 *  - Transaction round-trips with `method` protocol
 *  - Ad-hoc round-trips with `ordering`
 *  - Collapsed subprocess DI size uses the collapsed default, not the
 *    (possibly large) `data.width/height` from the expanded state
 * ──────────────────────────────────────────────────────────────────── */

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

describe("P5 subprocess round-trip", () => {
  it("nested subprocess: child parentId and positions survive serialize→parse", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "SP1", type: "subProcess",
        position: { x: 100, y: 100 },
        data: { label: "Parent SP", bpmnType: "subProcess", isExpanded: true, width: 400, height: 300 },
      }),
      mkNode({
        id: "T1", type: "userTask",
        position: { x: 40, y: 50 }, // relative to SP1
        parentId: "SP1", extent: "parent",
        data: { label: "Child Task", bpmnType: "userTask" },
      }),
    ];
    const edges: Edge[] = [];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    const result = await parseBpmnToCanvas(xml);

    const parentOut = result.nodes.find((n) => n.id === "SP1")!;
    const childOut = result.nodes.find((n) => n.id === "T1")!;

    expect(parentOut).toBeDefined();
    expect(parentOut.type).toBe("subProcess");
    expect(parentOut.position).toEqual({ x: 100, y: 100 });

    expect(childOut).toBeDefined();
    expect(childOut.parentId).toBe("SP1");
    expect(childOut.extent).toBe("parent");
    // Parent-relative on re-import must match the original (40, 50).
    expect(childOut.position).toEqual({ x: 40, y: 50 });
  });

  it("event subprocess: disambiguates via triggeredByEvent on parse", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "SP1", type: "subProcess",
        position: { x: 0, y: 0 },
        data: { label: "Outer", bpmnType: "subProcess", isExpanded: true, width: 500, height: 400 },
      }),
      mkNode({
        id: "ESP1", type: "eventSubProcess",
        position: { x: 20, y: 30 },
        parentId: "SP1", extent: "parent",
        data: {
          label: "On Timer", bpmnType: "eventSubProcess",
          isExpanded: true, triggeredByEvent: true, width: 300, height: 150,
        },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);
    const esp = result.nodes.find((n) => n.id === "ESP1")!;
    expect(esp).toBeDefined();
    expect(esp.type).toBe("eventSubProcess");
    expect((esp.data as { triggeredByEvent?: boolean }).triggeredByEvent).toBe(true);
  });

  it("transaction: `method` protocol round-trips", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "TX1", type: "transaction",
        position: { x: 0, y: 0 },
        data: { label: "Payment", bpmnType: "transaction", isExpanded: true, method: "##Compensate" },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);
    const tx = result.nodes.find((n) => n.id === "TX1")!;
    expect(tx.type).toBe("transaction");
    expect((tx.data as { method?: string }).method).toBe("##Compensate");
  });

  it("ad-hoc: `ordering` round-trips (default Parallel)", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "AH1", type: "adHocSubProcess",
        position: { x: 0, y: 0 },
        data: { label: "Free-form", bpmnType: "adHocSubProcess", isExpanded: true, ordering: "Sequential" },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);
    const ah = result.nodes.find((n) => n.id === "AH1")!;
    expect(ah.type).toBe("adHocSubProcess");
    expect((ah.data as { ordering?: string }).ordering).toBe("Sequential");
  });

  it("sequence flow between siblings in a subprocess lives in that subprocess's scope", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "SP1", type: "subProcess",
        position: { x: 0, y: 0 },
        data: { label: "SP", bpmnType: "subProcess", isExpanded: true, width: 500, height: 300 },
      }),
      mkNode({
        id: "S1", type: "startEvent",
        position: { x: 20, y: 100 },
        parentId: "SP1", extent: "parent",
        data: { label: "Inner Start", bpmnType: "startEvent", eventDefinition: { kind: "none" } },
      }),
      mkNode({
        id: "E1", type: "endEvent",
        position: { x: 300, y: 100 },
        parentId: "SP1", extent: "parent",
        data: { label: "Inner End", bpmnType: "endEvent", eventDefinition: { kind: "none" } },
      }),
    ];
    const edges: Edge[] = [
      { id: "f1", source: "S1", target: "E1" } as Edge,
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, edges);
    // Flow must appear nested inside the subprocess element, not at the process root.
    const outerProcessMatch = xml.match(/<bpmn:process[\s\S]*?<\/bpmn:process>/i);
    expect(outerProcessMatch).toBeTruthy();
    const processXml = outerProcessMatch![0];
    const subprocessMatch = processXml.match(/<bpmn:subProcess[^>]*id="SP1"[\s\S]*?<\/bpmn:subProcess>/i);
    expect(subprocessMatch).toBeTruthy();
    expect(subprocessMatch![0]).toContain(`id="f1"`);

    // On re-import the edge still connects S1→E1, no duplication.
    const result = await parseBpmnToCanvas(xml);
    const flows = result.edges.filter((e) => e.source === "S1" && e.target === "E1");
    expect(flows).toHaveLength(1);
  });

  it("collapsed subprocess: DI emits the collapsed default size, not data.width/height", async () => {
    // User expanded the frame to 800×500, then collapsed it. The in-canvas
    // render picks collapsed shape dimensions; so should the DI export.
    const nodes: Node[] = [
      mkNode({
        id: "SP1", type: "subProcess",
        position: { x: 100, y: 100 },
        data: {
          label: "SP", bpmnType: "subProcess",
          isExpanded: false, width: 800, height: 500,
        },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    // Extract SP1's dc:Bounds. The collapsed default is 120×80.
    const boundsMatch = xml.match(/<bpmndi:BPMNShape[^>]*bpmnElement="SP1"[\s\S]*?<dc:Bounds[^/]*\/>/);
    expect(boundsMatch).toBeTruthy();
    const bounds = boundsMatch![0];
    expect(bounds).toMatch(/width="120"/);
    expect(bounds).toMatch(/height="80"/);
    // And isExpanded is explicitly emitted as false on the shape.
    expect(boundsMatch![0]).toBeDefined();
    const shapeMatch = xml.match(/<bpmndi:BPMNShape[^>]*bpmnElement="SP1"[^>]*>/);
    expect(shapeMatch![0]).toMatch(/isExpanded="false"/);
  });

  it("round-trip preserves isExpanded=false", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "SP1", type: "subProcess",
        position: { x: 0, y: 0 },
        data: { label: "SP", bpmnType: "subProcess", isExpanded: false },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);
    const sp = result.nodes.find((n) => n.id === "SP1")!;
    expect((sp.data as { isExpanded?: boolean }).isExpanded).toBe(false);
  });
});
