/* Regression test for the OutcomesSection stale-closure bug.
 *
 * Bug: when the empty-state "Approve / Reject" suggestion fired
 * `add("Approve"); add("Reject")` synchronously, both `add` calls
 * read the same captured `outcomes` array from the prop. The second
 * call's `[...outcomes, reject]` therefore overwrote the first, and
 * only "Reject" survived. Fix: `addMany([…])` produces ONE onChange
 * call carrying both new entries.
 *
 * This test exercises the closure semantics without React (RTL is
 * not in the dep tree). The shape of the bug is purely about how
 * many onChange calls happen and what each carries. */

import { describe, it, expect } from "vitest";

type Outcome = { uid: string; id: string; label: string };

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "");
const newUid = () => `o-${Math.random().toString(36).slice(2, 10)}`;

describe("OutcomesSection batch-add semantics", () => {
  it("OLD behaviour (two sequential `add` calls) drops the first", () => {
    // Reproduces the bug. `add` reads a captured `outcomes` and emits
    // one onChange per call. The second call's captured array is the
    // SAME (pre-edit) reference, so the first insert is lost.
    let current: Outcome[] = [];
    const onChange = (next: Outcome[]) => {
      current = next;
    };
    const outcomes = current;
    const add = (label: string) =>
      onChange([...outcomes, { uid: newUid(), id: slug(label), label }]);
    add("Approve");
    add("Reject");
    expect(current.map((o) => o.label)).toEqual(["Reject"]);
  });

  it("NEW behaviour (`addMany`) produces both in one update", () => {
    let current: Outcome[] = [];
    const onChange = (next: Outcome[]) => {
      current = next;
    };
    const outcomes = current;
    const addMany = (labels: string[]) =>
      onChange([
        ...outcomes,
        ...labels.map((label) => ({ uid: newUid(), id: slug(label), label })),
      ]);
    addMany(["Approve", "Reject"]);
    expect(current.map((o) => o.label)).toEqual(["Approve", "Reject"]);
  });
});
