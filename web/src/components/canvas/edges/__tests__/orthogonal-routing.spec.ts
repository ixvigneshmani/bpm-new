/* ─── Orthogonal multi-segment routing tests (GAP-04 v3) ─────────────
 * Cover the drag math + invariants since the visual layer can't be
 * unit-tested. Drag-math correctness is the whole feature. */

import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import {
  buildOrthogonalPath,
  canRouteOrthogonally,
  computeAutoWaypoints,
  dragSegment,
  effectivePoints,
  getEdgeWaypoints,
  getSegments,
  snapPoint,
  snapValue,
  sourceUnitVector,
  targetUnitVector,
  type Waypoint,
} from "../orthogonal-routing";

// ── Parsing / snapping ─────────────────────────────────────────────

describe("getEdgeWaypoints", () => {
  it("returns [] for nullish or non-object data", () => {
    expect(getEdgeWaypoints(undefined)).toEqual([]);
    expect(getEdgeWaypoints(null)).toEqual([]);
    expect(getEdgeWaypoints(42)).toEqual([]);
    expect(getEdgeWaypoints("waypoints")).toEqual([]);
  });

  it("returns [] for missing or wrong-shape waypoints field", () => {
    expect(getEdgeWaypoints({})).toEqual([]);
    expect(getEdgeWaypoints({ waypoints: null })).toEqual([]);
    expect(getEdgeWaypoints({ waypoints: "x" })).toEqual([]);
  });

  it("filters out non-numeric coords", () => {
    expect(
      getEdgeWaypoints({
        waypoints: [
          { x: 10, y: 20 },
          { x: "30", y: 40 },
          { x: NaN, y: 50 },
          { x: Infinity, y: 60 },
          { x: 70, y: 80 },
        ],
      }),
    ).toEqual([
      { x: 10, y: 20 },
      { x: 70, y: 80 },
    ]);
  });
});

describe("snapValue / snapPoint", () => {
  it("rounds to nearest multiple of 16 by default", () => {
    expect(snapValue(0)).toBe(0);
    expect(snapValue(7)).toBe(0);
    expect(snapValue(8)).toBe(16);
    expect(snapValue(100)).toBe(96);
    expect(snapValue(-9)).toBe(-16);
  });

  it("non-finite clamps to 0", () => {
    expect(snapValue(NaN)).toBe(0);
    expect(snapValue(Infinity)).toBe(0);
  });

  it("custom step respected", () => {
    expect(snapValue(13, 10)).toBe(10);
    expect(snapValue(15, 10)).toBe(20);
  });

  it("snapPoint snaps both axes", () => {
    expect(snapPoint({ x: 7, y: 9 })).toEqual({ x: 0, y: 16 });
  });
});

// ── Routing geometry ───────────────────────────────────────────────

describe("canRouteOrthogonally", () => {
  it("true for matching orientations", () => {
    expect(canRouteOrthogonally(Position.Right, Position.Left)).toBe(true);
    expect(canRouteOrthogonally(Position.Top, Position.Bottom)).toBe(true);
    expect(canRouteOrthogonally("right", "right")).toBe(true);
    expect(canRouteOrthogonally("top", "top")).toBe(true);
  });

  it("false for mixed orientations", () => {
    expect(canRouteOrthogonally(Position.Right, Position.Top)).toBe(false);
    expect(canRouteOrthogonally("bottom", "left")).toBe(false);
  });

  it("false for unknown / undefined", () => {
    expect(canRouteOrthogonally(undefined, undefined)).toBe(false);
  });
});

describe("sourceUnitVector / targetUnitVector", () => {
  it("source vectors point OUT of source", () => {
    expect(sourceUnitVector(Position.Right)).toEqual({ dx: 1, dy: 0 });
    expect(sourceUnitVector(Position.Left)).toEqual({ dx: -1, dy: 0 });
    expect(sourceUnitVector(Position.Bottom)).toEqual({ dx: 0, dy: 1 });
    expect(sourceUnitVector(Position.Top)).toEqual({ dx: 0, dy: -1 });
  });

  it("target vectors point INTO target (approach direction)", () => {
    expect(targetUnitVector(Position.Left)).toEqual({ dx: 1, dy: 0 });
    expect(targetUnitVector(Position.Right)).toEqual({ dx: -1, dy: 0 });
    expect(targetUnitVector(Position.Top)).toEqual({ dx: 0, dy: 1 });
    expect(targetUnitVector(Position.Bottom)).toEqual({ dx: 0, dy: -1 });
  });

  it("unknown defaults to {1,0}", () => {
    expect(sourceUnitVector(undefined)).toEqual({ dx: 1, dy: 0 });
    expect(targetUnitVector(undefined)).toEqual({ dx: 1, dy: 0 });
  });
});

describe("computeAutoWaypoints", () => {
  it("H-V-H route for horizontal handles with different Y", () => {
    expect(
      computeAutoWaypoints({ x: 100, y: 100 }, { x: 400, y: 200 }, "right", "left"),
    ).toEqual([
      { x: 250, y: 100 },
      { x: 250, y: 200 },
    ]);
  });

  it("V-H-V route for vertical handles with different X", () => {
    expect(
      computeAutoWaypoints({ x: 100, y: 100 }, { x: 400, y: 200 }, "bottom", "top"),
    ).toEqual([
      { x: 100, y: 150 },
      { x: 400, y: 150 },
    ]);
  });

  it("empty for horizontal handles when sy == ty (single straight H)", () => {
    expect(
      computeAutoWaypoints({ x: 100, y: 100 }, { x: 400, y: 100 }, "right", "left"),
    ).toEqual([]);
  });

  it("empty for vertical handles when sx == tx", () => {
    expect(
      computeAutoWaypoints({ x: 100, y: 100 }, { x: 100, y: 400 }, "bottom", "top"),
    ).toEqual([]);
  });

  it("empty for mixed orientations (smoothstep fallback)", () => {
    expect(
      computeAutoWaypoints({ x: 100, y: 100 }, { x: 400, y: 200 }, "right", "top"),
    ).toEqual([]);
  });
});

describe("effectivePoints", () => {
  it("inserts auto-corners when waypoints is empty", () => {
    expect(
      effectivePoints(
        { x: 100, y: 100 },
        [],
        { x: 400, y: 200 },
        "right",
        "left",
      ),
    ).toEqual([
      { x: 100, y: 100 },
      { x: 250, y: 100 },
      { x: 250, y: 200 },
      { x: 400, y: 200 },
    ]);
  });

  it("uses user waypoints verbatim when present", () => {
    const ws: Waypoint[] = [
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ];
    expect(
      effectivePoints({ x: 100, y: 100 }, ws, { x: 400, y: 200 }, "right", "left"),
    ).toEqual([{ x: 100, y: 100 }, ...ws, { x: 400, y: 200 }]);
  });
});

describe("getSegments", () => {
  const S: Waypoint = { x: 100, y: 100 };
  const T: Waypoint = { x: 400, y: 200 };

  it("3 segments for the standard H-V-H auto-route", () => {
    const pts = effectivePoints(S, [], T, "right", "left");
    const segs = getSegments(pts);
    expect(segs).toHaveLength(3);
    expect(segs.map((s) => s.direction)).toEqual(["H", "V", "H"]);
    expect(segs[0].isSourceAnchored).toBe(true);
    expect(segs[0].isTargetAnchored).toBe(false);
    expect(segs[1].isSourceAnchored).toBe(false);
    expect(segs[1].isTargetAnchored).toBe(false);
    expect(segs[2].isSourceAnchored).toBe(false);
    expect(segs[2].isTargetAnchored).toBe(true);
  });

  it("midpoint is the geometric centre of each segment", () => {
    const pts = effectivePoints(S, [], T, "right", "left");
    const segs = getSegments(pts);
    // seg0: (100,100) → (250,100) midpoint (175,100)
    expect(segs[0].midpoint).toEqual({ x: 175, y: 100 });
    // seg1: (250,100) → (250,200) midpoint (250,150)
    expect(segs[1].midpoint).toEqual({ x: 250, y: 150 });
    // seg2: (250,200) → (400,200) midpoint (325,200)
    expect(segs[2].midpoint).toEqual({ x: 325, y: 200 });
  });
});

describe("buildOrthogonalPath", () => {
  it("produces M..L..L.. through every point", () => {
    expect(
      buildOrthogonalPath([
        { x: 100, y: 100 },
        { x: 250, y: 100 },
        { x: 250, y: 200 },
        { x: 400, y: 200 },
      ]),
    ).toBe("M 100 100 L 250 100 L 250 200 L 400 200");
  });

  it("empty list → empty string", () => {
    expect(buildOrthogonalPath([])).toBe("");
  });
});

// ── Drag math — the meat of the feature ────────────────────────────

describe("dragSegment — interior segment (middle V of H-V-H)", () => {
  const S: Waypoint = { x: 100, y: 100 };
  const T: Waypoint = { x: 400, y: 200 };

  it("dragging middle V perpendicular materialises auto-corners + shifts both", () => {
    // Default route: auto-corners at (250, 100) and (250, 200).
    // Middle segment (index 1) is V from (250,100) to (250,200).
    // Drag perpendicular (X) to 320.
    const next = dragSegment({
      waypoints: [],
      segmentIndex: 1,
      perpendicularValue: 320,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    expect(next).toEqual([
      { x: 320, y: 100 },
      { x: 320, y: 200 },
    ]);
  });

  it("subsequent drag of the (now-explicit) middle V updates both waypoints", () => {
    const waypoints: Waypoint[] = [
      { x: 320, y: 100 },
      { x: 320, y: 200 },
    ];
    const next = dragSegment({
      waypoints,
      segmentIndex: 1,
      perpendicularValue: 280,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    expect(next).toEqual([
      { x: 280, y: 100 },
      { x: 280, y: 200 },
    ]);
  });
});

describe("dragSegment — source-anchored segment (first H)", () => {
  const S: Waypoint = { x: 100, y: 100 };
  const T: Waypoint = { x: 400, y: 200 };

  it("dragging first H perpendicular inserts two new corners near source", () => {
    // Auto-route segment 0: H from (100,100) to (250,100).
    // Drag perpendicular (Y) to 150.
    const next = dragSegment({
      waypoints: [],
      segmentIndex: 0,
      perpendicularValue: 150,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    // Expect:
    //  - new corner at (130, 100) — 30px along source direction (right)
    //  - new corner at (130, 150) — perpendicular jump to new Y
    //  - updated original first waypoint at (250, 150) — Y matches the dragged segment
    //  - second auto-corner is preserved (250, 200) → was the SECOND auto-corner
    //  - target unchanged
    expect(next).toEqual([
      { x: 130, y: 100 },
      { x: 130, y: 150 },
      { x: 250, y: 150 },
      { x: 250, y: 200 },
    ]);
  });

  it("with existing waypoints: insertion adds two BEFORE existing waypoints", () => {
    const waypoints: Waypoint[] = [
      { x: 300, y: 100 },
      { x: 300, y: 200 },
    ];
    // segment 0 (H from source(100,100) to (300,100)). Drag to Y=70.
    const next = dragSegment({
      waypoints,
      segmentIndex: 0,
      perpendicularValue: 70,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    expect(next).toEqual([
      { x: 130, y: 100 },
      { x: 130, y: 70 },
      { x: 300, y: 70 },
      { x: 300, y: 200 },
    ]);
  });

  it("source-anchored drag uses the source direction (top handle goes up)", () => {
    // Top source. Auto-route is V-H-V.
    // segments: V from (200, 100) to (200, 150), H from (200,150) to (400,150), V from (400,150) to (400,200)
    // Drag segment 0 (V from source) perpendicular (X) to 240.
    const S2: Waypoint = { x: 200, y: 100 };
    const T2: Waypoint = { x: 400, y: 200 };
    const next = dragSegment({
      waypoints: [],
      segmentIndex: 0,
      perpendicularValue: 240,
      source: S2,
      target: T2,
      sourcePos: "bottom",
      targetPos: "top",
    });
    // For bottom source: dir = (0, 1). Offset corner at (200, 130). Then jump to (240, 130).
    // Update first auto-corner (was (200, 150)) → (240, 150).
    // Second auto-corner stays (400, 150). Target (400, 200).
    expect(next).toEqual([
      { x: 200, y: 130 }, // offset along source direction
      { x: 240, y: 130 }, // perpendicular jump to new X
      { x: 240, y: 150 }, // first original auto-corner with updated X
      { x: 400, y: 150 }, // second auto-corner preserved
    ]);
  });
});

describe("dragSegment — target-anchored segment (last H)", () => {
  const S: Waypoint = { x: 100, y: 100 };
  const T: Waypoint = { x: 400, y: 200 };

  it("dragging last H perpendicular inserts two new corners near target", () => {
    // Default H-V-H. Segment 2 = H from (250, 200) to (400, 200). Drag to Y=240.
    const next = dragSegment({
      waypoints: [],
      segmentIndex: 2,
      perpendicularValue: 240,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    // First auto-corner (250, 100) preserved.
    // Original last waypoint (250, 200) → updated Y=240.
    // Insert (370, 240) and (370, 200) before target.
    // Effective path becomes:
    //   S(100,100) → (250,100) → (250,240) → (370,240) → (370,200) → T(400,200)
    expect(next).toEqual([
      { x: 250, y: 100 },
      { x: 250, y: 240 },
      { x: 370, y: 240 },
      { x: 370, y: 200 },
    ]);
  });

  it("vertical target: target-anchored drag uses Y-axis insertion", () => {
    const S2: Waypoint = { x: 200, y: 100 };
    const T2: Waypoint = { x: 400, y: 200 };
    // Auto V-H-V. Segments: V (200,100→200,150), H (200,150→400,150), V (400,150→400,200).
    // Drag last segment (V from (400,150) to (400,200)) perpendicular (X) to 460.
    const next = dragSegment({
      waypoints: [],
      segmentIndex: 2,
      perpendicularValue: 460,
      source: S2,
      target: T2,
      sourcePos: "bottom",
      targetPos: "top",
    });
    // First auto-corner (200, 150) preserved.
    // Original last (400, 150) → updated X to 460.
    // Target direction = into top, dx=0 dy=1. Offset_b = target - 30*(0,1) = (400, 170).
    // offset_a = (460, 170) — perpendicular jump.
    expect(next).toEqual([
      { x: 200, y: 150 }, // first auto-corner preserved
      { x: 460, y: 150 }, // original last with updated X
      { x: 460, y: 170 }, // perpendicular jump
      { x: 400, y: 170 }, // approach-corner near target
    ]);
  });
});

describe("dragSegment — robustness", () => {
  const S: Waypoint = { x: 100, y: 100 };
  const T: Waypoint = { x: 400, y: 200 };

  it("returns waypoints unchanged on out-of-range segment index", () => {
    const ws: Waypoint[] = [
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ];
    expect(
      dragSegment({
        waypoints: ws,
        segmentIndex: -1,
        perpendicularValue: 99,
        source: S,
        target: T,
        sourcePos: "right",
        targetPos: "left",
      }),
    ).toEqual(ws);
    expect(
      dragSegment({
        waypoints: ws,
        segmentIndex: 99,
        perpendicularValue: 99,
        source: S,
        target: T,
        sourcePos: "right",
        targetPos: "left",
      }),
    ).toEqual(ws);
  });

  it("returns waypoints unchanged when both source AND target anchored (single-segment edge)", () => {
    // Same-Y edge: source(100,100), target(400,100). No auto-corners
    // (sy == ty). Single segment touches both source and target.
    const next = dragSegment({
      waypoints: [],
      segmentIndex: 0,
      perpendicularValue: 200,
      source: { x: 100, y: 100 },
      target: { x: 400, y: 100 },
      sourcePos: "right",
      targetPos: "left",
    });
    // v3.0 refuses this drag — too complex to materialise four
    // corners cleanly; user can right-click → Reset routing then try
    // again. Return waypoints (empty in this case).
    expect(next).toEqual([]);
  });
});

// ── End-to-end integration: orthogonality preserved through drags ──

describe("integration — orthogonal invariant survives multi-drag scenarios", () => {
  const S: Waypoint = { x: 100, y: 100 };
  const T: Waypoint = { x: 400, y: 200 };

  function isOrthogonal(points: Waypoint[]): boolean {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a.x !== b.x && a.y !== b.y) return false;
    }
    return true;
  }

  it("drag middle V → drag again → drag first H → drag last H — all stays orthogonal", () => {
    let ws: Waypoint[] = [];

    // Move 1: drag middle V to X=300.
    ws = dragSegment({
      waypoints: ws,
      segmentIndex: 1,
      perpendicularValue: 300,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    expect(isOrthogonal([S, ...ws, T])).toBe(true);
    expect(ws).toEqual([
      { x: 300, y: 100 },
      { x: 300, y: 200 },
    ]);

    // Move 2: drag middle V again, now to X=200.
    ws = dragSegment({
      waypoints: ws,
      segmentIndex: 1,
      perpendicularValue: 200,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    expect(isOrthogonal([S, ...ws, T])).toBe(true);

    // Move 3: drag the first H (segment 0) to Y=60.
    ws = dragSegment({
      waypoints: ws,
      segmentIndex: 0,
      perpendicularValue: 60,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    expect(isOrthogonal([S, ...ws, T])).toBe(true);

    // Move 4: drag the LAST segment (now index 4, since we inserted
    // two new corners at the start) to Y=260.
    const segCount = getSegments([S, ...ws, T]).length;
    ws = dragSegment({
      waypoints: ws,
      segmentIndex: segCount - 1,
      perpendicularValue: 260,
      source: S,
      target: T,
      sourcePos: "right",
      targetPos: "left",
    });
    expect(isOrthogonal([S, ...ws, T])).toBe(true);
  });
});
