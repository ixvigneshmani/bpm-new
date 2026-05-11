/* ─── Orthogonal-bend pure helpers tests (GAP-04 v2) ────────────────── */

import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import {
  buildOrthogonalPath,
  getAutoBend,
  getBendAxis,
  getBendHandlePosition,
  getEdgeBend,
  getOrthogonalLabelPoint,
  snapBend,
} from "../orthogonal-bend";

describe("getBendAxis", () => {
  it("right/left handles → axis x (H-V-H route)", () => {
    expect(getBendAxis(Position.Right, Position.Left)).toBe("x");
    expect(getBendAxis(Position.Left, Position.Right)).toBe("x");
    expect(getBendAxis(Position.Right, Position.Right)).toBe("x");
    expect(getBendAxis(Position.Left, Position.Left)).toBe("x");
  });

  it("top/bottom handles → axis y (V-H-V route)", () => {
    expect(getBendAxis(Position.Top, Position.Bottom)).toBe("y");
    expect(getBendAxis(Position.Bottom, Position.Top)).toBe("y");
    expect(getBendAxis(Position.Top, Position.Top)).toBe("y");
    expect(getBendAxis(Position.Bottom, Position.Bottom)).toBe("y");
  });

  it("mixed orientations → null (no bend control)", () => {
    expect(getBendAxis(Position.Right, Position.Top)).toBeNull();
    expect(getBendAxis(Position.Bottom, Position.Left)).toBeNull();
  });

  it("accepts lowercase string aliases (React Flow's untyped sourcePosition)", () => {
    expect(getBendAxis("right", "left")).toBe("x");
    expect(getBendAxis("top", "bottom")).toBe("y");
    expect(getBendAxis("right", "top")).toBeNull();
  });

  it("undefined / unrecognised → null", () => {
    expect(getBendAxis(undefined, undefined)).toBeNull();
    expect(getBendAxis("right", undefined)).toBeNull();
    expect(getBendAxis("center" as never, "left")).toBeNull();
  });
});

describe("getEdgeBend", () => {
  it("returns undefined for nullish or non-object data", () => {
    expect(getEdgeBend(undefined)).toBeUndefined();
    expect(getEdgeBend(null)).toBeUndefined();
    expect(getEdgeBend(42)).toBeUndefined();
    expect(getEdgeBend("100")).toBeUndefined();
  });

  it("returns undefined when bend field is missing or non-numeric", () => {
    expect(getEdgeBend({})).toBeUndefined();
    expect(getEdgeBend({ bend: "100" })).toBeUndefined();
    expect(getEdgeBend({ bend: null })).toBeUndefined();
    expect(getEdgeBend({ bend: NaN })).toBeUndefined();
    expect(getEdgeBend({ bend: Infinity })).toBeUndefined();
    expect(getEdgeBend({ bend: -Infinity })).toBeUndefined();
  });

  it("returns finite numeric values verbatim", () => {
    expect(getEdgeBend({ bend: 0 })).toBe(0);
    expect(getEdgeBend({ bend: 320 })).toBe(320);
    expect(getEdgeBend({ bend: -16 })).toBe(-16);
    expect(getEdgeBend({ bend: 100.5 })).toBe(100.5);
  });

  it("ignores legacy data.waypoints (v1 model is dead — v2 reads bend only)", () => {
    expect(
      getEdgeBend({ waypoints: [{ x: 1, y: 2 }] }),
    ).toBeUndefined();
  });
});

describe("getAutoBend", () => {
  it("averages source/target X for axis x", () => {
    expect(getAutoBend(100, 50, 300, 200, "x")).toBe(200);
    expect(getAutoBend(0, 0, 100, 100, "x")).toBe(50);
  });

  it("averages source/target Y for axis y", () => {
    expect(getAutoBend(100, 50, 300, 200, "y")).toBe(125);
  });

  it("returns 0 for null axis (mixed orientation fallback)", () => {
    expect(getAutoBend(100, 50, 300, 200, null)).toBe(0);
  });
});

describe("snapBend", () => {
  it("rounds to nearest multiple of 16", () => {
    expect(snapBend(0)).toBe(0);
    expect(snapBend(7)).toBe(0);
    expect(snapBend(8)).toBe(16);
    expect(snapBend(15)).toBe(16);
    expect(snapBend(24)).toBe(32);
    expect(snapBend(100)).toBe(96);
  });

  it("handles negatives", () => {
    expect(snapBend(-9)).toBe(-16);
    expect(snapBend(-100)).toBe(-96);
  });

  it("clamps non-finite to 0 (no NaN propagation)", () => {
    expect(snapBend(NaN)).toBe(0);
    expect(snapBend(Infinity)).toBe(0);
    expect(snapBend(-Infinity)).toBe(0);
  });
});

describe("buildOrthogonalPath", () => {
  it("axis x: H-V-H through bendX, three straight segments", () => {
    // source (100, 50) right-handle, target (300, 150) left-handle,
    // bend at X=200.
    const d = buildOrthogonalPath(100, 50, 300, 150, "x", 200);
    expect(d).toBe("M 100 50 L 200 50 L 200 150 L 300 150");
  });

  it("axis y: V-H-V through bendY, three straight segments", () => {
    // source (100, 50) bottom-handle, target (300, 150) top-handle,
    // bend at Y=100.
    const d = buildOrthogonalPath(100, 50, 300, 150, "y", 100);
    expect(d).toBe("M 100 50 L 100 100 L 300 100 L 300 150");
  });

  it("null axis: straight line fallback (no orthogonal control)", () => {
    expect(buildOrthogonalPath(100, 50, 300, 150, null, 0)).toBe(
      "M 100 50 L 300 150",
    );
  });

  it("when bendX equals source X: collapses to L-route (no overshoot)", () => {
    // bend at sx → first H segment has zero length, but the SVG path
    // is still well-formed.
    const d = buildOrthogonalPath(100, 50, 300, 150, "x", 100);
    expect(d).toBe("M 100 50 L 100 50 L 100 150 L 300 150");
  });

  it("when sy equals ty (same-height nodes): produces a straight H route with two collinear bends", () => {
    const d = buildOrthogonalPath(100, 50, 300, 50, "x", 200);
    expect(d).toBe("M 100 50 L 200 50 L 200 50 L 300 50");
  });
});

describe("getBendHandlePosition", () => {
  it("axis x: handle on the middle V at (bend, midY)", () => {
    expect(getBendHandlePosition(100, 50, 300, 150, "x", 200)).toEqual({
      x: 200,
      y: 100,
    });
  });

  it("axis y: handle on the middle H at (midX, bend)", () => {
    expect(getBendHandlePosition(100, 50, 300, 150, "y", 100)).toEqual({
      x: 200,
      y: 100,
    });
  });

  it("null axis: handle at geometric midpoint", () => {
    expect(getBendHandlePosition(100, 50, 300, 150, null, 0)).toEqual({
      x: 200,
      y: 100,
    });
  });
});

describe("getOrthogonalLabelPoint", () => {
  it("matches the handle position (label anchor is the same; component offsets it visually)", () => {
    const handle = getBendHandlePosition(100, 50, 300, 150, "x", 200);
    const label = getOrthogonalLabelPoint(100, 50, 300, 150, "x", 200);
    expect(label).toEqual(handle);
  });
});

describe("integration: drag round-trip math", () => {
  it("auto bend → user drags to X=240 → bend stored snapped → next render shows path through 240", () => {
    const sx = 100,
      sy = 50,
      tx = 320,
      ty = 200;
    const axis: "x" = "x";

    // Initial: no user bend, auto = (100+320)/2 = 210
    const auto = getAutoBend(sx, sy, tx, ty, axis);
    expect(auto).toBe(210);

    // User drags the middle V handle to X=237 (unsnapped cursor pos)
    const draggedX = 237;
    const snapped = snapBend(draggedX);
    expect(snapped).toBe(240); // nearest multiple of 16

    // Stored as data.bend = 240; next render reads it back
    const stored = getEdgeBend({ bend: snapped });
    expect(stored).toBe(240);

    // Path now goes through X=240
    const d = buildOrthogonalPath(sx, sy, tx, ty, axis, stored ?? auto);
    expect(d).toBe("M 100 50 L 240 50 L 240 200 L 320 200");

    // Handle now sits at (240, 125)
    expect(
      getBendHandlePosition(sx, sy, tx, ty, axis, stored ?? auto),
    ).toEqual({ x: 240, y: 125 });
  });

  it("reset routing: data.bend cleared → reverts to auto", () => {
    const stored = getEdgeBend({}); // bend not set
    expect(stored).toBeUndefined();
    const fallback = stored ?? getAutoBend(0, 0, 200, 100, "x");
    expect(fallback).toBe(100);
  });
});
