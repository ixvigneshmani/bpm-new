/* ─── Designer Sweep A — boundary event snap-to-host ───────────────── */

import { describe, it, expect, beforeEach } from "vitest";
import type { Node } from "@xyflow/react";
import useCanvasStore from "../canvas-store";

describe("boundary event snap-to-host on drag", () => {
  beforeEach(() => {
    useCanvasStore.getState().resetCanvas();
  });

  it("mirrors a host position-change onto its boundary children", () => {
    useCanvasStore.setState({
      nodes: [
        {
          id: "host",
          type: "userTask",
          position: { x: 100, y: 100 },
          data: { label: "Approve", bpmnType: "userTask" },
        } as Node,
        {
          id: "bnd",
          type: "boundaryEvent",
          position: { x: 200, y: 130 },
          data: {
            label: "Timer",
            bpmnType: "boundaryEvent",
            attachedToRef: "host",
            eventDefinition: { kind: "timer" },
          },
        } as Node,
      ],
    });

    // Simulate React Flow's drag emitting a position change for the host.
    useCanvasStore.getState().onNodesChange([
      { type: "position", id: "host", position: { x: 180, y: 150 }, dragging: true },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const after = useCanvasStore.getState().nodes;
    const host = after.find((n) => n.id === "host")!;
    const bnd = after.find((n) => n.id === "bnd")!;
    expect(host.position).toEqual({ x: 180, y: 150 });
    // delta was (+80, +50), boundary moves with it
    expect(bnd.position).toEqual({ x: 280, y: 180 });
  });

  it("does not double-apply when both host and boundary move in the same batch", () => {
    useCanvasStore.setState({
      nodes: [
        { id: "host", type: "userTask", position: { x: 100, y: 100 }, data: { label: "h" } } as Node,
        {
          id: "bnd",
          type: "boundaryEvent",
          position: { x: 200, y: 130 },
          data: { attachedToRef: "host" },
        } as Node,
      ],
    });
    useCanvasStore.getState().onNodesChange([
      { type: "position", id: "host", position: { x: 110, y: 110 }, dragging: false },
      { type: "position", id: "bnd", position: { x: 210, y: 140 }, dragging: false },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const bnd = useCanvasStore.getState().nodes.find((n) => n.id === "bnd")!;
    // The explicit change wins; mirror is skipped.
    expect(bnd.position).toEqual({ x: 210, y: 140 });
  });

  it("ignores non-position changes", () => {
    useCanvasStore.setState({
      nodes: [
        { id: "host", type: "userTask", position: { x: 100, y: 100 }, data: {} } as Node,
        {
          id: "bnd",
          type: "boundaryEvent",
          position: { x: 200, y: 130 },
          data: { attachedToRef: "host" },
        } as Node,
      ],
    });
    useCanvasStore.getState().onNodesChange([
      { type: "select", id: "host", selected: true },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const bnd = useCanvasStore.getState().nodes.find((n) => n.id === "bnd")!;
    expect(bnd.position).toEqual({ x: 200, y: 130 });
  });

  it("leaves orphan boundary (no host) untouched", () => {
    useCanvasStore.setState({
      nodes: [
        { id: "other", type: "userTask", position: { x: 0, y: 0 }, data: {} } as Node,
        {
          id: "bnd",
          type: "boundaryEvent",
          position: { x: 50, y: 50 },
          // attachedToRef references a node that doesn't exist
          data: { attachedToRef: "missing-host" },
        } as Node,
      ],
    });
    useCanvasStore.getState().onNodesChange([
      { type: "position", id: "other", position: { x: 100, y: 100 }, dragging: true },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const bnd = useCanvasStore.getState().nodes.find((n) => n.id === "bnd")!;
    expect(bnd.position).toEqual({ x: 50, y: 50 });
  });
});
