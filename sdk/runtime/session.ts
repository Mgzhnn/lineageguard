import type {
  CustomLineageRule,
  Severity,
  TraceStage,
} from "../../lib/analysis.ts";
import {
  runReliabilityPipeline,
  type RecoveryPacket,
  type ReliabilityPipelineRun,
} from "../../lib/pipeline.ts";
import { runSemanticJudge, semanticReplayRule } from "./semantic-judge.ts";
import {
  assertRestoredRuleParity,
  buildSnapshot,
  cachedHandoffDecision,
  cleanOptionalText,
  cleanText,
  describeStageLimitViolation,
  handoffRequestFingerprint,
  makeStage,
  normalizeRules,
  normalizeSessionOptions,
  uniqueStageId,
  validateSnapshot,
} from "./snapshot.ts";
import { ToolGate } from "./tool-gate.ts";
import {
  type AnalysisMode,
  type GuardedAgent,
  type GuardedSequenceResult,
  type GuardedToolClient,
  type HandoffDecision,
  type HandoffOptions,
  type LineageGuardRestoreOptions,
  type LineageGuardSessionOptions,
  type LineageGuardSessionSnapshot,
  type LineageGuardSnapshotStore,
  type PersistedHandoffRequest,
  type RegisteredTool,
  type RegisteredToolExecutionOptions,
  type RuntimeEvent,
  type RuntimeEventType,
  type SemanticJudge,
  type SemanticJudgeFinding,
  type ToolApprovalVerifier,
  type ToolDecision,
  type ToolIntent,
  type ToolPolicy,
} from "./types.ts";

const severityRank: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

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
  private readonly analysisMode: AnalysisMode;
  private readonly toolPolicy: ToolPolicy;
  private readonly rules: readonly CustomLineageRule[];
  private readonly approvalVerifier?: ToolApprovalVerifier;
  private readonly semanticJudge?: SemanticJudge;
  private readonly semanticJudgeFailureMode: "block" | "warn";
  private readonly semanticJudgeTimeoutMs: number;
  private readonly semanticFindings = new Map<number, SemanticJudgeFinding[]>();
  private readonly exposeSessionToAgents: boolean;
  private readonly onEvent?: (event: RuntimeEvent) => void;
  private readonly onEventError?: (
    error: unknown,
    event: RuntimeEvent,
  ) => void;
  private readonly eventSinkFailureMode: "ignore" | "throw";
  private readonly toolGate: ToolGate;
  private readonly handoffRequests = new Map<string, PersistedHandoffRequest>();
  private stages: TraceStage[] = [];
  private frozen = false;
  private latestReport: ReliabilityPipelineRun | null = null;
  private eventSequence = 0;
  private revision = 0;
  private handoffInProgress = false;
  private agentInProgress = false;

  constructor(options: LineageGuardSessionOptions = {}) {
    const config = normalizeSessionOptions(options);
    this.sessionId = config.sessionId;
    this.runName = config.runName;
    this.guardrail = config.guardrail;
    this.blockAtOrAbove = config.blockAtOrAbove;
    this.toolPolicy = config.toolPolicy;
    this.rules = config.rules;
    this.approvalVerifier = config.approvalVerifier;
    this.semanticJudge = config.semanticJudge;
    this.analysisMode = config.analysisMode;
    this.semanticJudgeFailureMode = config.semanticJudgeFailureMode;
    this.semanticJudgeTimeoutMs = config.semanticJudgeTimeoutMs;
    this.exposeSessionToAgents = config.exposeSessionToAgents;
    this.onEvent = config.onEvent;
    this.onEventError = config.onEventError;
    this.eventSinkFailureMode = config.eventSinkFailureMode;
    this.toolGate = new ToolGate({
      sessionId: this.sessionId,
      toolPolicy: this.toolPolicy,
      approvalVerifier: this.approvalVerifier,
      hasSource: () => this.stages.length > 0,
      isFrozen: () => this.frozen,
      revision: () => this.revision,
      currentRunId: () => this.getReport().id,
      emit: (type, message) => this.emit(type, message),
    });
    config.tools.forEach((tool) => this.registerTool(tool));
  }

  recordSource(label: string, text: string, id = "source") {
    if (this.stages.length) {
      throw new Error("The source must be recorded before any agent runs.");
    }
    // Compute, emit, then commit: a throwing sink must not leave a half-recorded session.
    const stages = [makeStage(this.stages, this.guardrail, id, label, text)];
    const report = this.runPipeline(stages, null);
    this.emit(
      "source-recorded",
      `Authoritative source recorded as ${label.trim()}.`,
      id,
      report.id,
    );
    this.stages = stages;
    this.latestReport = report;
    this.revision += 1;
    return this;
  }

  inspectHandoff(
    agentId: string,
    agentName: string,
    output: string,
    options: HandoffOptions = {},
  ) {
    this.assertNoConcurrentHandoff();
    if (this.analysisMode !== "deterministic") {
      throw new Error(
        `${this.analysisMode} analysis mode requires inspectHandoffAsync() so the semantic judge cannot be skipped.`,
      );
    }
    this.handoffInProgress = true;
    try {
      return this.commitHandoff(agentId, agentName, output, options);
    } finally {
      this.handoffInProgress = false;
    }
  }

  private commitHandoff(
    agentId: string,
    agentName: string,
    output: string,
    options: HandoffOptions = {},
  ) {
    const idempotencyKey = cleanOptionalText(
      options.idempotencyKey,
      "Handoff idempotency key",
    );
    const requestFingerprint = handoffRequestFingerprint(
      agentId,
      agentName,
      output,
    );
    const cached = cachedHandoffDecision(
      this.handoffRequests,
      idempotencyKey,
      requestFingerprint,
    );
    if (cached) return cached;

    this.assertRunnable();
    const limitDecision = this.limitViolationDecision(
      agentId,
      agentName,
      output,
    );
    if (limitDecision) return limitDecision;

    const candidate = makeStage(
      this.stages,
      this.guardrail,
      uniqueStageId(this.stages, agentId),
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

    // Emit before committing: if the sink throws under "throw" mode the caller
    // sees the sink error and the session is unchanged, not silently frozen.
    this.emit(
      shouldBlock ? "handoff-blocked" : "handoff-allowed",
      decision.reason,
      candidate.id,
      report.id,
    );

    this.stages = candidateStages;
    this.latestReport = report;
    this.revision += 1;
    if (shouldBlock) this.frozen = true;
    if (idempotencyKey) {
      this.handoffRequests.set(idempotencyKey, {
        idempotencyKey,
        requestFingerprint,
        stageId: candidate.id,
        decision,
      });
    }
    return structuredClone(decision);
  }

  /**
   * Runs the optional semantic judge before applying the deterministic
   * handoff gate. Existing framework loops should use this method whenever a
   * semantic judge is configured.
   */
  async inspectHandoffAsync(
    agentId: string,
    agentName: string,
    output: string,
    options: HandoffOptions = {},
  ): Promise<HandoffDecision> {
    this.assertNoConcurrentHandoff();
    return this.inspectHandoffSerial(agentId, agentName, output, options);
  }

  private async inspectHandoffSerial(
    agentId: string,
    agentName: string,
    output: string,
    options: HandoffOptions = {},
  ): Promise<HandoffDecision> {
    const idempotencyKey = cleanOptionalText(
      options.idempotencyKey,
      "Handoff idempotency key",
    );
    const cached = cachedHandoffDecision(
      this.handoffRequests,
      idempotencyKey,
      handoffRequestFingerprint(agentId, agentName, output),
    );
    if (cached) return cached;

    this.assertRunnable();
    const transitionIndex = this.stages.length - 1;
    const previousFindings = this.semanticFindings.get(transitionIndex);
    this.handoffInProgress = true;
    try {
      // Check the limits before spending a judge call on an uncommittable output.
      const limitDecision = this.limitViolationDecision(
        agentId,
        agentName,
        output,
      );
      if (limitDecision) return limitDecision;
      if (this.analysisMode !== "deterministic") {
        await this.applySemanticJudge(agentId, agentName, output);
      }
      return this.commitHandoff(agentId, agentName, output, options);
    } finally {
      // Nothing committed (error, limit block, sink failure): drop this attempt's findings.
      if (this.stages.length - 1 === transitionIndex) {
        if (previousFindings) this.semanticFindings.set(transitionIndex, previousFindings);
        else this.semanticFindings.delete(transitionIndex);
      }
      this.handoffInProgress = false;
    }
  }

  async runAgent<TContext>(
    agent: GuardedAgent<TContext>,
    context: TContext,
  ): Promise<HandoffDecision> {
    this.assertNoConcurrentHandoff();
    this.assertRunnable();
    this.agentInProgress = true;
    const input = this.lastStage().text;
    try {
      this.emit("agent-started", `${agent.name} started.`, agent.id);
      const output = await agent.execute({
        input,
        context,
        guard: this.exposeSessionToAgents ? this : undefined,
        tools: this.getToolClient(),
      });
      return await this.inspectHandoffSerial(agent.id, agent.name, output);
    } catch (error) {
      this.emit(
        "agent-failed",
        error instanceof Error ? error.message : `${agent.name} failed.`,
        agent.id,
      );
      throw error;
    } finally {
      this.agentInProgress = false;
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

  registerTool<TInput, TResult>(tool: RegisteredTool<TInput, TResult>) {
    this.toolGate.registerTool(tool);
    return this;
  }

  getToolClient(): GuardedToolClient {
    return this.toolGate.getToolClient();
  }

  executeRegisteredTool<TInput, TResult>(
    toolName: string,
    input: TInput,
    options: RegisteredToolExecutionOptions = {},
  ): Promise<TResult> {
    return this.toolGate.executeRegisteredTool(toolName, input, options);
  }

  authorizeTool<TInput>(intent: ToolIntent<TInput>): ToolDecision<TInput> {
    return this.toolGate.authorizeTool(intent);
  }

  /** Async preflight that does not consume a one-time approval token. */
  authorizeToolAsync<TInput>(
    intent: ToolIntent<TInput>,
  ): Promise<ToolDecision<TInput>> {
    return this.toolGate.authorizeToolAsync(intent);
  }

  executeTool<TInput, TResult>(
    intent: ToolIntent<TInput>,
    execute: (input: TInput) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    return this.toolGate.executeTool(intent, execute);
  }

  resetToLastVerified() {
    this.assertNoConcurrentHandoff();
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
    for (const transitionIndex of [...this.semanticFindings.keys()]) {
      if (transitionIndex >= this.stages.length - 1) {
        this.semanticFindings.delete(transitionIndex);
      }
    }
    this.frozen = false;
    this.latestReport = this.runPipeline(this.stages, null);
    this.revision += 1;
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
    if (this.agentInProgress || this.handoffInProgress || this.toolGate.isBusy()) {
      throw new Error("Cannot snapshot while an operation is in progress; await completion first.");
    }
    const restartStageIndex = this.frozen
      ? this.getReport().recovery.restartStageIndex
      : null;
    const recoveryTransitionIndex =
      restartStageIndex === null ? null : restartStageIndex - 1;
    return buildSnapshot({
      sessionId: this.sessionId,
      runName: this.runName,
      guardrail: this.guardrail,
      blockAtOrAbove: this.blockAtOrAbove,
      analysisMode: this.analysisMode,
      toolPolicy: this.toolPolicy,
      exposeSessionToAgents: this.exposeSessionToAgents,
      rules: this.rules,
      stages: this.stages,
      frozen: this.frozen,
      recoveryTransitionIndex,
      ...this.toolGate.persistedState(),
      handoffRequests: [...this.handoffRequests.values()],
      eventSequence: this.eventSequence,
      semanticFindings: this.semanticFindings,
    });
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
    assertRestoredRuleParity(snapshot, restoredRules);
    const session = new LineageGuardSession({
      sessionId: snapshot.sessionId,
      runName: snapshot.runName,
      guardrail: snapshot.guardrail,
      blockAtOrAbove: snapshot.blockAtOrAbove,
      analysisMode: snapshot.analysisMode,
      toolPolicy: snapshot.toolPolicy,
      exposeSessionToAgents: snapshot.exposeSessionToAgents,
      // Only the documented restore options may be supplied here. Spreading
      // the whole bag would let a plain-JavaScript caller replace the
      // snapshot's blockAtOrAbove, toolPolicy or analysisMode on resume.
      approvalVerifier: options.approvalVerifier,
      semanticJudge: options.semanticJudge,
      semanticJudgeFailureMode: options.semanticJudgeFailureMode,
      semanticJudgeTimeoutMs: options.semanticJudgeTimeoutMs,
      tools: options.tools,
      onEvent: options.onEvent,
      onEventError: options.onEventError,
      eventSinkFailureMode: options.eventSinkFailureMode,
      rules: restoredRules,
    });
    session.stages = snapshot.stages.map((stage) => ({ ...stage }));
    session.frozen = snapshot.frozen;
    snapshot.semanticFindings?.forEach((entry) =>
      session.semanticFindings.set(
        entry.transitionIndex,
        entry.findings.map((finding) => ({ ...finding })),
      ),
    );
    session.latestReport = session.runPipeline(
      session.stages,
      snapshot.frozen ? snapshot.recoveryTransitionIndex : null,
    );
    session.toolGate.restorePersistedState(
      snapshot.consumedApprovalTokenFingerprints,
      snapshot.toolExecutions,
    );
    snapshot.handoffRequests.forEach((record) =>
      session.handoffRequests.set(record.idempotencyKey, structuredClone(record)),
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
    return structuredClone(this.latestReport);
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

  /**
   * Runs the configured semantic judge on a proposed handoff and stores the
   * accepted findings for the pending transition. A judge failure (throw,
   * rejection or timeout) is stored as a finding and reported as an event.
   */
  private async applySemanticJudge(
    agentId: string,
    agentName: string,
    output: unknown,
  ) {
    if (!this.semanticJudge) return;
    if (typeof output !== "string" || !output.trim()) return;
    const transitionIndex = this.stages.length - 1;
    const { findings, failure } = await runSemanticJudge({
      judge: this.semanticJudge,
      timeoutMs: this.semanticJudgeTimeoutMs,
      failureMode: this.semanticJudgeFailureMode,
      analysisMode: this.analysisMode,
      context: {
        sessionId: this.sessionId,
        runName: this.runName,
        guardrail: this.guardrail,
        transitionIndex,
        from: { ...this.lastStage() },
        proposedOutput: output,
        agentId: agentId.trim(),
        agentName: agentName.trim(),
      },
    });
    if (findings.length) {
      this.semanticFindings.set(transitionIndex, findings);
    } else {
      this.semanticFindings.delete(transitionIndex);
    }
    if (failure !== null) {
      this.emit(
        "semantic-judge-failed",
        `${agentName.trim()}: ${failure}`,
        agentId.trim(),
      );
    }
  }

  private runPipeline(
    stages: TraceStage[],
    recoveryTransitionIndex?: number | null,
  ) {
    const rules = this.semanticFindings.size
      ? [...this.rules, semanticReplayRule(this.semanticFindings)]
      : this.rules;
    return runReliabilityPipeline(stages, this.guardrail, {
      recoveryTransitionIndex,
      rules,
      includeBuiltInRules: this.analysisMode !== "semantic",
    });
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

  private assertNoConcurrentHandoff() {
    if (this.agentInProgress || this.handoffInProgress) {
      throw new Error("A handoff or agent operation is already in progress; sessions are serial.");
    }
  }

  private lastStage() {
    const stage = this.stages.at(-1);
    if (!stage) throw new Error("Record a source before running an agent.");
    return stage;
  }

  /**
   * Blocked decision for a handoff beyond `TRACE_LIMITS`, or null. Nothing is
   * committed and the session is not frozen: the agent can retry with an
   * output that fits.
   */
  private limitViolationDecision(
    agentId: string,
    agentName: string,
    output: string,
  ): HandoffDecision | null {
    const violation = describeStageLimitViolation(
      this.stages,
      this.guardrail,
      agentId,
      agentName,
      output,
    );
    if (!violation) return null;
    const decision: HandoffDecision = {
      status: "blocked",
      output: violation.text,
      reason: violation.reason,
      report: this.getReport(),
    };
    this.emit(
      "handoff-blocked",
      violation.reason,
      violation.stageId,
      decision.report.id,
    );
    return decision;
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
