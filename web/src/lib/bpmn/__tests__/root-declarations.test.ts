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
});
