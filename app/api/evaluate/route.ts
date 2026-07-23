import type { Severity } from "@/lib/analysis";
import { runReliabilityPipeline } from "@/lib/pipeline";
import { parseTracePayload, TracePayloadError } from "@/lib/trace-schema";

const severityRank: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 2_000_000) {
      return Response.json(
        { status: "error", error: "Trace payload must be smaller than 2 MB." },
        { status: 413 },
      );
    }
    const input: unknown = JSON.parse(body);
    const threshold: Severity =
      isRecord(input) &&
      (input.blockAtOrAbove === "low" ||
        input.blockAtOrAbove === "medium" ||
        input.blockAtOrAbove === "high")
        ? input.blockAtOrAbove
        : "medium";
    const trace = parseTracePayload(input);
    let report = runReliabilityPipeline(trace.stages, trace.guardrail);
    const blockingTransitionIndex = report.analysis.transitions.findIndex(
      (transition) =>
        severityRank[transition.severity] >= severityRank[threshold],
    );
    if (
      blockingTransitionIndex >= 0 &&
      report.analysis.firstMutationIndex !== blockingTransitionIndex
    ) {
      report = runReliabilityPipeline(trace.stages, trace.guardrail, {
        recoveryTransitionIndex: blockingTransitionIndex,
      });
    }
    const blocked = blockingTransitionIndex >= 0;
    const transition = blocked
      ? report.analysis.transitions[blockingTransitionIndex]
      : report.analysis.transitions.at(-1) ?? null;

    return Response.json({
      status: "ok",
      decision: blocked ? "block" : "allow",
      threshold,
      blockingTransitionIndex: blocked ? blockingTransitionIndex : null,
      transition,
      runId: report.id,
      recovery: report.recovery,
      report,
    });
  } catch (error) {
    const message =
      error instanceof TracePayloadError || error instanceof SyntaxError
        ? error.message
        : "Unable to evaluate this trace.";
    return Response.json({ status: "error", error: message }, { status: 400 });
  }
}
