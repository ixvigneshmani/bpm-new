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

/* ─── Multi-Instance & Loop Markers ─── */

export type LoopMarker =
  | { kind: "none" }
  | { kind: "standardLoop"; condition?: FeelExpression; testBefore?: boolean; loopMaximum?: number }
  | {
      kind: "multiInstance";
      mode: "parallel" | "sequential";
      collection?: FeelExpression;   // FEEL collection expression
      elementVariable?: string;       // per-iteration variable name
      completionCondition?: FeelExpression;
    };

export type CompensationMarker = {
  enabled: boolean;
};

/* ─── Script Task implementation ─── */

export type ScriptLanguage = "feel" | "javascript" | "python" | "groovy";

export type ScriptConfig = {
  language: ScriptLanguage;
  script: string;
  resultVariable?: string;
};

/* ─── Send / Receive message config ─── */

export type SendMessageConfig = {
  messageName: string;
  correlationKey?: FeelExpression;
  payloadMappings?: VariableMapping[];
  targetSystem?: string; // optional endpoint/broker reference
};

export type ReceiveMessageConfig = {
  messageName: string;
  correlationKey?: FeelExpression;
  payloadMappings?: VariableMapping[]; // where to store incoming data
};

/* ─── Business Rule (DMN) config ─── */

export type BusinessRuleBinding = "dmnRef" | "inlineTable" | "expression";

export type DmnRefConfig = {
  binding: "dmnRef";
  decisionId: string;
  decisionName?: string;
  resultVariable?: string;
};

export type InlineTableConfig = {
  binding: "inlineTable";
  tableId?: string; // link to table builder (later)
  resultVariable?: string;
};

export type RuleExpressionConfig = {
  binding: "expression";
  expression: FeelExpression;
  resultVariable?: string;
};

export type BusinessRuleConfig = DmnRefConfig | InlineTableConfig | RuleExpressionConfig;

/* ─── Call Activity config ─── */

export type CallActivityBinding = "latest" | "deployment" | "version";

export type CallActivityConfig = {
  calledProcessId: string;
  calledProcessName?: string;
  binding: CallActivityBinding;
  version?: string;
  inputMappings?: VariableMapping[];   // parent → child
  outputMappings?: VariableMapping[];  // child → parent
  propagateAllVariables?: boolean;
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
  /** Optional resize overrides — written by NodeResizer when user drags. */
  width?: number;
  height?: number;
};

/** Shared by all activities (tasks + subprocesses). */
export type ActivityCommon = {
  loopMarker?: LoopMarker;
  compensation?: CompensationMarker;
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

export type IntermediateThrowEventData = BaseNodeData & {
  bpmnType: "intermediateThrowEvent";
  eventDefinition: EventDefinition;
};

export type IntermediateCatchEventData = BaseNodeData & {
  bpmnType: "intermediateCatchEvent";
  eventDefinition: EventDefinition;
};

export type BoundaryEventData = BaseNodeData & {
  bpmnType: "boundaryEvent";
  eventDefinition: EventDefinition;
  /** ID of the host activity this boundary event is attached to. */
  attachedToRef?: string;
  /** When true (default, interrupting), the host activity is cancelled
   *  when the event fires. When false, the host continues running. */
  cancelActivity?: boolean;
};

export type UserTaskData = BaseNodeData & ActivityCommon & {
  bpmnType: "userTask";
  assignment?: Assignment;
  form?: FormConfig;
  scheduling?: SchedulingConfig;
  sla?: SlaConfig;
  hooks?: TaskHooks;
};

export type ServiceTaskData = BaseNodeData & ActivityCommon & {
  bpmnType: "serviceTask";
  implementation?: ServiceImplementation;
  resilience?: ResilienceConfig;
  errorMappings?: ErrorMapping[];
};

export type ScriptTaskData = BaseNodeData & ActivityCommon & {
  bpmnType: "scriptTask";
  script?: ScriptConfig;
};

export type SendTaskData = BaseNodeData & ActivityCommon & {
  bpmnType: "sendTask";
  message?: SendMessageConfig;
};

export type ReceiveTaskData = BaseNodeData & ActivityCommon & {
  bpmnType: "receiveTask";
  message?: ReceiveMessageConfig;
  instantiate?: boolean;
};

export type ManualTaskData = BaseNodeData & ActivityCommon & {
  bpmnType: "manualTask";
  instructions?: string;
};

export type BusinessRuleTaskData = BaseNodeData & ActivityCommon & {
  bpmnType: "businessRuleTask";
  rule?: BusinessRuleConfig;
};

export type CallActivityData = BaseNodeData & ActivityCommon & {
  bpmnType: "callActivity";
  call?: CallActivityConfig;
};

export type ExclusiveGatewayData = BaseNodeData & {
  bpmnType: "exclusiveGateway";
  defaultFlowId?: string;
};

export type ParallelGatewayData = BaseNodeData & {
  bpmnType: "parallelGateway";
};

export type InclusiveGatewayData = BaseNodeData & {
  bpmnType: "inclusiveGateway";
  defaultFlowId?: string;
};

export type EventBasedGatewayData = BaseNodeData & {
  bpmnType: "eventBasedGateway";
  /** When true, this gateway instantiates a new process on first event. */
  instantiate?: boolean;
};

/* ─── Subprocess family ─── */

/** Transaction protocol (BPMN 2.0 §10.6.4). Rarely tuned by modelers — kept
 *  as a typed string so it round-trips through XML for tools that do. */
export type TransactionMethod = "##Compensate" | "##Store" | "##Image";

export type SubProcessData = BaseNodeData & ActivityCommon & {
  bpmnType: "subProcess";
  /** BPMN `isExpanded` on a SubProcess. When true the shape renders as a
   *  resizable frame with children; when false it collapses to a task-
   *  sized box with a `+` marker. */
  isExpanded?: boolean;
};

export type EventSubProcessData = BaseNodeData & ActivityCommon & {
  bpmnType: "eventSubProcess";
  isExpanded?: boolean;
  /** Always true for event subprocesses — modeled as a SubProcess with
   *  `triggeredByEvent=true` per BPMN 2.0 §10.11. Kept on the data for
   *  symmetry with other flags; we do not allow editing it away. */
  triggeredByEvent: true;
};

export type TransactionData = BaseNodeData & ActivityCommon & {
  bpmnType: "transaction";
  isExpanded?: boolean;
  /** Transaction protocol (rarely used). Undefined = unspecified. */
  method?: TransactionMethod;
};

export type AdHocSubProcessData = BaseNodeData & ActivityCommon & {
  bpmnType: "adHocSubProcess";
  isExpanded?: boolean;
  /** Ordering of ad-hoc activities. BPMN default is `Parallel`. */
  ordering?: "Parallel" | "Sequential";
};

/* ─── Swimlanes (pool + lane) ─── */

export type PoolData = BaseNodeData & {
  bpmnType: "pool";
  /** Participant name — shown in the vertical header band. Defaults to `label`. */
  participantName?: string;
  /** BPMN `bpmn:Participant.processRef.id`. When undefined the pool is
   *  still emitted but its Process id is auto-generated at serialize. */
  processId?: string;
  /** Horizontal orientation per BPMN DI. v1 supports horizontal only. */
  isHorizontal?: boolean;
};

export type LaneData = BaseNodeData & {
  bpmnType: "lane";
  /** Horizontal orientation mirrors the parent pool. */
  isHorizontal?: boolean;
};

/* ─── Discriminated union ─── */

export type BpmnNodeData =
  | StartEventData
  | EndEventData
  | IntermediateThrowEventData
  | IntermediateCatchEventData
  | BoundaryEventData
  | UserTaskData
  | ServiceTaskData
  | ScriptTaskData
  | SendTaskData
  | ReceiveTaskData
  | ManualTaskData
  | BusinessRuleTaskData
  | CallActivityData
  | SubProcessData
  | EventSubProcessData
  | TransactionData
  | AdHocSubProcessData
  | PoolData
  | LaneData
  | ExclusiveGatewayData
  | ParallelGatewayData
  | InclusiveGatewayData
  | EventBasedGatewayData
  | BaseNodeData; // fallback for types not yet fully typed

/* ─── Default data factories ─── */

export function createDefaultNodeData(bpmnType: string, label?: string): BpmnNodeData {
  const defaults: Record<string, string> = {
    startEvent: "Start",
    endEvent: "End",
    intermediateThrowEvent: "Throw",
    intermediateCatchEvent: "Catch",
    boundaryEvent: "Boundary",
    userTask: "User Task",
    serviceTask: "Service Task",
    scriptTask: "Script Task",
    sendTask: "Send Message",
    receiveTask: "Receive Message",
    manualTask: "Manual Task",
    businessRuleTask: "Business Rule",
    callActivity: "Call Process",
    exclusiveGateway: "",
    parallelGateway: "",
    inclusiveGateway: "",
    eventBasedGateway: "",
    subProcess: "Subprocess",
    eventSubProcess: "Event Subprocess",
    transaction: "Transaction",
    adHocSubProcess: "Ad-hoc Subprocess",
    pool: "Pool",
    lane: "Lane",
  };

  const base: BaseNodeData = {
    label: label || defaults[bpmnType] || bpmnType,
    bpmnType,
  };

  const activityBase = { loopMarker: { kind: "none" } as LoopMarker };

  switch (bpmnType) {
    case "startEvent":
      return { ...base, bpmnType: "startEvent", eventDefinition: { kind: "none" } } as StartEventData;
    case "endEvent":
      return { ...base, bpmnType: "endEvent", eventDefinition: { kind: "none" } } as EndEventData;
    case "intermediateThrowEvent":
      return { ...base, bpmnType: "intermediateThrowEvent", eventDefinition: { kind: "none" } } as IntermediateThrowEventData;
    case "intermediateCatchEvent":
      return { ...base, bpmnType: "intermediateCatchEvent", eventDefinition: { kind: "none" } } as IntermediateCatchEventData;
    case "boundaryEvent":
      return { ...base, bpmnType: "boundaryEvent", eventDefinition: { kind: "none" }, cancelActivity: true } as BoundaryEventData;
    case "userTask":
      return { ...base, ...activityBase, bpmnType: "userTask" } as UserTaskData;
    case "serviceTask":
      return { ...base, ...activityBase, bpmnType: "serviceTask" } as ServiceTaskData;
    case "scriptTask":
      return {
        ...base, ...activityBase, bpmnType: "scriptTask",
        script: { language: "feel", script: "" },
      } as ScriptTaskData;
    case "sendTask":
      return {
        ...base, ...activityBase, bpmnType: "sendTask",
        message: { messageName: "" },
      } as SendTaskData;
    case "receiveTask":
      return {
        ...base, ...activityBase, bpmnType: "receiveTask",
        message: { messageName: "" },
      } as ReceiveTaskData;
    case "manualTask":
      return { ...base, ...activityBase, bpmnType: "manualTask" } as ManualTaskData;
    case "businessRuleTask":
      return {
        ...base, ...activityBase, bpmnType: "businessRuleTask",
        rule: { binding: "dmnRef", decisionId: "" },
      } as BusinessRuleTaskData;
    case "callActivity":
      return {
        ...base, ...activityBase, bpmnType: "callActivity",
        call: { calledProcessId: "", binding: "latest", propagateAllVariables: false },
      } as CallActivityData;
    case "exclusiveGateway":
      return { ...base, bpmnType: "exclusiveGateway" } as ExclusiveGatewayData;
    case "parallelGateway":
      return { ...base, bpmnType: "parallelGateway" } as ParallelGatewayData;
    case "inclusiveGateway":
      return { ...base, bpmnType: "inclusiveGateway" } as InclusiveGatewayData;
    case "eventBasedGateway":
      return { ...base, bpmnType: "eventBasedGateway", instantiate: false } as EventBasedGatewayData;
    case "subProcess":
      return {
        ...base, ...activityBase, bpmnType: "subProcess",
        isExpanded: true,
      } as SubProcessData;
    case "eventSubProcess":
      return {
        ...base, ...activityBase, bpmnType: "eventSubProcess",
        isExpanded: true, triggeredByEvent: true,
      } as EventSubProcessData;
    case "transaction":
      return {
        ...base, ...activityBase, bpmnType: "transaction",
        isExpanded: true,
      } as TransactionData;
    case "adHocSubProcess":
      return {
        ...base, ...activityBase, bpmnType: "adHocSubProcess",
        isExpanded: true, ordering: "Parallel",
      } as AdHocSubProcessData;
    case "pool":
      return {
        ...base, bpmnType: "pool",
        participantName: label || "Pool",
        isHorizontal: true,
      } as PoolData;
    case "lane":
      return { ...base, bpmnType: "lane", isHorizontal: true } as LaneData;
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
  intermediateThrowEvent: { color: "#9333EA", bgLight: "#FAF5FF", bgSelected: "#F3E8FF", borderLight: "#D8B4FE", label: "Throw Event",  iconBg: "#F3E8FF" },
  intermediateCatchEvent: { color: "#0D9488", bgLight: "#F0FDFA", bgSelected: "#CCFBF1", borderLight: "#5EEAD4", label: "Catch Event",  iconBg: "#CCFBF1" },
  boundaryEvent:    { color: "#C2410C", bgLight: "#FFF7ED", bgSelected: "#FFEDD5", borderLight: "#FDBA74", label: "Boundary Event",    iconBg: "#FFEDD5" },
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
  subProcess:       { color: "#475467", bgLight: "#F8FAFC", bgSelected: "#F1F5F9", borderLight: "#CBD5E1", label: "Subprocess",          iconBg: "#F1F5F9" },
  eventSubProcess:  { color: "#7C3AED", bgLight: "#F5F3FF", bgSelected: "#EDE9FE", borderLight: "#C4B5FD", label: "Event Subprocess",    iconBg: "#EDE9FE" },
  transaction:      { color: "#0F766E", bgLight: "#F0FDFA", bgSelected: "#CCFBF1", borderLight: "#5EEAD4", label: "Transaction",         iconBg: "#CCFBF1" },
  adHocSubProcess:  { color: "#B45309", bgLight: "#FFFBEB", bgSelected: "#FEF3C7", borderLight: "#FCD34D", label: "Ad-hoc Subprocess",   iconBg: "#FEF3C7" },
  pool:             { color: "#1D4ED8", bgLight: "#EFF6FF", bgSelected: "#DBEAFE", borderLight: "#93C5FD", label: "Pool",                iconBg: "#DBEAFE" },
  lane:             { color: "#1D4ED8", bgLight: "#F8FAFC", bgSelected: "#F1F5F9", borderLight: "#CBD5E1", label: "Lane",                iconBg: "#F1F5F9" },
};
