/* ─── P6.1 Root declarations round-trip ─────────────────────────────── */

import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { serializeCanvasToBpmn } from "../serialize";
import { parseBpmnToCanvas } from "../parse";

function mkNode(p: Partial<Node> & Pick<Node, "id" | "type">): Node {
  return { position: { x: 0, y: 0 }, data: {}, ...p } as Node;
}

describe("P6.1 root declarations (Message/Signal/Error)", () => {
  it("emits bpmn:Message with a messageRef on the event definition", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        data: {
          label: "On Order", bpmnType: "startEvent",
          eventDefinition: { kind: "message", messageName: "OrderReceived" },
        },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    expect(xml).toMatch(/<bpmn:message[^>]*id="Message_OrderReceived"[^>]*name="OrderReceived"/i);
    expect(xml).toMatch(/<bpmn:messageEventDefinition[^>]*messageRef="Message_OrderReceived"/i);
  });

  it("de-duplicates declarations referenced by multiple events", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        data: { label: "A", bpmnType: "startEvent", eventDefinition: { kind: "signal", signalName: "Fire" } },
      }),
      mkNode({
        id: "s2", type: "intermediateCatchEvent",
        data: { label: "B", bpmnType: "intermediateCatchEvent", eventDefinition: { kind: "signal", signalName: "Fire" } },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const matches = xml.match(/<bpmn:signal[^>]*id="Signal_Fire"/gi);
    expect(matches).toHaveLength(1);
    expect(xml).toMatch(/signalRef="Signal_Fire"/gi);
  });

  it("round-trip: message / signal / error names survive via refs", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        data: { label: "A", bpmnType: "startEvent", eventDefinition: { kind: "message", messageName: "OrderReceived" } },
      }),
      mkNode({
        id: "s2", type: "intermediateCatchEvent",
        data: { label: "B", bpmnType: "intermediateCatchEvent", eventDefinition: { kind: "signal", signalName: "Cancelled" } },
      }),
      mkNode({
        id: "e1", type: "endEvent",
        data: { label: "E", bpmnType: "endEvent", eventDefinition: { kind: "error", errorCode: "ERR_PAYMENT" } },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const result = await parseBpmnToCanvas(xml);

    const msg = result.nodes.find((n) => n.id === "s1")!.data as { eventDefinition?: { kind: string; messageName?: string } };
    const sig = result.nodes.find((n) => n.id === "s2")!.data as { eventDefinition?: { kind: string; signalName?: string } };
    const err = result.nodes.find((n) => n.id === "e1")!.data as { eventDefinition?: { kind: string; errorCode?: string } };

    expect(msg.eventDefinition?.kind).toBe("message");
    expect(msg.eventDefinition?.messageName).toBe("OrderReceived");
    expect(sig.eventDefinition?.kind).toBe("signal");
    expect(sig.eventDefinition?.signalName).toBe("Cancelled");
    expect(err.eventDefinition?.kind).toBe("error");
    expect(err.eventDefinition?.errorCode).toBe("ERR_PAYMENT");
  });

  it("root declarations appear before the Process in rootElements", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        data: { label: "A", bpmnType: "startEvent", eventDefinition: { kind: "message", messageName: "M" } },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    // order check: bpmn:message should appear before bpmn:process
    const msgIdx = xml.toLowerCase().indexOf("<bpmn:message ");
    const procIdx = xml.toLowerCase().indexOf("<bpmn:process");
    expect(msgIdx).toBeGreaterThan(-1);
    expect(procIdx).toBeGreaterThan(-1);
    expect(msgIdx).toBeLessThan(procIdx);
  });

  it("names with whitespace produce XML-safe ids", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        data: {
          label: "A", bpmnType: "startEvent",
          eventDefinition: { kind: "message", messageName: "Order Received v2" },
        },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    expect(xml).toMatch(/id="Message_Order_Received_v2"/);
    // Re-import: the name (with spaces) is restored.
    const result = await parseBpmnToCanvas(xml);
    const s1 = result.nodes.find((n) => n.id === "s1")!;
    expect((s1.data as { eventDefinition?: { messageName?: string } }).eventDefinition?.messageName)
      .toBe("Order Received v2");
  });

  it("distinct names that normalize to the same base id get unique ids", async () => {
    // All three normalize to "Message_Order_Received".
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        data: { label: "A", bpmnType: "startEvent", eventDefinition: { kind: "message", messageName: "Order Received" } },
      }),
      mkNode({
        id: "s2", type: "intermediateCatchEvent",
        data: { label: "B", bpmnType: "intermediateCatchEvent", eventDefinition: { kind: "message", messageName: "Order_Received" } },
      }),
      mkNode({
        id: "s3", type: "intermediateCatchEvent",
        data: { label: "C", bpmnType: "intermediateCatchEvent", eventDefinition: { kind: "message", messageName: "Order-Received" } },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    const ids = [...xml.matchAll(/<bpmn:message[^>]*id="([^"]+)"/gi)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);

    const result = await parseBpmnToCanvas(xml);
    const names = ["s1", "s2", "s3"].map(
      (id) => (result.nodes.find((n) => n.id === id)!.data as { eventDefinition?: { messageName?: string } })
        .eventDefinition?.messageName,
    );
    expect(names).toEqual(["Order Received", "Order_Received", "Order-Received"]);
  });

  it("all-special-character names still produce a valid id", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "s1", type: "startEvent",
        data: { label: "A", bpmnType: "startEvent", eventDefinition: { kind: "message", messageName: "!!!" } },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    // Must contain some message element; the fallback slug keeps it valid.
    expect(xml).toMatch(/<bpmn:message[^>]*id="Message_[A-Za-z0-9_]+/i);
  });

  it("intermediate throw event with messageName: emits messageRef", async () => {
    const nodes: Node[] = [
      mkNode({
        id: "t1", type: "intermediateThrowEvent",
        data: { label: "Notify", bpmnType: "intermediateThrowEvent", eventDefinition: { kind: "message", messageName: "ShipmentReady" } },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    expect(xml).toMatch(/messageRef="Message_ShipmentReady"/);
    const result = await parseBpmnToCanvas(xml);
    const t1 = result.nodes.find((n) => n.id === "t1")!;
    expect((t1.data as { eventDefinition?: { messageName?: string } }).eventDefinition?.messageName).toBe("ShipmentReady");
  });

  it("boundary event with errorCode: emits bpmn:Error and errorRef", async () => {
    const nodes: Node[] = [
      mkNode({ id: "T", type: "userTask", data: { label: "T", bpmnType: "userTask" } }),
      mkNode({
        id: "b1", type: "boundaryEvent",
        data: {
          label: "On Err", bpmnType: "boundaryEvent",
          attachedToRef: "T",
          eventDefinition: { kind: "error", errorCode: "ERR_PAYMENT" },
        },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    expect(xml).toMatch(/<bpmn:error[^>]*id="Error_ERR_PAYMENT"/i);
    expect(xml).toMatch(/errorRef="Error_ERR_PAYMENT"/);
    const result = await parseBpmnToCanvas(xml);
    const b1 = result.nodes.find((n) => n.id === "b1")!;
    expect((b1.data as { eventDefinition?: { errorCode?: string } }).eventDefinition?.errorCode).toBe("ERR_PAYMENT");
  });

  it("event subprocess with signal-triggered start event: signalRef round-trips", async () => {
    const nodes: Node[] = [
      mkNode({ id: "SP", type: "subProcess", data: { label: "SP", bpmnType: "subProcess", isExpanded: true } }),
      mkNode({
        id: "ESP", type: "eventSubProcess", parentId: "SP",
        data: { label: "On Fire", bpmnType: "eventSubProcess", triggeredByEvent: true, isExpanded: true },
      }),
      mkNode({
        id: "ES", type: "startEvent", parentId: "ESP",
        data: { label: "In", bpmnType: "startEvent", eventDefinition: { kind: "signal", signalName: "Fire" } },
      }),
    ];
    const { xml } = await serializeCanvasToBpmn(nodes, []);
    expect(xml).toMatch(/<bpmn:signal[^>]*id="Signal_Fire"/i);
    expect(xml).toMatch(/signalRef="Signal_Fire"/);
    const result = await parseBpmnToCanvas(xml);
    const es = result.nodes.find((n) => n.id === "ES")!;
    expect((es.data as { eventDefinition?: { signalName?: string } }).eventDefinition?.signalName).toBe("Fire");
  });

  it("dangling messageRef on import: name is empty and a warning is surfaced", async () => {
    // Hand-built XML: messageEventDefinition referencing a non-existent id.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://flowpro.io/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="s1" name="Start">
      <bpmn:messageEventDefinition messageRef="Message_Missing"/>
    </bpmn:startEvent>
  </bpmn:process>
</bpmn:definitions>`;
    const result = await parseBpmnToCanvas(xml);
    const s1 = result.nodes.find((n) => n.id === "s1")!;
    expect((s1.data as { eventDefinition?: { messageName?: string } }).eventDefinition?.messageName).toBe("");
    // bpmn-moddle emits "unresolved reference <Message_Missing>" for any
    // IDREF whose target it can't find — we surface that directly now
    // that parseWarnings are properly stringified.
    expect(result.warnings.some((w) => /unresolved reference.*Message_Missing/.test(w))).toBe(true);
  });

  it("flowpro:Data with empty messageName no longer clobbers a resolved name", async () => {
    // Hand-built XML where both the BPMN ref (good) and a flowpro:Data
    // payload (stale/empty) are present — resolved name must win.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowpro="http://flowpro.io/schema/bpmn" id="Definitions_1" targetNamespace="http://flowpro.io/bpmn">
  <bpmn:message id="Message_Good" name="Good"/>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="s1" name="Start">
      <bpmn:extensionElements>
        <flowpro:Data json='${'{"eventDefinition":{"kind":"message","messageName":""}}'}'/>
      </bpmn:extensionElements>
      <bpmn:messageEventDefinition messageRef="Message_Good"/>
    </bpmn:startEvent>
  </bpmn:process>
</bpmn:definitions>`;
    const result = await parseBpmnToCanvas(xml);
    const s1 = result.nodes.find((n) => n.id === "s1")!;
    expect((s1.data as { eventDefinition?: { messageName?: string } }).eventDefinition?.messageName).toBe("Good");
  });
});
