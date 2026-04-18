/* ─── Event Definition Serialization ──────────────────────────────────
 * Maps our EventDefinition union (types/bpmn-node-data.ts) to and from
 * the BPMN 2.0 `<bpmn:*EventDefinition>` child elements.
 *
 * Referenced declarations (bpmn:message, bpmn:signal, bpmn:error root
 * elements) aren't emitted yet — message/signal/error *names* travel in
 * extensionElements for round-trip fidelity, and the declarations land
 * alongside P5 subprocess / P6 collaboration work.
 * ──────────────────────────────────────────────────────────────────── */

import type { BpmnModdle } from "bpmn-moddle";
import type { EventDefinition } from "../../types/bpmn-node-data";

type Moddle = InstanceType<typeof BpmnModdle>;
type ModdleElement = Record<string, unknown> & { $type: string };

/** Build the `eventDefinitions` array for a flow-node element. Empty array
 *  means `kind === "none"` — caller should simply omit the attribute. */
export function buildEventDefinitionElements(
  moddle: Moddle,
  def: EventDefinition | undefined,
): ModdleElement[] {
  if (!def || def.kind === "none") return [];

  switch (def.kind) {
    case "timer": {
      const body = def.value || "";
      const exprType =
        def.timerType === "duration"
          ? "bpmn:timeDuration"
          : def.timerType === "cycle"
          ? "bpmn:timeCycle"
          : "bpmn:timeDate";
      const el = moddle.create("bpmn:TimerEventDefinition", {}) as unknown as ModdleElement;
      if (body) {
        const expr = moddle.create("bpmn:FormalExpression", { body });
        (el as Record<string, unknown>)[
          exprType === "bpmn:timeDate" ? "timeDate" : exprType === "bpmn:timeDuration" ? "timeDuration" : "timeCycle"
        ] = expr;
      }
      return [el];
    }
    case "message":
      // messageRef requires a root `bpmn:Message` declaration — deferred.
      // messageName is preserved via extensionElements.
      return [moddle.create("bpmn:MessageEventDefinition", {}) as unknown as ModdleElement];
    case "signal":
      return [moddle.create("bpmn:SignalEventDefinition", {}) as unknown as ModdleElement];
    case "error":
      return [moddle.create("bpmn:ErrorEventDefinition", {}) as unknown as ModdleElement];
    case "escalation":
      return [moddle.create("bpmn:EscalationEventDefinition", {}) as unknown as ModdleElement];
    case "compensation":
      return [moddle.create("bpmn:CompensateEventDefinition", {}) as unknown as ModdleElement];
    case "terminate":
      return [moddle.create("bpmn:TerminateEventDefinition", {}) as unknown as ModdleElement];
    case "cancel":
      return [moddle.create("bpmn:CancelEventDefinition", {}) as unknown as ModdleElement];
    case "conditional": {
      const el = moddle.create("bpmn:ConditionalEventDefinition", {}) as unknown as ModdleElement;
      if (def.condition) {
        el.condition = moddle.create("bpmn:FormalExpression", { body: def.condition });
      }
      return [el];
    }
    case "link":
      return [
        moddle.create("bpmn:LinkEventDefinition", {
          name: def.linkName || undefined,
        }) as unknown as ModdleElement,
      ];
  }
}

/** Inverse: read the first `eventDefinitions` entry off a parsed flow-node
 *  moddle element and map back to our EventDefinition union. Returns
 *  `{ kind: "none" }` when none present. */
export function readEventDefinition(
  el: ModdleElement,
): EventDefinition {
  const defs = el.eventDefinitions as ModdleElement[] | undefined;
  if (!defs || defs.length === 0) return { kind: "none" };
  const d = defs[0];

  switch (d.$type) {
    case "bpmn:TimerEventDefinition": {
      const date = d.timeDate as ModdleElement | undefined;
      const dur = d.timeDuration as ModdleElement | undefined;
      const cyc = d.timeCycle as ModdleElement | undefined;
      if (dur) return { kind: "timer", timerType: "duration", value: (dur.body as string) || "" };
      if (cyc) return { kind: "timer", timerType: "cycle", value: (cyc.body as string) || "" };
      return { kind: "timer", timerType: "date", value: (date?.body as string) || "" };
    }
    case "bpmn:MessageEventDefinition":
      return { kind: "message", messageName: "" };
    case "bpmn:SignalEventDefinition":
      return { kind: "signal", signalName: "" };
    case "bpmn:ErrorEventDefinition":
      return { kind: "error", errorCode: "" };
    case "bpmn:EscalationEventDefinition":
      return { kind: "escalation", escalationCode: "" };
    case "bpmn:CompensateEventDefinition":
      return { kind: "compensation" };
    case "bpmn:TerminateEventDefinition":
      return { kind: "terminate" };
    case "bpmn:CancelEventDefinition":
      return { kind: "cancel" };
    case "bpmn:ConditionalEventDefinition": {
      const cond = d.condition as ModdleElement | undefined;
      return { kind: "conditional", condition: (cond?.body as string) || "" };
    }
    case "bpmn:LinkEventDefinition":
      return { kind: "link", linkName: (d.name as string) || "" };
    default:
      return { kind: "none" };
  }
}
