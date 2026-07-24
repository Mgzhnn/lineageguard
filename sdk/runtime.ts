import type {
  CustomLineageRule,
  Severity,
  TraceStage,
} from "../lib/analysis.ts";
import {
  fingerprintValue,
  sha256Hex,
} from "../lib/fingerprint.ts";
import {
  runReliabilityPipeline,
  type RecoveryPacket,
  type ReliabilityPipelineRun,
} from "../lib/pipeline.ts";

export type RuntimeEventType =
  | "source-recorded"
  | "agent-started"
  | "handoff-allowed"
  | "handoff-blocked"
  | "tool-allowed"
  | "tool-blocked"
  | "recovery-applied"
  | "run-completed"
  | "agent-failed";

export type RuntimeEvent = {
  type: RuntimeEventType;
  timestamp: string;
  sequence: number;
  sessionId: string;
  message: string;
  agentId?: string;
  runId?: string;
};

export type ToolPolicy = {
  allowedTools?: string[];
  deniedTools?: string[];
  approvalRequiredTools?: string[];
  sideEffectTools?: string[];
  defaultSideEffectMode?: "allow" | "deny" | "require-approval";
};

export type ToolApproval = {
  token: string;
  approvedBy: string;
};

export type ToolApprovalContext = {
  sessionId: string;
  runId: string;
  toolName: string;
  action: string;
  inputFingerprint: string;
  approval: Readonly<ToolApproval>;
};

export type ToolApprovalVerifier = (
  context: Readonly<ToolApprovalContext>,
) => boolean;

export type RegisteredTool<TInput = never, TResult = unknown> = {
  name: string;
  action: string;
  sideEffect: boolean;
  execute: (input: TInput) => TResult | Promise<TResult>;
};

export type RegisteredToolExecutionOptions = {
  approval?: ToolApproval;
  idempotencyKey?: string;
};

export type GuardedToolClient = {
  execute<TInput = unknown, TResult = unknown>(
    toolName: string,
    input: TInput,
    options?: RegisteredToolExecutionOptions,
  ): Promise<TResult>;
};

export type LineageGuardSessionOptions = {
  sessionId?: string;
  runName?: string;
  guardrail?: string;
  blockAtOrAbove?: Severity;
  toolPolicy?: ToolPolicy;
  rules?: readonly CustomLineageRule[];
  approvalVerifier?: ToolApprovalVerifier;
  tools?: readonly RegisteredTool[];
  exposeSessionToAgents?: boolean;
  onEvent?: (event: RuntimeEvent) => void;
  onEventError?: (error: unknown, event: RuntimeEvent) => void;
  eventSinkFailureMode?: "ignore" | "throw";
};

export type ToolIntent<TInput = unknown> = {
  toolName: string;
  action: string;
  input?: TInput;
  sideEffect: boolean;
  approval?: ToolApproval;
  idempotencyKey?: string;
  /**
   * @deprecated A reviewer name is not authorization. Supply a verified
   * `approval` token and configure `approvalVerifier`.
   */
  approvedBy?: string;
};

export type ToolDecision<TInput = unknown> = {
  status: "allowed" | "blocked" | "approval-required";
  reason: string;
  intent: ToolIntent<TInput>;
  inputFingerprint: string;
  requiresApproval: boolean;
  approvalVerified: boolean;
};

export type HandoffDecision = {
  status: "allowed" | "blocked";
  output: string;
  reason: string;
  report: ReliabilityPipelineRun;
};

export type HandoffOptions = {
  idempotencyKey?: string;
};

export type GuardedAgent<TContext = unknown> = {
  id: string;
  name: string;
  execute: (input: {
    input: string;
    context: TContext;
    guard?: LineageGuardSession;
    tools: GuardedToolClient;
  }) => string | Promise<string>;
};

export type GuardedSequenceResult = {
  status: "completed" | "blocked";
  blockedAgentId: string | null;
  report: ReliabilityPipelineRun;
};

export type PersistedToolExecution = {
  idempotencyKey: string;
  operationFingerprint: string;
  status: "pending" | "completed" | "failed";
};

export type PersistedHandoffRequest = {
  idempotencyKey: string;
  requestFingerprint: string;
  stageId: string;
  decision: HandoffDecision;
};

export type LineageGuardSessionSnapshot = {
  schemaVersion: "1.0";
  sessionId: string;
  runName: string;
  guardrail: string;
  blockAtOrAbove: Severity;
  toolPolicy: ToolPolicy;
  exposeSessionToAgents: boolean;
  ruleIds: string[];
  stages: TraceStage[];
  frozen: boolean;
  recoveryTransitionIndex: number | null;
  consumedApprovalTokenFingerprints: string[];
  toolExecutions: PersistedToolExecution[];
  handoffRequests: PersistedHandoffRequest[];
  eventSequence: number;
};

export type LineageGuardSnapshotStore = {
  load(sessionId: string): Promise<LineageGuardSessionSnapshot | null>;
  save(snapshot: LineageGuardSessionSnapshot): Promise<void>;
};

export type LineageGuardRestoreOptions = Pick<
  LineageGuardSessionOptions,
  | "rules"
  | "approvalVerifier"
  | "tools"
  | "onEvent"
  | "onEventError"
  | "eventSinkFailureMode"
>;

type ToolExecutionRecord = PersistedToolExecution & {
  promise?: Promise<unknown>;
  result?: unknown;
  hasResult?: boolean;
  error?: unknown;
};

type HandoffRequestRecord = PersistedHandoffRequest;

const severityRank: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

let sessionCounter = 0;

function createSessionId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `LGS-${randomId.replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  }
  sessionCounter += 1;
  const entropy = fingerprintValue({
    timestamp: new Date().toISOString(),
    counter: sessionCounter,
  });
  return `LGS-${entropy.slice(0, 16).toUpperCase()}`;
}

function matchesTool(toolName: string, patterns: string[] = []) {
  const normalized = toolName.trim().toLowerCase();
  return patterns.some((pattern) => {
    const candidate = pattern.trim().toLowerCase();
    if (candidate === "*") return true;
    if (candidate.endsWith("*")) {
      return normalized.startsWith(candidate.slice(0, -1));
    }
    return normalized === candidate;
  });
}

function cleanText(value: string, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field} must be a non-empty string.`);
  return cleaned;
}

function cleanOptionalText(value: string | undefined, field: string) {
  return value === undefined ? undefined : cleanText(value, field);
}

function cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Tool policy must be an object.");
  }
  (
    [
      "allowedTools",
      "deniedTools",
      "approvalRequiredTools",
      "sideEffectTools",
    ] as const
  ).forEach((field) => {
    const patterns = policy[field];
    if (
      patterns !== undefined &&
      (!Array.isArray(patterns) ||
        patterns.some(
          (pattern) => typeof pattern !== "string" || !pattern.trim(),
        ))
    ) {
      throw new Error(`Tool policy field "${field}" is invalid.`);
    }
  });
  if (
    policy.defaultSideEffectMode !== undefined &&
    policy.defaultSideEffectMode !== "allow" &&
    policy.defaultSideEffectMode !== "deny" &&
    policy.defaultSideEffectMode !== "require-approval"
  ) {
    throw new Error("Tool side-effect policy mode is invalid.");
  }
  return {
    allowedTools: policy.allowedTools ? [...policy.allowedTools] : undefined,
    deniedTools: policy.deniedTools ? [...policy.deniedTools] : undefined,
    approvalRequiredTools: policy.approvalRequiredTools
      ? [...policy.approvalRequiredTools]
      : undefined,
    sideEffectTools: policy.sideEffectTools
      ? [...policy.sideEffectTools]
      : undefined,
    defaultSideEffectMode: policy.defaultSideEffectMode,
  };
}

function normalizeBlockingThreshold(
  threshold: Severity | undefined,
): Severity {
  const normalized = threshold ?? "medium";
  if (
    normalized !== "low" &&
    normalized !== "medium" &&
    normalized !== "high"
  ) {
    throw new Error("Blocking threshold must be low, medium, or high.");
  }
  return normalized;
}

function normalizeRules(rules: readonly CustomLineageRule[] = []) {
  if (!Array.isArray(rules)) {
    throw new Error("Custom rules must be an array.");
  }
  const normalized = [...rules];
  const ids = new Set<string>();
  normalized.forEach((rule) => {
    if (
      !rule ||
      typeof rule !== "object" ||
      typeof rule.evaluate !== "function" ||
      (rule.family !== "evidence" &&
        rule.family !== "meaning" &&
        rule.family !== "authority")
    ) {
      throw new Error("Each custom rule must define a valid family and evaluator.");
    }
    const id = cleanText(rule.id, "Custom rule id");
    if (ids.has(id)) {
      throw new Error(`Custom rule id "${id}" is duplicated.`);
    }
    ids.add(id);
  });
  return normalized;
}

function validateSnapshot(snapshot: LineageGuardSessionSnapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("A LineageGuard session snapshot is required.");
  }
  if (snapshot.schemaVersion !== "1.0") {
    throw new Error("Unsupported LineageGuard session snapshot version.");
  }
  cleanText(snapshot.sessionId, "Snapshot session id");
  cleanText(snapshot.runName, "Snapshot run name");
  if (typeof snapshot.guardrail !== "string") {
    throw new Error("Snapshot guardrail must be a string.");
  }
  if (
    snapshot.blockAtOrAbove !== "low" &&
    snapshot.blockAtOrAbove !== "medium" &&
    snapshot.blockAtOrAbove !== "high"
  ) {
    throw new Error("Snapshot blocking threshold is invalid.");
  }
  if (
    !snapshot.toolPolicy ||
    typeof snapshot.toolPolicy !== "object" ||
    Array.isArray(snapshot.toolPolicy)
  ) {
    throw new Error("Snapshot tool policy is invalid.");
  }
  (
    [
      "allowedTools",
      "deniedTools",
      "approvalRequiredTools",
      "sideEffectTools",
    ] as const
  ).forEach((field) => {
    const patterns = snapshot.toolPolicy[field];
    if (
      patterns !== undefined &&
      (!Array.isArray(patterns) ||
        patterns.some(
          (pattern) => typeof pattern !== "string" || !pattern.trim(),
        ))
    ) {
      throw new Error(`Snapshot tool policy field "${field}" is invalid.`);
    }
  });
  if (
    snapshot.toolPolicy.defaultSideEffectMode !== undefined &&
    snapshot.toolPolicy.defaultSideEffectMode !== "allow" &&
    snapshot.toolPolicy.defaultSideEffectMode !== "deny" &&
    snapshot.toolPolicy.defaultSideEffectMode !== "require-approval"
  ) {
    throw new Error("Snapshot side-effect policy mode is invalid.");
  }
  if (typeof snapshot.exposeSessionToAgents !== "boolean") {
    throw new Error("Snapshot agent exposure flag is invalid.");
  }
  if (typeof snapshot.frozen !== "boolean") {
    throw new Error("Snapshot frozen state is invalid.");
  }
  if (!Array.isArray(snapshot.stages) || !snapshot.stages.length) {
    throw new Error("A session snapshot must contain an authoritative source.");
  }
  const ids = new Set<string>();
  snapshot.stages.forEach((stage) => {
    if (!stage || typeof stage !== "object") {
      throw new Error("Snapshot contains an invalid stage.");
    }
    cleanText(stage.id, "Snapshot stage id");
    cleanText(stage.label, "Snapshot stage label");
    cleanText(stage.text, "Snapshot stage text");
    if (ids.has(stage.id)) {
      throw new Error(`Snapshot stage id "${stage.id}" is duplicated.`);
    }
    ids.add(stage.id);
  });
  if (snapshot.frozen && snapshot.recoveryTransitionIndex === null) {
    throw new Error("A frozen snapshot must identify its recovery transition.");
  }
  if (
    snapshot.recoveryTransitionIndex !== null &&
    (!Number.isInteger(snapshot.recoveryTransitionIndex) ||
      snapshot.recoveryTransitionIndex < 0 ||
      snapshot.recoveryTransitionIndex >= snapshot.stages.length - 1)
  ) {
    throw new Error("Snapshot recovery transition is out of bounds.");
  }
  if (!snapshot.frozen && snapshot.recoveryTransitionIndex !== null) {
    throw new Error("A runnable snapshot cannot contain a recovery transition.");
  }
  if (
    !Number.isInteger(snapshot.eventSequence) ||
    snapshot.eventSequence < 0
  ) {
    throw new Error("Snapshot event sequence must be a non-negative integer.");
  }
  if (!Array.isArray(snapshot.ruleIds)) {
    throw new Error("Snapshot custom rule ids must be an array.");
  }
  const snapshotRuleIds = new Set(snapshot.ruleIds);
  if (
    snapshotRuleIds.size !== snapshot.ruleIds.length ||
    snapshot.ruleIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new Error("Snapshot contains invalid custom rule ids.");
  }
  if (!Array.isArray(snapshot.consumedApprovalTokenFingerprints)) {
    throw new Error("Snapshot approval fingerprints must be an array.");
  }
  if (
    snapshot.consumedApprovalTokenFingerprints.some(
      (fingerprint) => !/^[a-f0-9]{64}$/i.test(fingerprint),
    )
  ) {
    throw new Error("Snapshot contains an invalid approval fingerprint.");
  }
  if (!Array.isArray(snapshot.toolExecutions)) {
    throw new Error("Snapshot tool executions must be an array.");
  }
  const executionKeys = new Set<string>();
  snapshot.toolExecutions.forEach((record) => {
    if (!record || typeof record !== "object") {
      throw new Error("Snapshot contains an invalid tool execution record.");
    }
    cleanText(record.idempotencyKey, "Snapshot tool idempotency key");
    if (executionKeys.has(record.idempotencyKey)) {
      throw new Error("Snapshot contains duplicate tool idempotency keys.");
    }
    executionKeys.add(record.idempotencyKey);
    if (!/^[a-f0-9]{64}$/i.test(record.operationFingerprint)) {
      throw new Error("Snapshot contains an invalid operation fingerprint.");
    }
    if (
      record.status !== "pending" &&
      record.status !== "completed" &&
      record.status !== "failed"
    ) {
      throw new Error("Snapshot contains an invalid tool execution status.");
    }
  });
  if (!Array.isArray(snapshot.handoffRequests)) {
    throw new Error("Snapshot handoff requests must be an array.");
  }
  const handoffKeys = new Set<string>();
  snapshot.handoffRequests.forEach((record) => {
    if (
      !record ||
      typeof record !== "object" ||
      !record.decision ||
      (record.decision.status !== "allowed" &&
        record.decision.status !== "blocked") ||
      typeof record.decision.output !== "string" ||
      typeof record.decision.reason !== "string"
    ) {
      throw new Error("Snapshot contains an invalid handoff idempotency record.");
    }
    cleanText(record.idempotencyKey, "Snapshot handoff idempotency key");
    if (handoffKeys.has(record.idempotencyKey)) {
      throw new Error("Snapshot contains duplicate handoff idempotency keys.");
    }
    handoffKeys.add(record.idempotencyKey);
    if (
      !/^[a-f0-9]{64}$/i.test(record.requestFingerprint) ||
      !ids.has(record.stageId)
    ) {
      throw new Error("Snapshot contains an invalid handoff idempotency record.");
    }
  });
}

export class LineageGuardBlockedError<TInput = unknown> extends Error {
  readonly decision: ToolDecision<TInput>;

  constructor(decision: ToolDecision<TInput>) {
    super(`LineageGuard ${decision.status}: ${decision.reason}`);
    this.name = "LineageGuardBlockedError";
    this.decision = decision;
  }
}

export class LineageGuardDuplicateExecutionError extends Error {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string, message: string) {
    super(message);
    this.name = "LineageGuardDuplicateExecutionError";
    this.idempotencyKey = idempotencyKey;
  }
}

/**
 * Serial runtime supervisor for an agent loop.
 *
 * The host owns the tool implementations, approval verifier, and snapshot
 * store. Agents should receive `getToolClient()` rather than direct access to
 * tool implementations.
 */
export class LineageGuardSession {
  readonly sessionId: string;
  readonly runName: string;
  private readonly guardrail: string;
  private readonly blockAtOrAbove: Severity;
  private readonly toolPolicy: ToolPolicy;
  private readonly rules: readonly CustomLineageRule[];
  private readonly approvalVerifier?: ToolApprovalVerifier;
  private readonly exposeSessionToAgents: boolean;
  private readonly onEvent?: (event: RuntimeEvent) => void;
  private readonly onEventError?: (
    error: unknown,
    event: RuntimeEvent,
  ) => void;
  private readonly eventSinkFailureMode: "ignore" | "throw";
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly consumedApprovalTokenFingerprints = new Set<string>();
  private readonly toolExecutions = new Map<string, ToolExecutionRecord>();
  private readonly handoffRequests = new Map<string, HandoffRequestRecord>();
  private stages: TraceStage[] = [];
  private frozen = false;
  private latestReport: ReliabilityPipelineRun | null = null;
  private eventSequence = 0;

  constructor(options: LineageGuardSessionOptions = {}) {
    this.sessionId = options.sessionId?.trim() || createSessionId();
    this.runName = options.runName?.trim() || "Agent run";
    this.guardrail = options.guardrail?.trim() || "";
    this.blockAtOrAbove = normalizeBlockingThreshold(options.blockAtOrAbove);
    this.toolPolicy = cloneToolPolicy(options.toolPolicy ?? {});
    this.rules = normalizeRules(options.rules);
    this.approvalVerifier = options.approvalVerifier;
    if (
      options.exposeSessionToAgents !== undefined &&
      typeof options.exposeSessionToAgents !== "boolean"
    ) {
      throw new Error("Agent session exposure must be a boolean.");
    }
    this.exposeSessionToAgents = options.exposeSessionToAgents ?? false;
    this.onEvent = options.onEvent;
    this.onEventError = options.onEventError;
    this.eventSinkFailureMode = options.eventSinkFailureMode ?? "ignore";
    if (options.tools !== undefined && !Array.isArray(options.tools)) {
      throw new Error("Registered tools must be an array.");
    }
    options.tools?.forEach((tool) => this.registerTool(tool));
  }

  recordSource(label: string, text: string, id = "source") {
    if (this.stages.length) {
      throw new Error("The source must be recorded before any agent runs.");
    }
    this.stages.push(this.makeStage(id, label, text));
    this.latestReport = this.runPipeline(this.stages, null);
    this.emit(
      "source-recorded",
      `Authoritative source recorded as ${label.trim()}.`,
      id,
      this.latestReport.id,
    );
    return this;
  }

  inspectHandoff(
    agentId: string,
    agentName: string,
    output: string,
    options: HandoffOptions = {},
  ) {
    const idempotencyKey = cleanOptionalText(
      options.idempotencyKey,
      "Handoff idempotency key",
    );
    const requestFingerprint = fingerprintValue({
      agentId: agentId.trim(),
      agentName: agentName.trim(),
      output,
    });
    if (idempotencyKey) {
      const existing = this.handoffRequests.get(idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new LineageGuardDuplicateExecutionError(
            idempotencyKey,
            "The handoff idempotency key was reused with different input.",
          );
        }
        return existing.decision;
      }
    }

    this.assertRunnable();
    const candidate = this.makeStage(
      this.uniqueStageId(agentId),
      agentName,
      output,
    );
    const candidateStages = [...this.stages, candidate];
    const initialReport = this.runPipeline(candidateStages);
    const currentTransition = initialReport.analysis.transitions.at(-1);
    const shouldBlock =
      currentTransition !== undefined &&
      severityRank[currentTransition.severity] >=
        severityRank[this.blockAtOrAbove];
    const report = this.runPipeline(
      candidateStages,
      shouldBlock ? candidateStages.length - 2 : null,
    );

    this.stages = candidateStages;
    this.latestReport = report;

    const decision: HandoffDecision = shouldBlock
      ? {
          status: "blocked",
          output: candidate.text,
          reason: `${currentTransition.issueCount} reliability signal${
            currentTransition.issueCount === 1 ? "" : "s"
          } reached the ${this.blockAtOrAbove} blocking threshold.`,
          report,
        }
      : {
          status: "allowed",
          output: candidate.text,
          reason:
            currentTransition?.severity === "low"
              ? "Only low-severity review signals were found; the configured threshold allows this handoff."
              : "No blocking reliability signal was found.",
          report,
        };

    if (shouldBlock) this.frozen = true;
    if (idempotencyKey) {
      this.handoffRequests.set(idempotencyKey, {
        idempotencyKey,
        requestFingerprint,
        stageId: candidate.id,
        decision,
      });
    }
    this.emit(
      shouldBlock ? "handoff-blocked" : "handoff-allowed",
      decision.reason,
      candidate.id,
      report.id,
    );
    return decision;
  }

  async runAgent<TContext>(
    agent: GuardedAgent<TContext>,
    context: TContext,
  ): Promise<HandoffDecision> {
    this.assertRunnable();
    const input = this.lastStage().text;
    this.emit("agent-started", `${agent.name} started.`, agent.id);
    try {
      const output = await agent.execute({
        input,
        context,
        guard: this.exposeSessionToAgents ? this : undefined,
        tools: this.getToolClient(),
      });
      return this.inspectHandoff(agent.id, agent.name, output);
    } catch (error) {
      this.emit(
        "agent-failed",
        error instanceof Error ? error.message : `${agent.name} failed.`,
        agent.id,
      );
      throw error;
    }
  }

  async runSequence<TContext>(
    agents: GuardedAgent<TContext>[],
    context: TContext,
  ): Promise<GuardedSequenceResult> {
    if (!agents.length) {
      throw new Error("runSequence requires at least one agent.");
    }
    for (const agent of agents) {
      const decision = await this.runAgent(agent, context);
      if (decision.status === "blocked") {
        return {
          status: "blocked",
          blockedAgentId: agent.id,
          report: decision.report,
        };
      }
    }
    const report = this.getReport();
    this.emit(
      "run-completed",
      `${agents.length} agents completed without a blocking handoff.`,
      undefined,
      report.id,
    );
    return {
      status: "completed",
      blockedAgentId: null,
      report,
    };
  }

  registerTool<TInput, TResult>(
    tool: RegisteredTool<TInput, TResult>,
  ) {
    if (
      !tool ||
      typeof tool !== "object" ||
      typeof tool.execute !== "function" ||
      typeof tool.sideEffect !== "boolean"
    ) {
      throw new Error(
        "A registered tool needs an execute function and explicit sideEffect boolean.",
      );
    }
    const name = cleanText(tool.name, "Registered tool name");
    const action = cleanText(tool.action, "Registered tool action");
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, { ...tool, name, action } as RegisteredTool);
    return this;
  }

  getToolClient(): GuardedToolClient {
    return Object.freeze({
      execute: <TInput, TResult>(
        toolName: string,
        input: TInput,
        options?: RegisteredToolExecutionOptions,
      ) =>
        this.executeRegisteredTool<TInput, TResult>(
          toolName,
          input,
          options,
        ),
    });
  }

  async executeRegisteredTool<TInput, TResult>(
    toolName: string,
    input: TInput,
    options: RegisteredToolExecutionOptions = {},
  ): Promise<TResult> {
    const name = cleanText(toolName, "Registered tool name");
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered with this session.`);
    }
    return this.executeTool(
      {
        toolName: tool.name,
        action: tool.action,
        input,
        sideEffect: tool.sideEffect,
        approval: options.approval,
        idempotencyKey: options.idempotencyKey,
      },
      tool.execute as (toolInput: TInput) => TResult | Promise<TResult>,
    );
  }

  authorizeTool<TInput>(intent: ToolIntent<TInput>): ToolDecision<TInput> {
    const toolName = cleanText(intent.toolName, "Tool name");
    const action = cleanText(intent.action, "Tool action");
    const inputFingerprint = fingerprintValue(intent.input);
    const normalizedIntent: ToolIntent<TInput> = {
      ...intent,
      toolName,
      action,
      idempotencyKey: cleanOptionalText(
        intent.idempotencyKey,
        "Tool idempotency key",
      ),
      sideEffect:
        intent.sideEffect ||
        matchesTool(toolName, this.toolPolicy.sideEffectTools),
    };

    if (!this.stages.length) {
      return this.toolDecision(
        "blocked",
        "Record an authoritative source before using tools.",
        normalizedIntent,
        inputFingerprint,
      );
    }
    if (this.frozen) {
      return this.toolDecision(
        "blocked",
        "The run is frozen after a failed handoff. Recover before using tools.",
        normalizedIntent,
        inputFingerprint,
      );
    }
    if (matchesTool(toolName, this.toolPolicy.deniedTools)) {
      return this.toolDecision(
        "blocked",
        `${toolName} is explicitly denied by the runtime tool policy.`,
        normalizedIntent,
        inputFingerprint,
      );
    }

    const explicitlyAllowed = matchesTool(
      toolName,
      this.toolPolicy.allowedTools,
    );
    const requiresApproval =
      matchesTool(toolName, this.toolPolicy.approvalRequiredTools) ||
      (normalizedIntent.sideEffect &&
        !explicitlyAllowed &&
        (this.toolPolicy.defaultSideEffectMode ?? "require-approval") ===
          "require-approval");

    if (
      normalizedIntent.sideEffect &&
      !explicitlyAllowed &&
      (this.toolPolicy.defaultSideEffectMode ?? "require-approval") === "deny"
    ) {
      return this.toolDecision(
        "blocked",
        `${toolName} is a side-effecting tool and the default policy is deny.`,
        normalizedIntent,
        inputFingerprint,
      );
    }

    let approvalVerified = false;
    if (requiresApproval) {
      const approval = normalizedIntent.approval;
      if (!approval?.token.trim() || !approval.approvedBy.trim()) {
        return this.toolDecision(
          "approval-required",
          `${toolName} needs a scoped approval token from an authenticated reviewer.`,
          normalizedIntent,
          inputFingerprint,
          true,
        );
      }
      const tokenFingerprint = sha256Hex(approval.token);
      if (this.consumedApprovalTokenFingerprints.has(tokenFingerprint)) {
        return this.toolDecision(
          "blocked",
          "This approval token has already been consumed.",
          normalizedIntent,
          inputFingerprint,
          true,
        );
      }
      if (!this.approvalVerifier) {
        return this.toolDecision(
          "approval-required",
          "No approval verifier is configured for this session.",
          normalizedIntent,
          inputFingerprint,
          true,
        );
      }
      try {
        approvalVerified =
          this.approvalVerifier({
            sessionId: this.sessionId,
            runId: this.getReport().id,
            toolName,
            action,
            inputFingerprint,
            approval,
          }) === true;
      } catch {
        return this.toolDecision(
          "blocked",
          "The approval verifier failed closed.",
          normalizedIntent,
          inputFingerprint,
          true,
        );
      }
      if (!approvalVerified) {
        return this.toolDecision(
          "approval-required",
          "The supplied approval is invalid or does not match this action.",
          normalizedIntent,
          inputFingerprint,
          true,
        );
      }
    }

    return this.toolDecision(
      "allowed",
      approvalVerified
        ? `Scoped approval verified for ${normalizedIntent.approval?.approvedBy}.`
        : normalizedIntent.sideEffect
          ? `${toolName} is explicitly allowed by host policy.`
          : `${toolName} is read-only.`,
      normalizedIntent,
      inputFingerprint,
      requiresApproval,
      approvalVerified,
    );
  }

  async executeTool<TInput, TResult>(
    intent: ToolIntent<TInput>,
    execute: (input: TInput) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const idempotencyKey = cleanOptionalText(
      intent.idempotencyKey,
      "Tool idempotency key",
    );
    const operationFingerprint = fingerprintValue({
      toolName: intent.toolName.trim().toLowerCase(),
      action: intent.action.trim(),
      input: intent.input,
    });
    if (idempotencyKey) {
      const existing = this.toolExecutions.get(idempotencyKey);
      if (existing) {
        if (existing.operationFingerprint !== operationFingerprint) {
          throw new LineageGuardDuplicateExecutionError(
            idempotencyKey,
            "The tool idempotency key was reused for a different operation.",
          );
        }
        if (existing.promise) {
          return existing.promise as Promise<TResult>;
        }
        if (existing.status === "completed" && existing.hasResult) {
          return existing.result as TResult;
        }
        if (existing.status === "failed" && existing.error !== undefined) {
          throw existing.error;
        }
        throw new LineageGuardDuplicateExecutionError(
          idempotencyKey,
          "This operation was already recorded; its prior result is not available after restoration.",
        );
      }
    }

    const decision = this.authorizeTool(intent);
    if (decision.status !== "allowed") {
      throw new LineageGuardBlockedError(decision);
    }
    if (decision.requiresApproval && decision.intent.approval) {
      this.consumedApprovalTokenFingerprints.add(
        sha256Hex(decision.intent.approval.token),
      );
    }

    const executionPromise = Promise.resolve().then(() =>
      execute(decision.intent.input as TInput),
    );
    const record: ToolExecutionRecord | undefined = idempotencyKey
      ? {
          idempotencyKey,
          operationFingerprint,
          status: "pending",
          promise: executionPromise,
        }
      : undefined;
    if (record) this.toolExecutions.set(idempotencyKey!, record);

    try {
      const result = await executionPromise;
      if (record) {
        record.status = "completed";
        record.promise = undefined;
        record.result = result;
        record.hasResult = true;
      }
      return result;
    } catch (error) {
      if (record) {
        record.status = "failed";
        record.promise = undefined;
        record.error = error;
      }
      throw error;
    }
  }

  resetToLastVerified() {
    if (!this.latestReport || !this.frozen) {
      throw new Error("There is no blocked handoff to recover.");
    }
    const restartStageIndex = this.latestReport.recovery.restartStageIndex;
    if (restartStageIndex === null) {
      throw new Error("The current run has no blocking transition.");
    }
    const failedTransition = restartStageIndex - 1;
    this.stages = this.stages.slice(0, failedTransition + 1);
    const retainedIds = new Set(this.stages.map((stage) => stage.id));
    for (const [key, request] of this.handoffRequests) {
      if (!retainedIds.has(request.stageId)) this.handoffRequests.delete(key);
    }
    this.frozen = false;
    this.latestReport = this.runPipeline(this.stages, null);
    const checkpoint = this.lastStage();
    this.emit(
      "recovery-applied",
      `Restored ${checkpoint.label}; retry can begin from the failed handoff.`,
      checkpoint.id,
      this.latestReport.id,
    );
    return { ...checkpoint };
  }

  toSnapshot(): LineageGuardSessionSnapshot {
    const recoveryTransitionIndex = this.frozen
      ? this.getReport().recovery.restartStageIndex === null
        ? null
        : this.getReport().recovery.restartStageIndex! - 1
      : null;
    return {
      schemaVersion: "1.0",
      sessionId: this.sessionId,
      runName: this.runName,
      guardrail: this.guardrail,
      blockAtOrAbove: this.blockAtOrAbove,
      toolPolicy: cloneToolPolicy(this.toolPolicy),
      exposeSessionToAgents: this.exposeSessionToAgents,
      ruleIds: this.rules.map((rule) => rule.id.trim()),
      stages: this.getTrace(),
      frozen: this.frozen,
      recoveryTransitionIndex,
      consumedApprovalTokenFingerprints: [
        ...this.consumedApprovalTokenFingerprints,
      ],
      toolExecutions: [...this.toolExecutions.values()].map(
        ({
          idempotencyKey,
          operationFingerprint,
          status,
        }): PersistedToolExecution => ({
          idempotencyKey,
          operationFingerprint,
          status,
        }),
      ),
      handoffRequests: [...this.handoffRequests.values()].map((request) => ({
        ...request,
      })),
      eventSequence: this.eventSequence,
    };
  }

  async checkpoint(store: LineageGuardSnapshotStore) {
    const snapshot = this.toSnapshot();
    await store.save(snapshot);
    return snapshot;
  }

  static restore(
    snapshot: LineageGuardSessionSnapshot,
    options: LineageGuardRestoreOptions = {},
  ) {
    validateSnapshot(snapshot);
    const restoredRules = normalizeRules(options.rules);
    const expectedRuleIds = [...snapshot.ruleIds].sort();
    const restoredRuleIds = restoredRules
      .map((rule) => rule.id.trim())
      .sort();
    if (
      expectedRuleIds.length !== restoredRuleIds.length ||
      expectedRuleIds.some((id, index) => id !== restoredRuleIds[index])
    ) {
      throw new Error(
        "Restore requires the same custom rule ids as the snapshot.",
      );
    }
    const session = new LineageGuardSession({
      sessionId: snapshot.sessionId,
      runName: snapshot.runName,
      guardrail: snapshot.guardrail,
      blockAtOrAbove: snapshot.blockAtOrAbove,
      toolPolicy: snapshot.toolPolicy,
      exposeSessionToAgents: snapshot.exposeSessionToAgents,
      ...options,
      rules: restoredRules,
    });
    session.stages = snapshot.stages.map((stage) => ({ ...stage }));
    session.frozen = snapshot.frozen;
    session.latestReport = session.runPipeline(
      session.stages,
      snapshot.frozen ? snapshot.recoveryTransitionIndex : null,
    );
    snapshot.consumedApprovalTokenFingerprints.forEach((fingerprint) =>
      session.consumedApprovalTokenFingerprints.add(fingerprint),
    );
    snapshot.toolExecutions.forEach((record) =>
      session.toolExecutions.set(record.idempotencyKey, { ...record }),
    );
    snapshot.handoffRequests.forEach((record) =>
      session.handoffRequests.set(record.idempotencyKey, { ...record }),
    );
    session.eventSequence = snapshot.eventSequence;
    return session;
  }

  static async resume(
    store: LineageGuardSnapshotStore,
    sessionId: string,
    options: LineageGuardRestoreOptions = {},
  ) {
    const snapshot = await store.load(cleanText(sessionId, "Session id"));
    if (!snapshot) {
      throw new Error(`No LineageGuard snapshot exists for "${sessionId}".`);
    }
    return LineageGuardSession.restore(snapshot, options);
  }

  getReport() {
    if (!this.latestReport) {
      throw new Error("Record a source before requesting a report.");
    }
    return this.latestReport;
  }

  getRecoveryPacket(): RecoveryPacket {
    return this.getReport().recovery;
  }

  getTrace() {
    return this.stages.map((stage) => ({ ...stage }));
  }

  isFrozen() {
    return this.frozen;
  }

  private runPipeline(
    stages: TraceStage[],
    recoveryTransitionIndex?: number | null,
  ) {
    return runReliabilityPipeline(stages, this.guardrail, {
      recoveryTransitionIndex,
      rules: this.rules,
    });
  }

  private toolDecision<TInput>(
    status: ToolDecision<TInput>["status"],
    reason: string,
    intent: ToolIntent<TInput>,
    inputFingerprint: string,
    requiresApproval = false,
    approvalVerified = false,
  ): ToolDecision<TInput> {
    const decision = {
      status,
      reason,
      intent,
      inputFingerprint,
      requiresApproval,
      approvalVerified,
    };
    this.emit(
      status === "allowed" ? "tool-allowed" : "tool-blocked",
      `${intent.toolName}: ${reason}`,
    );
    return decision;
  }

  private assertRunnable() {
    if (!this.stages.length) {
      throw new Error("Record a source before running an agent.");
    }
    if (this.frozen) {
      throw new Error(
        "This run is frozen. Call resetToLastVerified() before retrying.",
      );
    }
  }

  private lastStage() {
    const stage = this.stages.at(-1);
    if (!stage) throw new Error("Record a source before running an agent.");
    return stage;
  }

  private makeStage(id: string, label: string, text: string): TraceStage {
    const stage = {
      id: cleanText(id, "Stage id"),
      label: cleanText(label, "Stage label"),
      text: cleanText(text, "Stage text"),
    };
    if (this.stages.some((existing) => existing.id === stage.id)) {
      throw new Error(`Stage id "${stage.id}" is already in this run.`);
    }
    return stage;
  }

  private uniqueStageId(requestedId: string) {
    const base = cleanText(requestedId, "Stage id");
    if (!this.stages.some((stage) => stage.id === base)) return base;
    let attempt = 2;
    while (this.stages.some((stage) => stage.id === `${base}-${attempt}`)) {
      attempt += 1;
    }
    return `${base}-${attempt}`;
  }

  private emit(
    type: RuntimeEventType,
    message: string,
    agentId?: string,
    runId?: string,
  ) {
    this.eventSequence += 1;
    const event: RuntimeEvent = {
      type,
      timestamp: new Date().toISOString(),
      sequence: this.eventSequence,
      sessionId: this.sessionId,
      message,
      agentId,
      runId,
    };
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch (error) {
      try {
        this.onEventError?.(error, event);
      } catch {
        // The primary event failure remains the relevant error.
      }
      if (this.eventSinkFailureMode === "throw") throw error;
    }
  }
}
