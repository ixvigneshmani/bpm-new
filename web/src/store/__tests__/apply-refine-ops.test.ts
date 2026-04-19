/* ─── P7.3 applyRefineOps — AI diff/merge reducer ──────────────────── */

import { describe, it, expect, beforeEach } from "vitest";
import useCanvasStore, { type RefineOp } from "../canvas-store";

describe("P7.3 applyRefineOps", () => {
  beforeEach(() => {
    useCanvasStore.getState().resetCanvas();
    useCanvasStore.setState({
      nodes: [
        { id: "n1", type: "userTask", position: { x: 0, y: 0 }, data: { label: "One" } } as any,
        { id: "n2", type: "userTask", position: { x: 100, y: 0 }, data: { label: "Two" } } as any,
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" } as any],
    });
  });

  it("add-node appends a node with merged defaults + AI data", () => {
    const ops: RefineOp[] = [
      {
        op: "add-node",
        node: {
          id: "n3",
          type: "userTask",
          label: "Three",
          position: { x: 200, y: 0 },
          data: { role: "reviewer" },
        },
      },
    ];
    useCanvasStore.getState().applyRefineOps(ops);
    const { nodes } = useCanvasStore.getState();
    expect(nodes).toHaveLength(3);
    const n3 = nodes.find((n) => n.id === "n3");
    expect(n3?.data).toMatchObject({ label: "Three", role: "reviewer" });
  });

  it("modify-node merges label/data without clobbering other fields", () => {
    const ops: RefineOp[] = [
      { op: "modify-node", id: "n1", changes: { label: "Updated", data: { extra: true } } },
    ];
    useCanvasStore.getState().applyRefineOps(ops);
    const n1 = useCanvasStore.getState().nodes.find((n) => n.id === "n1");
    expect(n1?.data).toMatchObject({ label: "Updated", extra: true });
  });

  it("remove-node cascades and drops attached edges", () => {
    const ops: RefineOp[] = [{ op: "remove-node", id: "n2" }];
    useCanvasStore.getState().applyRefineOps(ops);
    const state = useCanvasStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual(["n1"]);
    // e1 had n2 as target → must have been cascaded out.
    expect(state.edges).toHaveLength(0);
  });

  it("add-edge wires two nodes with ArrowClosed markerEnd", () => {
    const ops: RefineOp[] = [
      {
        op: "add-edge",
        edge: { id: "e2", source: "n2", target: "n1", label: "back" },
      },
    ];
    useCanvasStore.getState().applyRefineOps(ops);
    const e2 = useCanvasStore.getState().edges.find((e) => e.id === "e2");
    expect(e2).toBeDefined();
    expect(e2?.markerEnd).toBeDefined();
    expect(e2?.label).toBe("back");
  });

  it("remove-edge drops by id without touching others", () => {
    useCanvasStore.setState({
      edges: [
        { id: "e1", source: "n1", target: "n2" } as any,
        { id: "e2", source: "n2", target: "n1" } as any,
      ],
    });
    useCanvasStore.getState().applyRefineOps([{ op: "remove-edge", id: "e1" }]);
    const edges = useCanvasStore.getState().edges;
    expect(edges.map((e) => e.id)).toEqual(["e2"]);
  });

  it("applies a mixed batch atomically and flips documentDirty", () => {
    const ops: RefineOp[] = [
      {
        op: "add-node",
        node: { id: "n3", type: "userTask", label: "New", position: { x: 200, y: 0 } },
      },
      { op: "add-edge", edge: { id: "e2", source: "n2", target: "n3" } },
      { op: "modify-node", id: "n1", changes: { label: "Renamed" } },
    ];
    useCanvasStore.getState().applyRefineOps(ops);
    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(3);
    expect(state.edges).toHaveLength(2);
    expect(state.documentDirty).toBe(true);
    const n1 = state.nodes.find((n) => n.id === "n1");
    expect((n1?.data as { label?: string })?.label).toBe("Renamed");
  });

  it("reports skipped ops when target ids don't exist", () => {
    const before = useCanvasStore.getState();
    const ops: RefineOp[] = [
      { op: "modify-node", id: "ghost", changes: { label: "X" } },
      { op: "remove-edge", id: "also-ghost" },
    ];
    const summary = useCanvasStore.getState().applyRefineOps(ops);
    const after = useCanvasStore.getState();
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    expect(summary).toEqual({ applied: 0, skipped: 2 });
  });

  it("strips reserved keys (bpmnType / parentId) from modify-node.data", () => {
    const ops: RefineOp[] = [
      {
        op: "modify-node",
        id: "n1",
        changes: { data: { bpmnType: "endEvent", parentId: "evil", role: "ok" } as Record<string, unknown> },
      },
    ];
    useCanvasStore.getState().applyRefineOps(ops);
    const n1 = useCanvasStore.getState().nodes.find((n) => n.id === "n1");
    const data = n1?.data as Record<string, unknown>;
    expect(data.bpmnType).toBeUndefined();
    expect(data.parentId).toBeUndefined();
    expect(data.role).toBe("ok");
  });
});
