import type { Severity } from "@/lib/analysis";
import { runReliabilityPipeline } from "@/lib/pipeline";
import {
  parseTracePayload,
  TRACE_LIMITS,
  TracePayloadError,
} from "@/lib/trace-schema";

const severityRank: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class RequestPayloadTooLargeError extends Error {}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(body, { ...init, headers });
}

async function readRequestText(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > TRACE_LIMITS.payloadBytes
  ) {
    throw new RequestPayloadTooLargeError();
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > TRACE_LIMITS.payloadBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestPayloadTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

function parseThreshold(input: unknown): Severity {
  if (!isRecord(input) || input.blockAtOrAbove === undefined) return "medium";
  if (
    input.blockAtOrAbove !== "low" &&
    input.blockAtOrAbove !== "medium" &&
    input.blockAtOrAbove !== "high"
  ) {
    throw new TracePayloadError(
      "blockAtOrAbove must be \"low\", \"medium\", or \"high\".",
    );
  }
  return input.blockAtOrAbove;
}

export async function POST(request: Request) {
  try {
    const mediaType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (mediaType !== "application/json") {
      return json(
        { status: "error", error: "Content-Type must be application/json." },
        { status: 415 },
      );
    }

    const body = await readRequestText(request);
    const input: unknown = JSON.parse(body);
    const threshold = parseThreshold(input);
    const trace = parseTracePayload(input);
    const initialReport = runReliabilityPipeline(
      trace.stages,
      trace.guardrail,
    );
    const blockingTransitionIndex =
      initialReport.analysis.transitions.findIndex(
        (transition) =>
          severityRank[transition.severity] >= severityRank[threshold],
      );
    const blocked = blockingTransitionIndex >= 0;
    const report = runReliabilityPipeline(trace.stages, trace.guardrail, {
      recoveryTransitionIndex: blocked ? blockingTransitionIndex : null,
    });
    const transition = blocked
      ? report.analysis.transitions[blockingTransitionIndex]
      : report.analysis.transitions.at(-1) ?? null;

    return json({
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
    if (error instanceof RequestPayloadTooLargeError) {
      return json(
        { status: "error", error: "Trace payload must be smaller than 2 MB." },
        { status: 413 },
      );
    }
    const message =
      error instanceof TracePayloadError
        ? error.message
        : error instanceof SyntaxError
          ? "Request body must contain valid JSON."
        : "Unable to evaluate this trace.";
    const status =
      error instanceof TracePayloadError || error instanceof SyntaxError
        ? 400
        : 500;
    return json({ status: "error", error: message }, { status });
  }
}
