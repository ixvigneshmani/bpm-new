/* ─── Event Definition Serialization ──────────────────────────────────
 * Maps our EventDefinition union (types/bpmn-node-data.ts) to and from
 * the BPMN 2.0 `<bpmn:*EventDefinition>` child elements.
 *
 * Root declarations (`bpmn:Message`, `bpmn:Signal`, `bpmn:Error`) are
 * derived from the names referenced by event definitions and wired up
 * via `messageRef` / `signalRef` / `errorRef` — see `buildRootDeclarations`
 * and `resolveRootDeclarations` for the two sides of that bridge.
 * ──────────────────────────────────────────────────────────────────── */

import type { BpmnModdle } from "bpmn-moddle";
import type { EventDefinition } from "../../types/bpmn-node-data";

type Moddle = InstanceType<typeof BpmnModdle>;
type ModdleElement = Record<string, unknown> & { $type: string; id?: string };

/** Registry of root-element declarations that event definitions point to.
 *  Keyed by the user-facing name/code. Values are the moddle elements
 *  already allocated in `buildRootDeclarations`. */
export type RootDeclarations = {
  messages: Map<string, ModdleElement>;
  signals: Map<string, ModdleElement>;
  errors: Map<string, ModdleElement>;
};

/** Stable, XML-safe id from a user-typed name. Collisions within a kind
 *  are impossible because the map is keyed by the same normalized key. */
function declId(prefix: "Message" | "Signal" | "Error", name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_]/g, "_");
  return `${prefix}_${safe}`;
}

/** Build an empty registry. Populate via `collectRootDeclarationNames`. */
export function emptyRootDeclarations(): RootDeclarations {
  return { messages: new Map(), signals: new Map(), errors: new Map() };
}

/** Walk a list of data blobs and record every referenced
 *  message/signal/error name. Run this once per serialize, across all
 *  node datas (and later, all message-flow edge datas). */
export function collectRootDeclarationNames(
  moddle: Moddle,
  registry: RootDeclarations,
  dataList: Array<Record<string, unknown> | undefined>,
): void {
  for (const data of dataList) {
    if (!data) continue;
    const def = data.eventDefinition as EventDefinition | undefined;
    if (!def) continue;
    if (def.kind === "message" && def.messageName && !registry.messages.has(def.messageName)) {
      registry.messages.set(
        def.messageName,
        moddle.create("bpmn:Message", {
          id: declId("Message", def.messageName),
          name: def.messageName,
        }) as unknown as ModdleElement,
      );
    }
    if (def.kind === "signal" && def.signalName && !registry.signals.has(def.signalName)) {
      registry.signals.set(
        def.signalName,
        moddle.create("bpmn:Signal", {
          id: declId("Signal", def.signalName),
          name: def.signalName,
        }) as unknown as ModdleElement,
      );
    }
    if (def.kind === "error" && def.errorCode && !registry.errors.has(def.errorCode)) {
      registry.errors.set(
        def.errorCode,
        moddle.create("bpmn:Error", {
          id: declId("Error", def.errorCode),
          name: def.errorCode,
          errorCode: def.errorCode,
        }) as unknown as ModdleElement,
      );
    }
  }
}

/** Flat list of root-element moddle objects ready to be pushed into
 *  `bpmn:Definitions.rootElements` alongside the process(es). */
export function rootDeclarationsAsArray(registry: RootDeclarations): ModdleElement[] {
  return [
    ...registry.messages.values(),
    ...registry.signals.values(),
    ...registry.errors.values(),
  ];
}

/** Build the `eventDefinitions` array for a flow-node element. Empty array
 *  means `kind === "none"` — caller should simply omit the attribute.
 *  When `registry` is provided, message/signal/error event definitions
 *  gain a `*Ref` pointing to the corresponding root declaration. */
export function buildEventDefinitionElements(
  moddle: Moddle,
  def: EventDefinition | undefined,
  registry?: RootDeclarations,
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
    case "message": {
      const attrs: Record<string, unknown> = {};
      const ref = def.messageName && registry?.messages.get(def.messageName);
      if (ref) attrs.messageRef = ref;
      return [moddle.create("bpmn:MessageEventDefinition", attrs) as unknown as ModdleElement];
    }
    case "signal": {
      const attrs: Record<string, unknown> = {};
      const ref = def.signalName && registry?.signals.get(def.signalName);
      if (ref) attrs.signalRef = ref;
      return [moddle.create("bpmn:SignalEventDefinition", attrs) as unknown as ModdleElement];
    }
    case "error": {
      const attrs: Record<string, unknown> = {};
      const ref = def.errorCode && registry?.errors.get(def.errorCode);
      if (ref) attrs.errorRef = ref;
      return [moddle.create("bpmn:ErrorEventDefinition", attrs) as unknown as ModdleElement];
    }
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

/** Resolve root declarations from a parsed `bpmn:Definitions.rootElements`
 *  list into lookup maps keyed by declaration id (what event definitions
 *  reference). Used by `readEventDefinition` to recover names. */
export type ResolvedRootDeclarations = {
  messageNameById: Map<string, string>;
  signalNameById: Map<string, string>;
  errorCodeById: Map<string, string>;
};

export function resolveRootDeclarations(
  rootElements: ModdleElement[] | undefined,
): ResolvedRootDeclarations {
  const out: ResolvedRootDeclarations = {
    messageNameById: new Map(),
    signalNameById: new Map(),
    errorCodeById: new Map(),
  };
  for (const el of rootElements || []) {
    if (!el.id) continue;
    if (el.$type === "bpmn:Message" && typeof el.name === "string") {
      out.messageNameById.set(el.id, el.name);
    } else if (el.$type === "bpmn:Signal" && typeof el.name === "string") {
      out.signalNameById.set(el.id, el.name);
    } else if (el.$type === "bpmn:Error") {
      // `errorCode` is the BPMN-canonical field; `name` is human-readable.
      // Prefer errorCode and fall back to name so we carry something back.
      const code = (el.errorCode as string) || (el.name as string) || "";
      if (code) out.errorCodeById.set(el.id, code);
    }
  }
  return out;
}

/** Inverse: read the first `eventDefinitions` entry off a parsed flow-node
 *  moddle element and map back to our EventDefinition union. Returns
 *  `{ kind: "none" }` when none present. When `resolved` is provided,
 *  messageRef/signalRef/errorRef resolve to the declared name/code. */
export function readEventDefinition(
  el: ModdleElement,
  resolved?: ResolvedRootDeclarations,
): EventDefinition {
  const defs = el.eventDefinitions as ModdleElement[] | undefined;
  if (!defs || defs.length === 0) return { kind: "none" };
  const d = defs[0];

  const refId = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && typeof (v as ModdleElement).id === "string") {
      return (v as ModdleElement).id;
    }
    return undefined;
  };

  switch (d.$type) {
    case "bpmn:TimerEventDefinition": {
      const date = d.timeDate as ModdleElement | undefined;
      const dur = d.timeDuration as ModdleElement | undefined;
      const cyc = d.timeCycle as ModdleElement | undefined;
      if (dur) return { kind: "timer", timerType: "duration", value: (dur.body as string) || "" };
      if (cyc) return { kind: "timer", timerType: "cycle", value: (cyc.body as string) || "" };
      return { kind: "timer", timerType: "date", value: (date?.body as string) || "" };
    }
    case "bpmn:MessageEventDefinition": {
      const id = refId(d.messageRef);
      const name = (id && resolved?.messageNameById.get(id)) || "";
      return { kind: "message", messageName: name };
    }
    case "bpmn:SignalEventDefinition": {
      const id = refId(d.signalRef);
      const name = (id && resolved?.signalNameById.get(id)) || "";
      return { kind: "signal", signalName: name };
    }
    case "bpmn:ErrorEventDefinition": {
      const id = refId(d.errorRef);
      const code = (id && resolved?.errorCodeById.get(id)) || "";
      return { kind: "error", errorCode: code };
    }
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
