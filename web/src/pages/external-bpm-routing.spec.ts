import { describe, expect, it } from "vitest";
import {
  type Box,
  handlePoint,
  handleToSide,
  routeEdge,
  sideToSourceHandle,
  sideToTargetHandle,
  simplify,
} from "./external-bpm-routing";

/** Does a strictly-orthogonal polyline (source handle + waypoints +
 *  target handle) pass through the interior of any box? Mirrors the
 *  router's own clearance-free interior test for assertions. */
function crosses(points: Array<{ x: number; y: number }>, boxes: Box[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    for (const o of boxes) {
      if (
        x2 > o.x + 1 &&
        x1 < o.x + o.w - 1 &&
        y2 > o.y + 1 &&
        y1 < o.y + o.h - 1
      ) {
        return true;
      }
    }
  }
  return false;
}

function fullPath(
  source: Box,
  sSide: Parameters<typeof handlePoint>[1],
  target: Box,
  tSide: Parameters<typeof handlePoint>[1],
  waypoints: Array<{ x: number; y: number }>,
) {
  return [handlePoint(source, sSide), ...waypoints, handlePoint(target, tSide)];
}

describe("handle <-> side mapping", () => {
  it("round-trips handle ids", () => {
    expect(sideToSourceHandle("right")).toBe("s-right");
    expect(sideToTargetHandle("top")).toBe("t-top");
    expect(handleToSide("s-left")).toBe("left");
    expect(handleToSide("t-bottom")).toBe("bottom");
    expect(handleToSide(null)).toBeNull();
    expect(handleToSide("garbage")).toBeNull();
  });
});

describe("simplify", () => {
  it("drops collinear and duplicate corners", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 0 }, // dup
      { x: 0, y: 50 },
      { x: 0, y: 100 }, // collinear vertical
      { x: 50, y: 100 },
    ];
    expect(simplify(pts)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 50, y: 100 },
    ]);
  });
});

describe("routeEdge — clean cases pass through untouched", () => {
  it("returns empty waypoints for an unobstructed same-row edge", () => {
    const source: Box = { x: 0, y: 0, w: 100, h: 60 };
    const target: Box = { x: 300, y: 0, w: 100, h: 60 };
    const r = routeEdge({
      source,
      target,
      sourceSide: "right",
      targetSide: "left",
      obstacles: [],
    });
    expect(r.rerouted).toBe(false);
    expect(r.waypoints).toEqual([]);
    expect(r.sourceSide).toBe("right");
    expect(r.targetSide).toBe("left");
  });

  it("leaves a clean stacked edge (bottom→top) on auto-route", () => {
    const source: Box = { x: 0, y: 0, w: 100, h: 60 };
    const target: Box = { x: 0, y: 300, w: 100, h: 60 };
    const r = routeEdge({
      source,
      target,
      sourceSide: "bottom",
      targetSide: "top",
      obstacles: [{ x: 400, y: 400, w: 100, h: 60 }], // off to the side
    });
    expect(r.rerouted).toBe(false);
    expect(r.waypoints).toEqual([]);
  });
});

describe("routeEdge — obstacle avoidance", () => {
  it("reroutes a same-row edge around a box sitting between the two", () => {
    const source: Box = { x: 0, y: 0, w: 100, h: 60 };
    const target: Box = { x: 400, y: 0, w: 100, h: 60 };
    const blocker: Box = { x: 200, y: 0, w: 100, h: 60 }; // directly between
    const r = routeEdge({
      source,
      target,
      sourceSide: "right",
      targetSide: "left",
      obstacles: [blocker],
    });
    expect(r.rerouted).toBe(true);
    expect(r.waypoints.length).toBeGreaterThan(0);
    const path = fullPath(source, r.sourceSide, target, r.targetSide, r.waypoints);
    expect(crosses(path, [blocker])).toBe(false);
  });

  it("reroutes a feedback edge whose target sits directly below a task", () => {
    // Mirrors SamplingDataProcess: target (DOE Team Review) sits under
    // a blocker (Get Config); the edge can't reach the target's TOP.
    const target: Box = { x: 0, y: 300, w: 200, h: 120 };
    const blocker: Box = { x: 0, y: 0, w: 200, h: 120 }; // directly above target
    const source: Box = { x: 600, y: 0, w: 200, h: 120 }; // up and to the right
    const r = routeEdge({
      source,
      target,
      sourceSide: "left",
      targetSide: "top", // authored, but blocked by `blocker`
      obstacles: [blocker],
    });
    expect(r.rerouted).toBe(true);
    // Source side stays put (preserves out-edge fan-out).
    expect(r.sourceSide).toBe("left");
    // Target side must have moved off the blocked top.
    expect(r.targetSide).not.toBe("top");
    const path = fullPath(source, r.sourceSide, target, r.targetSide, r.waypoints);
    expect(crosses(path, [blocker])).toBe(false);
  });

  it("keeps the source side fixed even when rerouting", () => {
    const source: Box = { x: 0, y: 0, w: 100, h: 60 };
    const target: Box = { x: 400, y: 0, w: 100, h: 60 };
    const blocker: Box = { x: 200, y: 0, w: 100, h: 60 };
    const r = routeEdge({
      source,
      target,
      sourceSide: "right",
      targetSide: "left",
      obstacles: [blocker],
    });
    expect(r.sourceSide).toBe("right");
  });

  it("reroutes when the same-orientation V path collapses to a flat line landing on a V handle (arrowhead would otherwise tilt 90°)", () => {
    // Reproduces ImprovementNoticeProcess S40→S72: source's BOTTOM Y
    // happens to equal target's TOP Y, so the autoCorners midpoint is
    // exactly that shared Y and the whole V-V polyline degenerates into a
    // single horizontal segment. The arrowhead then inherits that tangent
    // and enters the t-top handle from the SIDE — tilted 90° off.
    const source: Box = { x: 1700, y: 215, w: 240, h: 130 }; // bottom edge at y=345
    const target: Box = { x: 100, y: 345, w: 240, h: 130 }; // top edge at y=345
    const r = routeEdge({
      source,
      target,
      sourceSide: "bottom",
      targetSide: "top", // authored, but degenerate for this geometry
      obstacles: [],
    });
    // The router must move OFF the broken t-top side …
    expect(r.targetSide).not.toBe("top");
    // The last segment of the actual polyline is axis-aligned to the
    // (new) target side's inward normal — no more horizontal landing on a
    // V handle.
    const path = fullPath(source, r.sourceSide, target, r.targetSide, r.waypoints);
    const a = path[path.length - 2];
    const b = path[path.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (r.targetSide === "left" || r.targetSide === "right") {
      expect(Math.abs(dy)).toBeLessThan(1); // strictly horizontal entry
      expect(Math.abs(dx)).toBeGreaterThan(1);
    } else {
      expect(Math.abs(dx)).toBeLessThan(1); // strictly vertical entry
      expect(Math.abs(dy)).toBeGreaterThan(1);
    }
  });

  it("produces a strictly-orthogonal path (every segment axis-aligned)", () => {
    const source: Box = { x: 0, y: 0, w: 100, h: 60 };
    const target: Box = { x: 400, y: 0, w: 100, h: 60 };
    const blocker: Box = { x: 200, y: -20, w: 100, h: 100 };
    const r = routeEdge({
      source,
      target,
      sourceSide: "right",
      targetSide: "left",
      obstacles: [blocker],
    });
    const path = fullPath(source, r.sourceSide, target, r.targetSide, r.waypoints);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const axisAligned = Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1;
      expect(axisAligned).toBe(true);
    }
  });
});
