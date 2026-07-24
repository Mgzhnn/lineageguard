import type { CustomLineageRule, Severity } from "../lib/analysis.ts";
import {
  parseTraceGraphPayload,
  runReliabilityGraphPipeline,
  type NormalizedTraceGraphPayload,
  type TraceGraphStage,
} from "../lib/graph.ts";

export type LineageGuardGraphRunOptions = {
  runName?: string;
  guardrail?: string;
  blockAtOrAbove?: Severity;
  rules?: readonly CustomLineageRule[];
};

export class LineageGuardGraphRun {
  readonly runName: string;
  private readonly guardrail: string;
  private readonly blockAtOrAbove: Severity;
  private readonly rules: readonly CustomLineageRule[];
  private readonly nodes: TraceGraphStage[] = [];

  constructor(options: LineageGuardGraphRunOptions = {}) {
    this.runName = options.runName?.trim() || "Agent graph run";
    this.guardrail = options.guardrail?.trim() || "";
    this.blockAtOrAbove = options.blockAtOrAbove ?? "medium";
    this.rules = options.rules ? [...options.rules] : [];
  }

  recordRoot(id: string, label: string, text: string) {
    return this.recordNode(id, label, text, []);
  }

  recordHandoff(
    id: string,
    label: string,
    text: string,
    parentIds: string[],
    inheritedClaims?: Record<string, string>,
  ) {
    if (!parentIds.length) {
      throw new Error("A graph handoff requires at least one parent.");
    }
    return this.recordNode(id, label, text, parentIds, inheritedClaims);
  }

  finalize() {
    return runReliabilityGraphPipeline(this.nodes, this.guardrail, {
      blockAtOrAbove: this.blockAtOrAbove,
      rules: this.rules,
    });
  }

  toTrace(): NormalizedTraceGraphPayload {
    return {
      runName: this.runName,
      guardrail: this.guardrail,
      nodes: this.nodes.map((node) => ({
        ...node,
        parentIds: [...node.parentIds],
        inheritedClaims: node.inheritedClaims
          ? { ...node.inheritedClaims }
          : undefined,
      })),
    };
  }

  static fromPayload(
    payload: unknown,
    options: Pick<LineageGuardGraphRunOptions, "blockAtOrAbove" | "rules"> = {},
  ) {
    const normalized = parseTraceGraphPayload(payload);
    const run = new LineageGuardGraphRun({
      runName: normalized.runName,
      guardrail: normalized.guardrail,
      ...options,
    });
    normalized.nodes.forEach((node) => {
      if (node.parentIds.length) {
        run.recordHandoff(
          node.id,
          node.label,
          node.text,
          node.parentIds,
          node.inheritedClaims,
        );
      } else {
        run.recordRoot(node.id, node.label, node.text);
      }
    });
    return run;
  }

  private recordNode(
    id: string,
    label: string,
    text: string,
    parentIds: string[],
    inheritedClaims?: Record<string, string>,
  ) {
    const node = {
      id: id.trim(),
      label: label.trim(),
      text: text.trim(),
      parentIds: parentIds.map((parentId) => parentId.trim()),
      inheritedClaims: inheritedClaims
        ? Object.fromEntries(
            Object.entries(inheritedClaims).map(([parentId, claim]) => [
              parentId.trim(),
              claim.trim(),
            ]),
          )
        : undefined,
    };
    if (!node.id || !node.label || !node.text) {
      throw new Error("Graph node id, label, and text must be non-empty.");
    }
    if (this.nodes.some((existing) => existing.id === node.id)) {
      throw new Error(`Graph node id "${node.id}" is already recorded.`);
    }
    this.nodes.push(node);
    return this;
  }
}
