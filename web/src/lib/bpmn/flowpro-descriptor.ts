/* ─── FlowPro Moddle Descriptor ───────────────────────────────────────
 * Declares the `flowpro:` XML namespace that houses our non-spec data
 * (SLA, retries, assignment, implementation config, message details,
 * rich fields that have no BPMN home) under `<bpmn:extensionElements>`.
 *
 * We use a single generic `flowpro:Data` element that carries a JSON
 * payload as an attribute. This keeps the descriptor trivial while
 * giving us lossless round-trip — the tradeoff is opacity to other
 * tools, which will preserve the element as-is and ignore its content.
 * A richer typed descriptor can replace this later without breaking
 * existing exports.
 * ──────────────────────────────────────────────────────────────────── */

export const FLOWPRO_URI = "http://flowpro.io/schema/bpmn";
export const FLOWPRO_PREFIX = "flowpro";

export const flowproDescriptor = {
  name: "FlowPro",
  uri: FLOWPRO_URI,
  prefix: FLOWPRO_PREFIX,
  xml: { tagAlias: "lowerCase" },
  associations: [],
  types: [
    {
      name: "Data",
      superClass: ["Element"],
      properties: [
        { name: "json", type: "String", isAttr: true },
      ],
    },
  ],
};
