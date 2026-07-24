import type { Severity, TraceStage } from "../lib/analysis.ts";
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

export type LineageGuardSessionOptions = {
  runName?: string;
  guardrail?: string;
  blockAtOrAbove?: Severity;
  toolPolicy?: ToolPolicy;
  onEvent?: (event: RuntimeEvent) => void;
};

export type ToolIntent<TInput = unknown> = {
  toolName: string;
  action: string;
  input?: TInput;
  sideEffect: boolean;
  approvedBy?: string;
};

export type ToolDecision<TInput = unknown> = {
  status: "allowed" | "blocked" | "approval-required";
  reason: string;
  intent: ToolIntent<TInput>;
};

export type HandoffDecision = {
  status: "allowed" | "blocked";
  output: string;
  reason: string;
  report: ReliabilityPipelineRun;
};

export type GuardedAgent<TContext = unknown> = {
  id: string;
  name: string;
  execute: (input: {
    input: string;
    context: TContext;
    guard: LineageGuardSession;
  }) => string | Promise<string>;
};

export type GuardedSequenceResult = {
  status: "completed" | "blocked";
  blockedAgentId: string | null;
  report: ReliabilityPipelineRun;
};

const severityRank: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

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
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field} must be a non-empty string.`);
  return cleaned;
}

export class LineageGuardBlockedError<TInput = unknown> extends Error {
  readonly decision: ToolDecision<TInput>;

  constructor(decision: ToolDecision<TInput>) {
    super(`LineageGuard ${decision.status}: ${decision.reason}`);
    this.name = "LineageGuardBlockedError";
    this.decision = decision;
  }
}

/**
 * Runtime supervisor for an agent loop.
 *
 * The host calls inspectHandoff after each model output and executeTool before
 * every tool invocation. A blocked handoff freezes the session so downstream
 * agents cannot run until resetToLastVerified() is explicitly called.
 */
export class LineageGuardSession {
  readonly runName: string;
  private readonly guardrail: string;
  private readonly blockAtOrAbove: Severity;
  private readonly toolPolicy: ToolPolicy;
  private readonly onEvent?: (event: RuntimeEvent) => void;
  private stages: TraceStage[] = [];
  private frozen = false;
  private latestReport: ReliabilityPipelineRun | null = null;

  constructor(options: LineageGuardSessionOptions = {}) {
    this.runName = options.runName?.trim() || "Agent run";
    this.guardrail = options.guardrail?.trim() || "";
    this.blockAtOrAbove = options.blockAtOrAbove ?? "medium";
    this.toolPolicy = options.toolPolicy ?? {};
    this.onEvent = options.onEvent;
  }

  recordSource(label: string, text: string, id = "source") {
    if (this.stages.length) {
      throw new Error("The source must be recorded before any agent runs.");
    }
    this.stages.push(this.makeStage(id, label, text));
    this.latestReport = runReliabilityPipeline(this.stages, this.guardrail);
    this.emit(
      "source-recorded",
      `Authoritative source recorded as ${label.trim()}.`,
      id,
      this.latestReport.id,
    );
    return this;
  }

  inspectHandoff(agentId: string, agentName: string, output: string) {
    this.assertRunnable();
    const candidate = this.makeStage(
      this.uniqueStageId(agentId),
      agentName,
      output,
    );
    const candidateStages = [...this.stages, candidate];
    const initialReport = runReliabilityPipeline(
      candidateStages,
      this.guardrail,
    );
    const currentTransition = initialReport.analysis.transitions.at(-1);
    const shouldBlock =
      currentTransition !== undefined &&
      severityRank[currentTransition.severity] >=
        severityRank[this.blockAtOrAbove];
    const report = runReliabilityPipeline(candidateStages, this.guardrail, {
      recoveryTransitionIndex: shouldBlock
        ? candidateStages.length - 2
        : null,
    });

    this.stages = candidateStages;
    this.latestReport = report;

    if (shouldBlock) {
      this.frozen = true;
      const decision: HandoffDecision = {
        status: "blocked",
        output: candidate.text,
        reason: `${currentTransition.issueCount} reliability signal${
          currentTransition.issueCount === 1 ? "" : "s"
        } reached the ${this.blockAtOrAbove} blocking threshold.`,
        report,
      };
      this.emit(
        "handoff-blocked",
        decision.reason,
        candidate.id,
        report.id,
      );
      return decision;
    }

    const decision: HandoffDecision = {
      status: "allowed",
      output: candidate.text,
      reason:
        currentTransition?.severity === "low"
          ? "Only low-severity review signals were found; the configured threshold allows this handoff."
          : "No blocking reliability signal was found.",
      report,
    };
    this.emit("handoff-allowed", decision.reason, candidate.id, report.id);
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
      const output = await agent.execute({ input, context, guard: this });
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

  authorizeTool<TInput>(intent: ToolIntent<TInput>): ToolDecision<TInput> {
    const toolName = cleanText(intent.toolName, "Tool name");
    const action = cleanText(intent.action, "Tool action");
    const normalizedIntent = {
      ...intent,
      toolName,
      action,
      sideEffect:
        intent.sideEffect ||
        matchesTool(toolName, this.toolPolicy.sideEffectTools),
    };

    if (!this.stages.length) {
      return this.toolDecision(
        "blocked",
        "Record an authoritative source before using tools.",
        normalizedIntent,
      );
    }

    if (this.frozen) {
      return this.toolDecision(
        "blocked",
        "The run is frozen after a failed handoff. Recover before using tools.",
        normalizedIntent,
      );
    }

    if (matchesTool(toolName, this.toolPolicy.deniedTools)) {
      return this.toolDecision(
        "blocked",
        `${toolName} is explicitly denied by the runtime tool policy.`,
        normalizedIntent,
      );
    }

    const explicitlyAllowed = matchesTool(
      toolName,
      this.toolPolicy.allowedTools,
    );
    const needsApproval =
      matchesTool(toolName, this.toolPolicy.approvalRequiredTools) ||
      (normalizedIntent.sideEffect &&
        !explicitlyAllowed &&
        (this.toolPolicy.defaultSideEffectMode ?? "require-approval") ===
          "require-approval");

    if (needsApproval && !intent.approvedBy?.trim()) {
      return this.toolDecision(
        "approval-required",
        `${toolName} can create an external side effect and needs a named human approval.`,
        normalizedIntent,
      );
    }

    if (
      normalizedIntent.sideEffect &&
      !explicitlyAllowed &&
      (this.toolPolicy.defaultSideEffectMode ?? "require-approval") === "deny"
    ) {
      return this.toolDecision(
        "blocked",
        `${toolName} is a side-effecting tool and the default policy is deny.`,
        normalizedIntent,
      );
    }

    return this.toolDecision(
      "allowed",
      intent.approvedBy?.trim()
        ? `Approved by ${intent.approvedBy.trim()}.`
        : normalizedIntent.sideEffect
          ? `${toolName} is explicitly allowed by policy.`
          : `${toolName} is read-only.`,
      normalizedIntent,
    );
  }

  async executeTool<TInput, TResult>(
    intent: ToolIntent<TInput>,
    execute: (input: TInput) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const decision = this.authorizeTool(intent);
    if (decision.status !== "allowed") {
      throw new LineageGuardBlockedError(decision);
    }
    return execute(intent.input as TInput);
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
    this.frozen = false;
    this.latestReport = runReliabilityPipeline(
      this.stages,
      this.guardrail,
      { recoveryTransitionIndex: null },
    );
    const checkpoint = this.lastStage();
    this.emit(
      "recovery-applied",
      `Restored ${checkpoint.label}; retry can begin from the failed handoff.`,
      checkpoint.id,
      this.latestReport.id,
    );
    return { ...checkpoint };
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

  private toolDecision<TInput>(
    status: ToolDecision<TInput>["status"],
    reason: string,
    intent: ToolIntent<TInput>,
  ): ToolDecision<TInput> {
    const decision = { status, reason, intent };
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
    this.onEvent?.({
      type,
      timestamp: new Date().toISOString(),
      message,
      agentId,
      runId,
    });
  }
}
