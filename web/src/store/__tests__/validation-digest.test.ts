/* Tests for the validation-hook digest invariants.
 *
 * The digest is the contract: validation only re-runs when the digest
 * changes. So we need to prove
 *   (a) position-only changes DON'T change the digest (drag is free),
 *   (b) the fields the rules read (assignment, impl, rule, condition,
 *       defaultFlowId, flowType) DO change the digest.
 *
 * Without (a) every drag re-runs the full rule set on a 500-node canvas.
 * Without (b) the rules silently render stale issues until an unrelated
 * structural edit. Sweep B introduced (b); this file guards against
 * regression. */

import { describe, it, expect, beforeEach } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import {
  getValidationIssues,
  digestOf,
  __resetValidationCache,
} from "../validation-hook";

beforeEach(() => {
  __resetValidationCache();
});

function mkNodes(): Node[] {
  return [
    { id: "start", type: "startEvent", position: { x: 0, y: 0 }, data: { label: "Start" } } as Node,
    { id: "end", type: "endEvent", position: { x: 200, y: 0 }, data: { label: "End" } } as Node,
  ];
}

describe("connectivityDigest stability", () => {
  it("position-only changes do NOT change the digest (drag is free)", () => {
    const nodes = mkNodes();
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" } as Edge];
    const before = digestOf(nodes, edges);
    const after = digestOf(
      nodes.map((n) => (n.id === "start" ? ({ ...n, position: { x: 999, y: 999 } } as Node) : n)),
      edges,
    );
    expect(after).toBe(before);
  });

  it("edge condition CHANGES the digest", () => {
    const nodes = mkNodes();
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" } as Edge];
    const before = digestOf(nodes, edges);
    const after = digestOf(
      nodes,
      edges.map((e) => ({ ...e, data: { condition: "amount > 5" } } as Edge)),
    );
    expect(after).not.toBe(before);
  });

  it("assignment.value CHANGES the digest", () => {
    const nodes: Node[] = [
      { id: "t1", type: "userTask", position: { x: 0, y: 0 }, data: { label: "Approve", assignment: { type: "role", value: "" } } } as Node,
    ];
    const before = digestOf(nodes, []);
    const after = digestOf(
      nodes.map((n) => ({ ...n, data: { ...(n.data as object), assignment: { type: "role", value: "manager" } } } as Node)),
      [],
    );
    expect(after).not.toBe(before);
  });

  it("gateway defaultFlowId CHANGES the digest", () => {
    const nodes: Node[] = [
      { id: "gw", type: "exclusiveGateway", position: { x: 0, y: 0 }, data: { label: "?" } } as Node,
    ];
    const before = digestOf(nodes, []);
    const after = digestOf(
      nodes.map((n) => ({ ...n, data: { ...(n.data as object), defaultFlowId: "e3" } } as Node)),
      [],
    );
    expect(after).not.toBe(before);
  });

  it("service-task implementation CHANGES the digest", () => {
    const nodes: Node[] = [
      { id: "s", type: "serviceTask", position: { x: 0, y: 0 }, data: { label: "Notify" } } as Node,
    ];
    const before = digestOf(nodes, []);
    const after = digestOf(
      nodes.map((n) => ({
        ...n,
        data: { ...(n.data as object), implementation: { type: "externalWorker", config: { jobType: "notify" } } },
      } as Node)),
      [],
    );
    expect(after).not.toBe(before);
  });
});

describe("getValidationIssues cache behaviour", () => {
  it("returns the same array reference on consecutive calls with same canvas", () => {
    const nodes = mkNodes();
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" } as Edge];
    const a = getValidationIssues(nodes, edges);
    const b = getValidationIssues(nodes, edges);
    expect(a).toBe(b); // identity = cache hit
  });

  it("returns a fresh array reference when a rule-relevant field changes", () => {
    const nodes: Node[] = [
      { id: "t1", type: "userTask", position: { x: 0, y: 0 }, data: { label: "Approve", assignment: { type: "role", value: "" } } } as Node,
    ];
    const a = getValidationIssues(nodes, []);
    const after = nodes.map((n) => ({ ...n, data: { ...(n.data as object), assignment: { type: "role", value: "manager" } } } as Node));
    const b = getValidationIssues(after, []);
    expect(b).not.toBe(a);
  });

  it("re-runs rules — issue list shrinks when fix is applied", () => {
    const before: Node[] = [
      { id: "t1", type: "userTask", position: { x: 0, y: 0 }, data: { label: "Approve" } } as Node,
    ];
    const aIssues = getValidationIssues(before, []);
    expect(aIssues.some((i) => i.ruleId === "user-task-assignment")).toBe(true);
    const after = before.map((n) => ({ ...n, data: { ...(n.data as object), assignment: { type: "role", value: "manager" } } } as Node));
    const bIssues = getValidationIssues(after, []);
    expect(bIssues.some((i) => i.ruleId === "user-task-assignment")).toBe(false);
  });
});
