import type { TraceStage } from "../../lib/analysis.ts";
import type { ReliabilityPipelineRun } from "../../lib/pipeline.ts";
import {
  parseTracePayload,
  TRACE_LIMITS,
  type NormalizedTracePayload,
} from "../../lib/trace-schema.ts";

/** True when the report was produced from exactly these stages and guardrail. */
export function isReportCurrent(
  report: ReliabilityPipelineRun,
  stages: readonly TraceStage[],
  guardrail: string,
) {
  return (
    guardrail === report.recovery.protectedInstruction &&
    stages.length === report.graph.nodes.length &&
    stages.every((stage, index) => {
      const analyzed = report.graph.nodes[index];
      return (
        stage.id === analyzed.id &&
        stage.label === analyzed.label &&
        stage.text === analyzed.text
      );
    })
  );
}

/** Prevent a receipt from associating a previous verdict with an edited trace. */
export function requireCurrentReport(
  report: ReliabilityPipelineRun,
  stages: readonly TraceStage[],
  guardrail: string,
) {
  if (!isReportCurrent(report, stages, guardrail)) {
    throw new Error("Run the reliability pipeline again before copying or exporting this report.");
  }
}

export type TraceImportSource = "file" | "paste";

export type TraceImportResult =
  | { ok: true; payload: NormalizedTracePayload }
  | { ok: false; message: string };

export const GRAPH_TRACE_IMPORT_MESSAGE =
  "Graph traces are evaluated by the API and SDK; the workspace renders chains.";

/**
 * The single parsing branch behind the file picker and the paste box: the
 * 2 MB limit is measured in bytes, a 1.1 graph payload gets the workspace
 * message instead of a schemaVersion error, and a JSON syntax error names the
 * source instead of leaking the parser text.
 */
export function readTraceImport(
  text: string,
  source: TraceImportSource,
): TraceImportResult {
  const sourceName = source === "file" ? "File" : "Pasted text";
  if (new TextEncoder().encode(text).byteLength > TRACE_LIMITS.payloadBytes) {
    return {
      ok: false,
      message: `Import failed: ${
        source === "file" ? "JSON file" : "Pasted JSON"
      } must be smaller than 2 MB.`,
    };
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, message: `Import failed: ${sourceName} is not valid JSON.` };
  }
  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).schemaVersion === "1.1"
  ) {
    return { ok: false, message: GRAPH_TRACE_IMPORT_MESSAGE };
  }
  try {
    return { ok: true, payload: parseTracePayload(input) };
  } catch (error) {
    return {
      ok: false,
      message: `Import failed: ${
        error instanceof Error ? error.message : "invalid trace payload"
      }`,
    };
  }
}
