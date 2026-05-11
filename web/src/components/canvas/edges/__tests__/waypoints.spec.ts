/* ─── Edge waypoints — pure helpers tests (GAP-04) ────────────────── */

import { describe, expect, it } from "vitest";
import {
  buildPolylinePath,
  getEdgeWaypoints,
  insertWaypoint,
  mergeNearbyWaypoints,
  midpoint,
  polylineLabelPoint,
  removeWaypoint,
  segmentMidpoints,
  snapToGrid,
  snapWaypoint,
  updateWaypointAt,
  waypointsEqual,
  type Waypoint,
} from "../waypoints";

describe("getEdgeWaypoints", () => {
  it("returns [] for nullish or non-object data", () => {
    expect(getEdgeWaypoints(undefined)).toEqual([]);
    expect(getEdgeWaypoints(null)).toEqual([]);
    expect(getEdgeWaypoints(42)).toEqual([]);
    expect(getEdgeWaypoints("waypoints")).toEqual([]);
  });

  it("returns [] when waypoints field is missing or wrong shape", () => {
    expect(getEdgeWaypoints({})).toEqual([]);
    expect(getEdgeWaypoints({ waypoints: null })).toEqual([]);
    expect(getEdgeWaypoints({ waypoints: "nope" })).toEqual([]);
    expect(getEdgeWaypoints({ waypoints: { x: 0, y: 0 } })).toEqual([]);
  });

  it("filters out non-numeric coordinates", () => {
    expect(
      getEdgeWaypoints({
        waypoints: [
          { x: 10, y: 20 },
          { x: "30", y: 40 },
          { x: NaN, y: 50 },
          { x: 60 },
          { x: 70, y: Infinity },
          { x: 80, y: 90 },
        ],
      }),
    ).toEqual([
      { x: 10, y: 20 },
      { x: 80, y: 90 },
    ]);
  });

  it("preserves order and the exact numeric values", () => {
    const ws = [
      { x: -5, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 200 },
    ];
    expect(getEdgeWaypoints({ waypoints: ws })).toEqual(ws);
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest multiple of step (default 16)", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(7)).toBe(0); // nearest to 0
    expect(snapToGrid(8)).toBe(16); // round-half-up
    expect(snapToGrid(15)).toBe(16);
    expect(snapToGrid(16)).toBe(16);
    expect(snapToGrid(24)).toBe(32);
  });

  it("handles negatives", () => {
    expect(snapToGrid(-8)).toBe(-0); // Math.round(-0.5) === 0
    expect(snapToGrid(-9)).toBe(-16);
    expect(snapToGrid(-100)).toBe(-96);
  });

  it("supports custom step", () => {
    expect(snapToGrid(13, 10)).toBe(10);
    expect(snapToGrid(15, 10)).toBe(20);
    expect(snapToGrid(13, 1)).toBe(13);
  });

  it("clamps non-finite input to 0 instead of producing NaN", () => {
    expect(snapToGrid(NaN)).toBe(0);
    expect(snapToGrid(Infinity)).toBe(0);
    expect(snapToGrid(-Infinity)).toBe(0);
  });

  it("snapWaypoint snaps both axes", () => {
    expect(snapWaypoint({ x: 7, y: 9 })).toEqual({ x: 0, y: 16 });
    expect(snapWaypoint({ x: 100, y: 200 }, 25)).toEqual({ x: 100, y: 200 });
  });
});

describe("midpoint + waypointsEqual", () => {
  it("midpoint averages coordinates", () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
    expect(midpoint({ x: -4, y: 8 }, { x: 4, y: -8 })).toEqual({ x: 0, y: 0 });
  });

  it("waypointsEqual honours epsilon", () => {
    expect(waypointsEqual({ x: 10, y: 10 }, { x: 10.3, y: 9.8 })).toBe(true);
    expect(waypointsEqual({ x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false);
    expect(waypointsEqual({ x: 10, y: 10 }, { x: 10, y: 10.6 })).toBe(false);
  });
});

describe("mergeNearbyWaypoints", () => {
  it("preserves arrays with 0 or 1 entries", () => {
    expect(mergeNearbyWaypoints([])).toEqual([]);
    const single = [{ x: 1, y: 2 }];
    expect(mergeNearbyWaypoints(single)).toEqual(single);
    // Returns a fresh array (not the same reference) so callers can mutate safely.
    expect(mergeNearbyWaypoints(single)).not.toBe(single);
  });

  it("drops a duplicate that sits within threshold of its predecessor", () => {
    const ws = [
      { x: 0, y: 0 },
      { x: 3, y: 4 }, // distance 5 from prev — under default 8
      { x: 100, y: 100 },
    ];
    expect(mergeNearbyWaypoints(ws, 8)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("keeps both when distance exceeds threshold", () => {
    const ws = [
      { x: 0, y: 0 },
      { x: 30, y: 40 }, // dist 50
    ];
    expect(mergeNearbyWaypoints(ws, 8)).toEqual(ws);
  });

  it("custom threshold respected", () => {
    const ws = [
      { x: 0, y: 0 },
      { x: 30, y: 40 }, // dist 50
    ];
    expect(mergeNearbyWaypoints(ws, 100)).toEqual([{ x: 0, y: 0 }]);
  });

  it("chained close points collapse to one", () => {
    const ws = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 6, y: 0 },
    ];
    expect(mergeNearbyWaypoints(ws, 8)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("insertWaypoint / removeWaypoint / updateWaypointAt", () => {
  const seed: Waypoint[] = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 20 },
  ];

  it("insertWaypoint at start, middle, and end", () => {
    expect(insertWaypoint(seed, 0, { x: -5, y: -5 })).toEqual([
      { x: -5, y: -5 },
      ...seed,
    ]);
    expect(insertWaypoint(seed, 1, { x: 5, y: 5 })).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    expect(insertWaypoint(seed, seed.length, { x: 30, y: 30 })).toEqual([
      ...seed,
      { x: 30, y: 30 },
    ]);
  });

  it("insertWaypoint clamps out-of-range indices", () => {
    expect(insertWaypoint(seed, -5, { x: 99, y: 99 })[0]).toEqual({ x: 99, y: 99 });
    expect(insertWaypoint(seed, 999, { x: 99, y: 99 })[3]).toEqual({ x: 99, y: 99 });
  });

  it("insertWaypoint returns a NEW array (immutable)", () => {
    const out = insertWaypoint(seed, 1, { x: 5, y: 5 });
    expect(out).not.toBe(seed);
    expect(seed).toHaveLength(3);
  });

  it("removeWaypoint by index", () => {
    expect(removeWaypoint(seed, 0)).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    expect(removeWaypoint(seed, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
    expect(removeWaypoint(seed, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("removeWaypoint with out-of-range index returns a copy unchanged", () => {
    expect(removeWaypoint(seed, -1)).toEqual(seed);
    expect(removeWaypoint(seed, 99)).toEqual(seed);
    expect(removeWaypoint(seed, -1)).not.toBe(seed);
  });

  it("updateWaypointAt swaps a single position", () => {
    expect(updateWaypointAt(seed, 1, { x: 99, y: 99 })).toEqual([
      { x: 0, y: 0 },
      { x: 99, y: 99 },
      { x: 20, y: 20 },
    ]);
  });

  it("updateWaypointAt no-ops on bad index", () => {
    expect(updateWaypointAt(seed, -1, { x: 99, y: 99 })).toEqual(seed);
    expect(updateWaypointAt(seed, 99, { x: 99, y: 99 })).toEqual(seed);
  });
});

describe("buildPolylinePath", () => {
  it("no waypoints: just source → target", () => {
    expect(
      buildPolylinePath({ x: 0, y: 0 }, [], { x: 100, y: 100 }),
    ).toBe("M 0 0 L 100 100");
  });

  it("single waypoint inserts one bend", () => {
    expect(
      buildPolylinePath(
        { x: 0, y: 0 },
        [{ x: 50, y: 0 }],
        { x: 50, y: 100 },
      ),
    ).toBe("M 0 0 L 50 0 L 50 100");
  });

  it("multiple waypoints render in order", () => {
    expect(
      buildPolylinePath(
        { x: 0, y: 0 },
        [
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 50 },
        ],
        { x: 100, y: 100 },
      ),
    ).toBe("M 0 0 L 50 0 L 50 50 L 100 50 L 100 100");
  });
});

describe("polylineLabelPoint", () => {
  it("returns the midpoint of the only segment when no waypoints", () => {
    expect(
      polylineLabelPoint({ x: 0, y: 0 }, [], { x: 100, y: 0 }),
    ).toEqual({ x: 50, y: 0 });
  });

  it("picks the longest segment so the label avoids corners", () => {
    // Two segments: short (10 wide) + long (90 wide). Midpoint of the
    // long one should win.
    const p = polylineLabelPoint(
      { x: 0, y: 0 },
      [{ x: 10, y: 0 }],
      { x: 100, y: 0 },
    );
    expect(p).toEqual({ x: 55, y: 0 });
  });
});

describe("segmentMidpoints", () => {
  it("one segment when no waypoints — single midpoint between source and target", () => {
    expect(
      segmentMidpoints({ x: 0, y: 0 }, [], { x: 100, y: 100 }),
    ).toEqual([{ x: 50, y: 50 }]);
  });

  it("N waypoints → N+1 segment midpoints, in order", () => {
    expect(
      segmentMidpoints(
        { x: 0, y: 0 },
        [{ x: 100, y: 0 }],
        { x: 100, y: 100 },
      ),
    ).toEqual([
      { x: 50, y: 0 }, // between source and waypoint 0
      { x: 100, y: 50 }, // between waypoint 0 and target
    ]);
  });

  it("works for 2+ waypoints", () => {
    const mids = segmentMidpoints(
      { x: 0, y: 0 },
      [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      { x: 20, y: 10 },
    );
    expect(mids).toHaveLength(3);
    expect(mids[0]).toEqual({ x: 5, y: 0 });
    expect(mids[1]).toEqual({ x: 10, y: 5 });
    expect(mids[2]).toEqual({ x: 15, y: 10 });
  });
});
