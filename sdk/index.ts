import type { TraceStage } from "../lib/analysis.ts";
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
};

export class LineageGuardRun {
  readonly runName: string;
  private guardrail: string;
  private stages: TraceStage[] = [];

  constructor(options: LineageGuardRunOptions = {}) {
    this.runName = options.runName?.trim() || "Agent run";
    this.guardrail = options.guardrail?.trim() || "";
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
    return runReliabilityPipeline(this.stages, this.guardrail);
  }

  toTrace(): NormalizedTracePayload {
    return {
      runName: this.runName,
      guardrail: this.guardrail,
      stages: this.stages.map((stage) => ({ ...stage })),
    };
  }

  static fromPayload(payload: unknown) {
    const normalized = parseTracePayload(payload);
    const run = new LineageGuardRun({
      runName: normalized.runName,
      guardrail: normalized.guardrail,
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
export { parseTracePayload } from "../lib/trace-schema.ts";
export type { ReliabilityPipelineRun } from "../lib/pipeline.ts";
export type {
  TraceEvent,
  NormalizedTracePayload,
} from "../lib/trace-schema.ts";
export {
  LineageGuardBlockedError,
  LineageGuardSession,
} from "./runtime.ts";
export type {
  GuardedAgent,
  GuardedSequenceResult,
  HandoffDecision,
  LineageGuardSessionOptions,
  RuntimeEvent,
  RuntimeEventType,
  ToolDecision,
  ToolIntent,
  ToolPolicy,
} from "./runtime.ts";
