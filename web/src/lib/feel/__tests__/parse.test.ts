import { describe, it, expect } from "vitest";
import { parseFeelCondition, parseVariableRef, evaluate } from "../parse";

describe("parseFeelCondition", () => {
  it("accepts arithmetic + comparison", () => {
    const r = parseFeelCondition("amount > 1000");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identifiers).toEqual(["amount"]);
  });

  it("accepts compound conditions", () => {
    const r = parseFeelCondition("amount > 1000 && approved == true");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identifiers.sort()).toEqual(["amount", "approved"]);
  });

  it("accepts member access", () => {
    const r = parseFeelCondition("order.total >= 500 && customer.tier == 'gold'");
    expect(r.ok).toBe(true);
  });

  it("accepts ternary", () => {
    const r = parseFeelCondition("amount > 1000 ? 'manual' : 'auto'");
    expect(r.ok).toBe(true);
  });

  it("rejects unclosed strings", () => {
    const r = parseFeelCondition("name == 'alice");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/Unclosed string/);
  });

  it("rejects unclosed parens", () => {
    const r = parseFeelCondition("(amount > 5");
    expect(r.ok).toBe(false);
  });

  it("rejects forbidden identifiers", () => {
    const r = parseFeelCondition("eval(amount)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/Forbidden/);
  });

  it("rejects disallowed characters", () => {
    const r = parseFeelCondition("amount; drop");
    expect(r.ok).toBe(false);
  });

  it("rejects trailing operator", () => {
    const r = parseFeelCondition("amount > ");
    expect(r.ok).toBe(false);
  });

  it("rejects empty expression", () => {
    const r = parseFeelCondition("   ");
    expect(r.ok).toBe(false);
  });

  it("evaluates against a scope", () => {
    const r = parseFeelCondition("amount > 1000 && approved");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(evaluate(r.ast, { amount: 1500, approved: true })).toBe(true);
      expect(evaluate(r.ast, { amount: 500, approved: true })).toBe(false);
    }
  });

  it("evaluates a ternary against a scope", () => {
    const r = parseFeelCondition("amount > 1000 ? 'manual' : 'auto'");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(evaluate(r.ast, { amount: 5000 })).toBe("manual");
      expect(evaluate(r.ast, { amount: 100 })).toBe("auto");
    }
  });

  it("evaluator returns undefined for unknown identifiers", () => {
    const r = parseFeelCondition("missing > 5");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // JS NaN-style: undefined > 5 is false, doesn't throw.
      // The preview UI surfaces this as "false" — documented behaviour.
      expect(evaluate(r.ast, {})).toBe(false);
    }
  });

  it("evaluator returns truthy/falsy on type-coercion comparisons", () => {
    // Documents engine parity: the runtime uses `new Function()` to
    // run the expression, which JS-coerces "5" > 3 → true. The
    // designer evaluator follows the same semantics so what the
    // user sees in the "evaluates to:" preview matches runtime.
    const r = parseFeelCondition("flag == 1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // `==` is loose equality: 1 == "1" → true.
      expect(evaluate(r.ast, { flag: "1" })).toBe(true);
      expect(evaluate(r.ast, { flag: 1 })).toBe(true);
      expect(evaluate(r.ast, { flag: 2 })).toBe(false);
    }
  });
});

describe("parseVariableRef", () => {
  it("accepts ${path} form", () => {
    const r = parseVariableRef("${manager.id}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identifiers).toEqual(["manager"]);
  });

  it("rejects raw identifier without ${}", () => {
    const r = parseVariableRef("managerId");
    expect(r.ok).toBe(false);
  });

  it("rejects a full expression", () => {
    const r = parseVariableRef("amount > 5");
    expect(r.ok).toBe(false);
  });
});
