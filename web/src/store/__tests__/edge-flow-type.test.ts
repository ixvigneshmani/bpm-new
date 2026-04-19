/* ─── P6.6 edge flowType toggle ─────────────────────────────────────── */

import { describe, it, expect, beforeEach } from "vitest";
import useCanvasStore from "../canvas-store";

describe("P6.6 setEdgeFlowType", () => {
  beforeEach(() => {
    useCanvasStore.getState().resetCanvas();
    useCanvasStore.setState({
      edges: [
        { id: "e1", source: "a", target: "b" } as any,
      ],
    });
  });

  it("switching a sequence flow to message adds data.flowType", () => {
    useCanvasStore.getState().setEdgeFlowType("e1", "message");
    const e = useCanvasStore.getState().edges[0];
    expect((e.data as { flowType?: string })?.flowType).toBe("message");
  });

  it("switching a message flow back to sequence removes flowType", () => {
    useCanvasStore.setState({
      edges: [
        { id: "e1", source: "a", target: "b", data: { flowType: "message" } } as any,
      ],
    });
    useCanvasStore.getState().setEdgeFlowType("e1", "sequence");
    const e = useCanvasStore.getState().edges[0];
    expect((e.data as { flowType?: string })?.flowType).toBeUndefined();
  });

  it("preserves other edge data fields through the toggle", () => {
    useCanvasStore.setState({
      edges: [
        { id: "e1", source: "a", target: "b", data: { condition: "x > 0", label: "hi" } } as any,
      ],
    });
    useCanvasStore.getState().setEdgeFlowType("e1", "message");
    const e = useCanvasStore.getState().edges[0];
    const data = e.data as { condition?: string; label?: string; flowType?: string };
    expect(data.condition).toBe("x > 0");
    expect(data.label).toBe("hi");
    expect(data.flowType).toBe("message");
  });
});
