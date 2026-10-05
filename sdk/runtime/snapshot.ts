import type {
  CustomLineageRule,
  Severity,
  TraceStage,
} from "../../lib/analysis.ts";
import { fingerprintValue } from "../../lib/fingerprint.ts";
import { TRACE_LIMITS, TracePayloadError } from "../../lib/trace-schema.ts";
import {
  LineageGuardDuplicateExecutionError,
  SEMANTIC_JUDGE_RULE_ID,
  type AnalysisMode,
  type HandoffDecision,
  type LineageGuardSessionOptions,
  type LineageGuardSessionSnapshot,
  type PersistedHandoffRequest,
  type PersistedToolExecution,
  type RegisteredTool,
  type RuntimeEvent,
  type SemanticJudge,
  type SemanticJudgeFinding,
  type ToolApprovalVerifier,
  type ToolPolicy,
} from "./types.ts";

const DEFAULT_SEMANTIC_JUDGE_TIMEOUT_MS = 30_000;

let sessionCounter = 0;

export function createSessionId() {
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

export function cleanText(value: string, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field} must be a non-empty string.`);
  return cleaned;
}

export function cleanOptionalText(value: string | undefined, field: string) {
  return value === undefined ? undefined : cleanText(value, field);
}

export function cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
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

export function normalizeBlockingThreshold(
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

export function normalizeRules(
  rules: readonly CustomLineageRule[] = [],
): CustomLineageRule[] {
  if (!Array.isArray(rules)) {
    throw new Error("Custom rules must be an array.");
  }
  const normalized: CustomLineageRule[] = [...rules];
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

export function validateSemanticFinding(
  finding: SemanticJudgeFinding,
): SemanticJudgeFinding {
  if (
    !finding ||
    typeof finding !== "object" ||
    (finding.severity !== "low" &&
      finding.severity !== "medium" &&
      finding.severity !== "high") ||
    typeof finding.title !== "string" ||
    !finding.title.trim() ||
    typeof finding.explanation !== "string" ||
    !finding.explanation.trim()
  ) {
    throw new Error(
      "A semantic judge finding needs a low/medium/high severity, a title, and an explanation.",
    );
  }
  return {
    severity: finding.severity,
    title: finding.title.trim(),
    explanation: finding.explanation.trim(),
  };
}

/** Validated session configuration derived from the constructor options. */
export type SessionConfig = {
  sessionId: string;
  runName: string;
  guardrail: string;
  blockAtOrAbove: Severity;
  toolPolicy: ToolPolicy;
  rules: readonly CustomLineageRule[];
  approvalVerifier?: ToolApprovalVerifier;
  semanticJudge?: SemanticJudge;
  analysisMode: AnalysisMode;
  semanticJudgeFailureMode: "block" | "warn";
  semanticJudgeTimeoutMs: number;
  exposeSessionToAgents: boolean;
  onEvent?: (event: RuntimeEvent) => void;
  onEventError?: (error: unknown, event: RuntimeEvent) => void;
  eventSinkFailureMode: "ignore" | "throw";
  tools: readonly RegisteredTool[];
};

export function normalizeSessionOptions(
  options: LineageGuardSessionOptions,
): SessionConfig {
  const sessionId = options.sessionId?.trim() || createSessionId();
  const runName = options.runName?.trim() || "Agent run";
  const guardrail = options.guardrail?.trim() || "";
  // Host inputs that are persisted verbatim must satisfy the trace contract,
  // or the snapshot could never round-trip through parseTracePayload.
  if (runName.length > TRACE_LIMITS.runNameCharacters) {
    throw new TracePayloadError(
      `Run name must be at most ${TRACE_LIMITS.runNameCharacters} characters.`,
    );
  }
  if (guardrail.length > TRACE_LIMITS.guardrailCharacters) {
    throw new TracePayloadError(
      `Guardrail must be at most ${TRACE_LIMITS.guardrailCharacters} characters.`,
    );
  }
  const blockAtOrAbove = normalizeBlockingThreshold(options.blockAtOrAbove);
  const toolPolicy = cloneToolPolicy(options.toolPolicy ?? {});
  const rules = normalizeRules(options.rules);
  if (rules.some((rule) => rule.id.trim() === SEMANTIC_JUDGE_RULE_ID)) {
    throw new Error(
      `The rule id "${SEMANTIC_JUDGE_RULE_ID}" is reserved for the semantic judge.`,
    );
  }
  if (
    options.semanticJudge !== undefined &&
    typeof options.semanticJudge !== "function"
  ) {
    throw new Error("The semantic judge must be a function.");
  }
  const semanticJudge = options.semanticJudge;
  if (
    options.analysisMode !== undefined &&
    options.analysisMode !== "deterministic" &&
    options.analysisMode !== "hybrid" &&
    options.analysisMode !== "semantic"
  ) {
    throw new Error(
      "Analysis mode must be deterministic, hybrid, or semantic.",
    );
  }
  const analysisMode =
    options.analysisMode ?? (semanticJudge ? "hybrid" : "deterministic");
  if (analysisMode !== "deterministic" && !semanticJudge) {
    throw new Error(`${analysisMode} analysis mode requires a semanticJudge.`);
  }
  if (
    options.semanticJudgeFailureMode !== undefined &&
    options.semanticJudgeFailureMode !== "block" &&
    options.semanticJudgeFailureMode !== "warn"
  ) {
    throw new Error("Semantic judge failure mode must be block or warn.");
  }
  if (
    options.semanticJudgeTimeoutMs !== undefined &&
    (typeof options.semanticJudgeTimeoutMs !== "number" ||
      !Number.isFinite(options.semanticJudgeTimeoutMs) ||
      options.semanticJudgeTimeoutMs <= 0)
  ) {
    throw new Error(
      "Semantic judge timeout must be a positive number of milliseconds.",
    );
  }
  if (
    options.exposeSessionToAgents !== undefined &&
    typeof options.exposeSessionToAgents !== "boolean"
  ) {
    throw new Error("Agent session exposure must be a boolean.");
  }
  if (options.tools !== undefined && !Array.isArray(options.tools)) {
    throw new Error("Registered tools must be an array.");
  }
  return {
    sessionId,
    runName,
    guardrail,
    blockAtOrAbove,
    toolPolicy,
    rules,
    approvalVerifier: options.approvalVerifier,
    semanticJudge,
    analysisMode,
    semanticJudgeFailureMode: options.semanticJudgeFailureMode ?? "block",
    semanticJudgeTimeoutMs:
      options.semanticJudgeTimeoutMs ?? DEFAULT_SEMANTIC_JUDGE_TIMEOUT_MS,
    exposeSessionToAgents: options.exposeSessionToAgents ?? false,
    onEvent: options.onEvent,
    onEventError: options.onEventError,
    eventSinkFailureMode: options.eventSinkFailureMode ?? "ignore",
    tools: options.tools ?? [],
  };
}

/**
 * The reason a cleaned stage cannot join `stages` under `TRACE_LIMITS`, or
 * null. Every snapshot must round-trip through `parseTracePayload`, so the
 * session applies the same bounds as the JSON contract.
 */
export function stageLimitViolation(
  stages: readonly TraceStage[],
  guardrail: string,
  id: string,
  label: string,
  text: string,
) {
  if (stages.length + 1 > TRACE_LIMITS.stages) {
    return `A trace can contain at most ${TRACE_LIMITS.stages} stages; this handoff would be stage ${stages.length + 1}.`;
  }
  if (id.length > TRACE_LIMITS.identifierCharacters) {
    return `Stage id must be at most ${TRACE_LIMITS.identifierCharacters} characters.`;
  }
  if (label.length > TRACE_LIMITS.labelCharacters) {
    return `Stage label must be at most ${TRACE_LIMITS.labelCharacters} characters.`;
  }
  if (text.length > TRACE_LIMITS.stageTextCharacters) {
    return `Stage text must be at most ${TRACE_LIMITS.stageTextCharacters} characters; this output has ${text.length}.`;
  }
  const totalTextCharacters =
    guardrail.length +
    stages.reduce((total, stage) => total + stage.text.length, 0) +
    text.length;
  if (totalTextCharacters > TRACE_LIMITS.totalTextCharacters) {
    return `Trace text must total at most ${TRACE_LIMITS.totalTextCharacters} characters; this handoff would bring it to ${totalTextCharacters}.`;
  }
  return null;
}

export function makeStage(
  stages: readonly TraceStage[],
  guardrail: string,
  id: string,
  label: string,
  text: string,
): TraceStage {
  const stage = {
    id: cleanText(id, "Stage id"),
    label: cleanText(label, "Stage label"),
    text: cleanText(text, "Stage text"),
  };
  if (stages.some((existing) => existing.id === stage.id)) {
    throw new Error(`Stage id "${stage.id}" is already in this run.`);
  }
  const limitViolation = stageLimitViolation(
    stages,
    guardrail,
    stage.id,
    stage.label,
    stage.text,
  );
  if (limitViolation) throw new TracePayloadError(limitViolation);
  return stage;
}

export function uniqueStageId(
  stages: readonly TraceStage[],
  requestedId: string,
) {
  const base = cleanText(requestedId, "Stage id");
  if (!stages.some((stage) => stage.id === base)) return base;
  let attempt = 2;
  while (stages.some((stage) => stage.id === `${base}-${attempt}`)) {
    attempt += 1;
  }
  return `${base}-${attempt}`;
}

/**
 * The cleaned stage a handoff would add and the limit it breaks, or null
 * when the output fits the trace contract.
 */
export function describeStageLimitViolation(
  stages: readonly TraceStage[],
  guardrail: string,
  agentId: string,
  agentName: string,
  output: string,
) {
  const stageId = uniqueStageId(stages, agentId);
  const text = cleanText(output, "Stage text");
  const reason = stageLimitViolation(
    stages,
    guardrail,
    stageId,
    cleanText(agentName, "Stage label"),
    text,
  );
  return reason ? { stageId, text, reason } : null;
}

export function handoffRequestFingerprint(
  agentId: string,
  agentName: string,
  output: string,
) {
  return fingerprintValue({
    agentId: agentId.trim(),
    agentName: agentName.trim(),
    output,
  });
}

/**
 * The decision recorded under `idempotencyKey`, or null when the key is new.
 * A key reused with a different request fails closed.
 */
export function cachedHandoffDecision(
  requests: ReadonlyMap<string, PersistedHandoffRequest>,
  idempotencyKey: string | undefined,
  requestFingerprint: string,
): HandoffDecision | null {
  if (!idempotencyKey) return null;
  const existing = requests.get(idempotencyKey);
  if (!existing) return null;
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new LineageGuardDuplicateExecutionError(
      idempotencyKey,
      "The handoff idempotency key was reused with different input.",
    );
  }
  return structuredClone(existing.decision);
}

export type SnapshotState = {
  sessionId: string;
  runName: string;
  guardrail: string;
  blockAtOrAbove: Severity;
  analysisMode: AnalysisMode;
  toolPolicy: ToolPolicy;
  exposeSessionToAgents: boolean;
  rules: readonly CustomLineageRule[];
  stages: readonly TraceStage[];
  frozen: boolean;
  recoveryTransitionIndex: number | null;
  consumedApprovalTokenFingerprints: readonly string[];
  toolExecutions: readonly PersistedToolExecution[];
  handoffRequests: readonly PersistedHandoffRequest[];
  eventSequence: number;
  semanticFindings: ReadonlyMap<number, SemanticJudgeFinding[]>;
};

export function buildSnapshot(state: SnapshotState): LineageGuardSessionSnapshot {
  return {
    schemaVersion: "1.0",
    sessionId: state.sessionId,
    runName: state.runName,
    guardrail: state.guardrail,
    blockAtOrAbove: state.blockAtOrAbove,
    analysisMode: state.analysisMode,
    toolPolicy: cloneToolPolicy(state.toolPolicy),
    exposeSessionToAgents: state.exposeSessionToAgents,
    ruleIds: state.rules.map((rule) => rule.id.trim()),
    stages: state.stages.map((stage) => ({ ...stage })),
    frozen: state.frozen,
    recoveryTransitionIndex: state.recoveryTransitionIndex,
    consumedApprovalTokenFingerprints: [
      ...state.consumedApprovalTokenFingerprints,
    ],
    toolExecutions: state.toolExecutions.map(
      ({ idempotencyKey, operationFingerprint, status }) => ({
        idempotencyKey,
        operationFingerprint,
        status,
      }),
    ),
    handoffRequests: structuredClone([...state.handoffRequests]),
    eventSequence: state.eventSequence,
    ...(state.semanticFindings.size
      ? {
          semanticFindings: [...state.semanticFindings.entries()].map(
            ([transitionIndex, findings]) => ({
              transitionIndex,
              findings: findings.map((finding) => ({ ...finding })),
            }),
          ),
        }
      : {}),
  };
}

/** Restore requires exactly the custom rule ids the snapshot was taken with. */
export function assertRestoredRuleParity(
  snapshot: LineageGuardSessionSnapshot,
  rules: readonly CustomLineageRule[],
) {
  const expectedRuleIds = [...snapshot.ruleIds].sort();
  const restoredRuleIds = rules.map((rule) => rule.id.trim()).sort();
  if (
    expectedRuleIds.length !== restoredRuleIds.length ||
    expectedRuleIds.some((id, index) => id !== restoredRuleIds[index])
  ) {
    throw new Error(
      "Restore requires the same custom rule ids as the snapshot.",
    );
  }
}

export function validateSnapshot(snapshot: LineageGuardSessionSnapshot) {
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
    snapshot.analysisMode !== undefined &&
    snapshot.analysisMode !== "deterministic" &&
    snapshot.analysisMode !== "hybrid" &&
    snapshot.analysisMode !== "semantic"
  ) {
    throw new Error("Snapshot analysis mode is invalid.");
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
  if (snapshot.semanticFindings !== undefined) {
    if (!Array.isArray(snapshot.semanticFindings)) {
      throw new Error("Snapshot semantic findings must be an array.");
    }
    const findingIndexes = new Set<number>();
    snapshot.semanticFindings.forEach((entry) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        !Number.isInteger(entry.transitionIndex) ||
        entry.transitionIndex < 0 ||
        entry.transitionIndex >= snapshot.stages.length - 1 ||
        findingIndexes.has(entry.transitionIndex) ||
        !Array.isArray(entry.findings)
      ) {
        throw new Error("Snapshot contains invalid semantic findings.");
      }
      findingIndexes.add(entry.transitionIndex);
      entry.findings.forEach((finding) => validateSemanticFinding(finding));
    });
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
