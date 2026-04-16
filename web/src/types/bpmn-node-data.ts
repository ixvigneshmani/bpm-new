/* ─── BPMN Node Data Types ────────────────────────────────────────────
 * Typed data interfaces for every node kind on the canvas.
 * These are stored in React Flow's node.data field and persisted to the API.
 * ──────────────────────────────────────────────────────────────────── */

/* ─── Shared primitives ─── */

export type FeelExpression = string; // raw FEEL expression string

export type VariableMapping = {
  id: string;
  source: FeelExpression;
  target: string;
  type?: string;
};

export type KeyValuePair = {
  key: string;
  value: string;
};

/* ─── Event Definitions ─── */

export type TimerType = "date" | "duration" | "cycle";

export type TimerDefinition = {
  kind: "timer";
  timerType: TimerType;
  value: string; // ISO 8601 or FEEL expression
};

export type MessageDefinition = {
  kind: "message";
  messageName: string;
  correlationKey?: FeelExpression;
  payloadMappings?: VariableMapping[];
};

export type SignalDefinition = {
  kind: "signal";
  signalName: string;
};

export type ConditionalDefinition = {
  kind: "conditional";
  condition: FeelExpression;
};

export type ErrorDefinition = {
  kind: "error";
  errorCode: string;
  errorMessage?: FeelExpression;
  payloadType?: string;
};

export type EscalationDefinition = {
  kind: "escalation";
  escalationCode: string;
};

export type CompensationDefinition = {
  kind: "compensation";
};

export type TerminateDefinition = {
  kind: "terminate";
};

export type LinkDefinition = {
  kind: "link";
  linkName: string;
};

export type CancelDefinition = {
  kind: "cancel";
};

export type NoneDefinition = {
  kind: "none";
};

export type EventDefinition =
  | NoneDefinition
  | TimerDefinition
  | MessageDefinition
  | SignalDefinition
  | ConditionalDefinition
  | ErrorDefinition
  | EscalationDefinition
  | CompensationDefinition
  | TerminateDefinition
  | LinkDefinition
  | CancelDefinition;

/* ─── Assignment (User Task) ─── */

export type AssignmentType = "directUser" | "candidateGroup" | "expression" | "aiRouted";

export type Assignment = {
  type: AssignmentType;
  value: string; // user ID, group name, or FEEL expression
};

/* ─── SLA (our extension) ─── */

export type SlaBreachAction = "escalate" | "notify" | "subprocess" | "hook";

export type SlaConfig = {
  reactionTime?: string; // ISO 8601 duration
  completionDeadline?: string;
  breachAction?: SlaBreachAction;
};

/* ─── Scheduling ─── */

export type SchedulingConfig = {
  dueDate?: string; // ISO 8601 or FEEL expression
  dueDateIsExpression?: boolean;
  followUpDate?: string;
  followUpDateIsExpression?: boolean;
  priority?: number; // 25=Low, 50=Medium, 75=High, 100=Critical
  priorityExpression?: FeelExpression;
};

/* ─── Form reference ─── */

export type FormType = "embedded" | "external" | "formKey" | "none";

export type FormConfig = {
  type: FormType;
  value?: string; // URL, form key, or embedded form reference
};

/* ─── Service Task Implementation ─── */

export type BindingType = "inlineScript" | "externalWorker" | "connector" | "rest" | "soap" | "wasmModule";

export type RestAuth =
  | { type: "none" }
  | { type: "apiKey"; headerName: string; value: FeelExpression }
  | { type: "bearer"; token: FeelExpression }
  | { type: "basic"; username: FeelExpression; password: FeelExpression }
  | { type: "oauth2"; credentialRef: string }
  | { type: "credentialRef"; refId: string };

export type RestConfig = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: FeelExpression;
  headers?: KeyValuePair[];
  queryParams?: KeyValuePair[];
  body?: string;
  auth?: RestAuth;
};

export type InlineScriptConfig = {
  language: "feel" | "javascript" | "python";
  script: string;
};

export type ExternalWorkerConfig = {
  jobType: string;
  headers?: KeyValuePair[];
};

export type ConnectorConfig = {
  connectorType: string;
  config: Record<string, unknown>;
};

export type ServiceImplementation =
  | { type: "inlineScript"; config: InlineScriptConfig }
  | { type: "externalWorker"; config: ExternalWorkerConfig }
  | { type: "connector"; config: ConnectorConfig }
  | { type: "rest"; config: RestConfig }
  | { type: "soap"; config: { wsdlUrl: string; operation: string; namespaces?: KeyValuePair[] } }
  | { type: "wasmModule"; config: { moduleRef: string } };

/* ─── Resilience ─── */

export type RetryPolicy = {
  count: number;
  backoff: "fixed" | "exponential";
  delay: string; // ISO 8601 duration
  maxDelay?: string;
  jitter?: boolean;
};

export type ResilienceConfig = {
  retry?: RetryPolicy;
  timeout?: string; // ISO 8601 duration
  circuitBreaker?: {
    failureThreshold: number;
    resetTimeout: string; // ISO 8601 duration
  };
  idempotencyKey?: FeelExpression;
};

/* ─── Error mapping ─── */

export type ErrorMapping = {
  id: string;
  condition: string; // e.g., "status >= 400", FEEL expression
  errorCode: string;
  errorMessage?: string;
  payloadType?: string;
};

/* ─── Task Lifecycle Hooks ─── */

export type TaskHooks = {
  onCreate?: string;
  onAssign?: string;
  onComplete?: string;
  onTimeout?: string;
};

/* ─── Per-node-type data interfaces ─── */

export type BaseNodeData = {
  label: string;
  bpmnType: string;
  description?: string;
  documentation?: string;
  inputMappings?: VariableMapping[];
  outputMappings?: VariableMapping[];
  extensionProperties?: KeyValuePair[];
};

export type StartEventData = BaseNodeData & {
  bpmnType: "startEvent";
  eventDefinition: EventDefinition;
  initiatorVariable?: string;
};

export type EndEventData = BaseNodeData & {
  bpmnType: "endEvent";
  eventDefinition: EventDefinition;
};

export type UserTaskData = BaseNodeData & {
  bpmnType: "userTask";
  assignment?: Assignment;
  form?: FormConfig;
  scheduling?: SchedulingConfig;
  sla?: SlaConfig;
  hooks?: TaskHooks;
};

export type ServiceTaskData = BaseNodeData & {
  bpmnType: "serviceTask";
  implementation?: ServiceImplementation;
  resilience?: ResilienceConfig;
  errorMappings?: ErrorMapping[];
};

export type ExclusiveGatewayData = BaseNodeData & {
  bpmnType: "exclusiveGateway";
  defaultFlowId?: string;
};

/* ─── Discriminated union ─── */

export type BpmnNodeData =
  | StartEventData
  | EndEventData
  | UserTaskData
  | ServiceTaskData
  | ExclusiveGatewayData
  | BaseNodeData; // fallback for types not yet fully typed

/* ─── Default data factories ─── */

export function createDefaultNodeData(bpmnType: string, label?: string): BpmnNodeData {
  const defaults: Record<string, string> = {
    startEvent: "Start",
    endEvent: "End",
    userTask: "User Task",
    serviceTask: "Service Task",
    exclusiveGateway: "",
  };

  const base: BaseNodeData = {
    label: label || defaults[bpmnType] || bpmnType,
    bpmnType,
  };

  switch (bpmnType) {
    case "startEvent":
      return { ...base, bpmnType: "startEvent", eventDefinition: { kind: "none" } } as StartEventData;
    case "endEvent":
      return { ...base, bpmnType: "endEvent", eventDefinition: { kind: "none" } } as EndEventData;
    case "userTask":
      return { ...base, bpmnType: "userTask" } as UserTaskData;
    case "serviceTask":
      return { ...base, bpmnType: "serviceTask" } as ServiceTaskData;
    case "exclusiveGateway":
      return { ...base, bpmnType: "exclusiveGateway" } as ExclusiveGatewayData;
    default:
      return base;
  }
}

/* ─── Node theme config ─── */

export type NodeTheme = {
  color: string;       // primary color (e.g., "#16A34A")
  bgLight: string;     // light background
  bgSelected: string;  // selected background
  borderLight: string; // default border
  label: string;       // display name
  iconBg: string;      // icon container background
};

export const NODE_THEMES: Record<string, NodeTheme> = {
  startEvent:       { color: "#16A34A", bgLight: "#F0FDF4", bgSelected: "#DCFCE7", borderLight: "#86EFAC", label: "Start Event",        iconBg: "#DCFCE7" },
  endEvent:         { color: "#DC2626", bgLight: "#FEF2F2", bgSelected: "#FEE2E2", borderLight: "#FCA5A5", label: "End Event",          iconBg: "#FEE2E2" },
  userTask:         { color: "#6366F1", bgLight: "#EEF2FF", bgSelected: "#E0E7FF", borderLight: "#C7D2FE", label: "User Task",          iconBg: "#EEF2FF" },
  serviceTask:      { color: "#EA580C", bgLight: "#FFF7ED", bgSelected: "#FFEDD5", borderLight: "#FDBA74", label: "Service Task",       iconBg: "#FFF7ED" },
  scriptTask:       { color: "#0891B2", bgLight: "#ECFEFF", bgSelected: "#CFFAFE", borderLight: "#67E8F9", label: "Script Task",        iconBg: "#ECFEFF" },
  sendTask:         { color: "#7C3AED", bgLight: "#F5F3FF", bgSelected: "#EDE9FE", borderLight: "#C4B5FD", label: "Send Task",          iconBg: "#F5F3FF" },
  receiveTask:      { color: "#2563EB", bgLight: "#EFF6FF", bgSelected: "#DBEAFE", borderLight: "#93C5FD", label: "Receive Task",       iconBg: "#EFF6FF" },
  manualTask:       { color: "#059669", bgLight: "#ECFDF5", bgSelected: "#D1FAE5", borderLight: "#6EE7B7", label: "Manual Task",        iconBg: "#ECFDF5" },
  businessRuleTask: { color: "#B45309", bgLight: "#FFFBEB", bgSelected: "#FEF3C7", borderLight: "#FCD34D", label: "Business Rule Task", iconBg: "#FFFBEB" },
  callActivity:     { color: "#475569", bgLight: "#F8FAFC", bgSelected: "#F1F5F9", borderLight: "#CBD5E1", label: "Call Activity",      iconBg: "#F1F5F9" },
  exclusiveGateway: { color: "#CA8A04", bgLight: "#FFFBEB", bgSelected: "#FEF9C3", borderLight: "#FDE68A", label: "Exclusive Gateway",  iconBg: "#FEF9C3" },
  parallelGateway:  { color: "#2563EB", bgLight: "#EFF6FF", bgSelected: "#DBEAFE", borderLight: "#93C5FD", label: "Parallel Gateway",   iconBg: "#DBEAFE" },
  inclusiveGateway: { color: "#7C3AED", bgLight: "#F5F3FF", bgSelected: "#EDE9FE", borderLight: "#C4B5FD", label: "Inclusive Gateway",  iconBg: "#EDE9FE" },
  eventBasedGateway:{ color: "#059669", bgLight: "#ECFDF5", bgSelected: "#D1FAE5", borderLight: "#6EE7B7", label: "Event-Based Gateway",iconBg: "#D1FAE5" },
};
