import type {
  CustomLineageRule,
  TraceStage,
} from "../lib/analysis.ts";
import {
  runReliabilityPipeline,
  type ReliabilityPipelineRun,
} from "../lib/pipeline.ts";
import {
  parseTracePayload,
  type NormalizedTracePayload,
} from "../lib/trace-schema.ts";

export type LineageGuardRunOptions = {
  runName?: string;
  guardrail?: string;
  rules?: readonly CustomLineageRule[];
};

export class LineageGuardRun {
  readonly runName: string;
  private guardrail: string;
  private readonly rules: readonly CustomLineageRule[];
  private stages: TraceStage[] = [];

  constructor(options: LineageGuardRunOptions = {}) {
    this.runName = options.runName?.trim() || "Agent run";
    this.guardrail = options.guardrail?.trim() || "";
    this.rules = options.rules ? [...options.rules] : [];
  }

  setGuardrail(guardrail: string) {
    this.guardrail = guardrail.trim();
    return this;
  }

  recordSource(label: string, text: string, id = "source") {
    if (this.stages.length) {
      throw new Error("The source must be recorded before any handoff.");
    }
    this.stages.push(this.makeStage(id, label, text));
    return this;
  }

  recordHandoff(agentId: string, agentName: string, text: string) {
    if (!this.stages.length) {
      throw new Error("Record a source before recording a handoff.");
    }
    this.stages.push(this.makeStage(agentId, agentName, text));
    return this;
  }

  finalize(): ReliabilityPipelineRun {
    if (this.stages.length < 2) {
      throw new Error("A run requires one source and at least one handoff.");
    }
    return runReliabilityPipeline(this.stages, this.guardrail, {
      rules: this.rules,
    });
  }

  toTrace(): NormalizedTracePayload {
    return {
      runName: this.runName,
      guardrail: this.guardrail,
      stages: this.stages.map((stage) => ({ ...stage })),
    };
  }

  static fromPayload(
    payload: unknown,
    options: Pick<LineageGuardRunOptions, "rules"> = {},
  ) {
    const normalized = parseTracePayload(payload);
    const run = new LineageGuardRun({
      runName: normalized.runName,
      guardrail: normalized.guardrail,
      ...options,
    });
    const [source, ...handoffs] = normalized.stages;
    run.recordSource(source.label, source.text, source.id);
    handoffs.forEach((stage) => {
      run.recordHandoff(stage.id, stage.label, stage.text);
    });
    return run;
  }

  private makeStage(id: string, label: string, text: string): TraceStage {
    if (!id.trim() || !label.trim() || !text.trim()) {
      throw new Error("Stage id, label, and text must be non-empty.");
    }
    if (this.stages.some((stage) => stage.id === id.trim())) {
      throw new Error(`Stage id "${id.trim()}" is already in this run.`);
    }
    return {
      id: id.trim(),
      label: label.trim(),
      text: text.trim(),
    };
  }
}

export { runReliabilityPipeline } from "../lib/pipeline.ts";
export {
  analyzeLineage,
  buildPlainTextReport,
  getTraceSignalSnapshot,
} from "../lib/analysis.ts";
export {
  canonicalJson,
  fingerprintValue,
  sha256Hex,
} from "../lib/fingerprint.ts";
export {
  PIPELINE_VERSION,
  PRODUCT_VERSION,
} from "../lib/version.ts";
export { parseTracePayload } from "../lib/trace-schema.ts";
export {
  parseTraceGraphPayload,
  runReliabilityGraphPipeline,
} from "../lib/graph.ts";
export {
  parseOtlpTracePayload,
  runOtlpReliabilityPipeline,
} from "./otel.ts";
export type { ReliabilityPipelineRun } from "../lib/pipeline.ts";
export type {
  AnalysisOptions,
  AnalysisResult,
  CustomLineageRule,
  CustomLineageRuleContext,
  CustomRuleFinding,
  IssueFamily,
  IssueType,
  LineageIssue,
  Severity,
  TraceSignalSnapshot,
  TraceStage,
  TransitionResult,
} from "../lib/analysis.ts";
export type {
  GraphEdgeResult,
  GraphLineageIssue,
  GraphNodeResult,
  GraphRecoveryPacket,
  NormalizedTraceGraphPayload,
  ReliabilityGraphOptions,
  ReliabilityGraphRun,
  TraceGraphStage,
} from "../lib/graph.ts";
export type {
  TraceEvent,
  NormalizedTracePayload,
} from "../lib/trace-schema.ts";
export {
  LineageGuardBlockedError,
  LineageGuardDuplicateExecutionError,
  LineageGuardSession,
} from "./runtime.ts";
export { LineageGuardGraphRun } from "./graph.ts";
export type {
  GuardedToolClient,
  GuardedAgent,
  GuardedSequenceResult,
  HandoffDecision,
  HandoffOptions,
  LineageGuardRestoreOptions,
  LineageGuardSessionOptions,
  LineageGuardSessionSnapshot,
  LineageGuardSnapshotStore,
  RegisteredTool,
  RegisteredToolExecutionOptions,
  RuntimeEvent,
  RuntimeEventType,
  ToolApproval,
  ToolApprovalContext,
  ToolApprovalVerifier,
  ToolDecision,
  ToolIntent,
  ToolPolicy,
} from "./runtime.ts";
export type { LineageGuardGraphRunOptions } from "./graph.ts";
export type {
  NormalizedOtlpLineageTrace,
  OtlpLineageOptions,
} from "./otel.ts";
