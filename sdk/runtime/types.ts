import type {
  CustomLineageRule,
  Severity,
  TraceStage,
} from "../../lib/analysis.ts";
import type { ReliabilityPipelineRun } from "../../lib/pipeline.ts";
import type { LineageGuardSession } from "./session.ts";

export type RuntimeEventType =
  | "source-recorded"
  | "agent-started"
  | "handoff-allowed"
  | "handoff-blocked"
  | "tool-allowed"
  | "tool-blocked"
  | "recovery-applied"
  | "run-completed"
  | "agent-failed"
  | "semantic-judge-failed";

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
) => boolean | Promise<boolean>;

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

export type SemanticJudgeFinding = {
  severity: Severity;
  title: string;
  explanation: string;
};

export type SemanticJudgeContext = {
  sessionId: string;
  runName: string;
  guardrail: string;
  transitionIndex: number;
  from: TraceStage;
  proposedOutput: string;
  agentId: string;
  agentName: string;
  /**
   * Aborted when `semanticJudgeTimeoutMs` elapses. Pass it to the underlying
   * model call so a timed-out judge stops consuming resources.
   */
  signal: AbortSignal;
};

/**
 * Optional asynchronous reviewer for a proposed handoff — typically an LLM
 * call — that runs before the deterministic gate. Findings it returns are
 * merged into the reliability report as inspectable meaning-family issues.
 * Judge findings apply through `inspectHandoffAsync`, `runAgent`, and
 * `runSequence`; the synchronous `inspectHandoff` path stays
 * deterministic-only.
 */
export type SemanticJudge = (
  context: Readonly<SemanticJudgeContext>,
) =>
  | SemanticJudgeFinding[]
  | null
  | Promise<SemanticJudgeFinding[] | null>;

export type AnalysisMode = "deterministic" | "hybrid" | "semantic";

export const SEMANTIC_JUDGE_RULE_ID = "lineageguard:semantic-judge";

export type LineageGuardSessionOptions = {
  sessionId?: string;
  runName?: string;
  guardrail?: string;
  blockAtOrAbove?: Severity;
  toolPolicy?: ToolPolicy;
  rules?: readonly CustomLineageRule[];
  approvalVerifier?: ToolApprovalVerifier;
  semanticJudge?: SemanticJudge;
  /**
   * deterministic: built-in lexical rules only.
   * hybrid: built-in rules plus the semantic judge.
   * semantic: semantic judge only; synchronous handoff inspection is disabled.
   */
  analysisMode?: AnalysisMode;
  /**
   * What happens when the semantic judge itself throws or rejects.
   * "block" (default) records a high-severity finding so the handoff fails
   * closed; "warn" records a low-severity finding and lets the deterministic
   * gate decide alone.
   */
  semanticJudgeFailureMode?: "block" | "warn";
  /**
   * Milliseconds the semantic judge may take before it is treated as failed
   * under `semanticJudgeFailureMode`. Defaults to 30 000. The judge receives
   * an `AbortSignal` that is aborted when the timeout elapses.
   */
  semanticJudgeTimeoutMs?: number;
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
  /** Absent in snapshots created before analysis modes were introduced. */
  analysisMode?: AnalysisMode;
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
  /** Accepted semantic-judge findings, keyed by transition index. */
  semanticFindings?: Array<{
    transitionIndex: number;
    findings: SemanticJudgeFinding[];
  }>;
};

export type LineageGuardSnapshotStore = {
  load(sessionId: string): Promise<LineageGuardSessionSnapshot | null>;
  save(snapshot: LineageGuardSessionSnapshot): Promise<void>;
};

export type LineageGuardRestoreOptions = Pick<
  LineageGuardSessionOptions,
  | "rules"
  | "approvalVerifier"
  | "semanticJudge"
  | "semanticJudgeFailureMode"
  | "semanticJudgeTimeoutMs"
  | "tools"
  | "onEvent"
  | "onEventError"
  | "eventSinkFailureMode"
>;

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
