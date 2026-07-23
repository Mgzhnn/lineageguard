import type { TraceStage } from "./analysis.ts";

export type TraceEvent = {
  sequence: number;
  type: "source" | "handoff";
  agentId: string;
  agentName: string;
  content: string;
  timestamp?: string;
};

export type NormalizedTracePayload = {
  runName: string;
  guardrail: string;
  stages: TraceStage[];
};

export class TracePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TracePayloadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  location: string,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new TracePayloadError(`${location}.${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  fallback = "",
) {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new TracePayloadError(`${key} must be a string when provided.`);
  }
  return value;
}

function parseStages(items: unknown[]): TraceStage[] {
  return items.map((item, index) => {
    if (!isRecord(item)) {
      throw new TracePayloadError(`stages[${index}] must be an object.`);
    }
    return {
      id:
        typeof item.id === "string" && item.id.trim()
          ? item.id.trim()
          : `stage-${index + 1}`,
      label: requiredString(item, "label", `stages[${index}]`),
      text: requiredString(item, "text", `stages[${index}]`),
    };
  });
}

function parseEvents(items: unknown[]): TraceStage[] {
  const events = items.map((item, index): TraceEvent => {
    if (!isRecord(item)) {
      throw new TracePayloadError(`events[${index}] must be an object.`);
    }
    if (
      item.type !== "source" &&
      item.type !== "handoff"
    ) {
      throw new TracePayloadError(
        `events[${index}].type must be "source" or "handoff".`,
      );
    }
    if (
      typeof item.sequence !== "number" ||
      !Number.isInteger(item.sequence) ||
      item.sequence < 0
    ) {
      throw new TracePayloadError(
        `events[${index}].sequence must be a non-negative integer.`,
      );
    }
    return {
      sequence: item.sequence,
      type: item.type,
      agentId: requiredString(item, "agentId", `events[${index}]`),
      agentName: requiredString(item, "agentName", `events[${index}]`),
      content: requiredString(item, "content", `events[${index}]`),
      timestamp:
        typeof item.timestamp === "string" ? item.timestamp : undefined,
    };
  });

  events.sort((a, b) => a.sequence - b.sequence);
  if (events[0]?.type !== "source") {
    throw new TracePayloadError("The first event must have type \"source\".");
  }
  const sequences = new Set(events.map((event) => event.sequence));
  if (sequences.size !== events.length) {
    throw new TracePayloadError("Event sequence numbers must be unique.");
  }

  return events.map((event) => ({
    id: event.agentId,
    label: event.agentName,
    text: event.content,
  }));
}

export function parseTracePayload(input: unknown): NormalizedTracePayload {
  if (!isRecord(input)) {
    throw new TracePayloadError("Trace payload must be a JSON object.");
  }

  const guardrail = optionalString(input, "guardrail");
  const runName = optionalString(input, "runName", "Imported agent run");
  let stages: TraceStage[];

  if (Array.isArray(input.stages)) {
    stages = parseStages(input.stages);
  } else if (Array.isArray(input.events)) {
    stages = parseEvents(input.events);
  } else {
    throw new TracePayloadError(
      "Trace payload must include a stages array or an events array.",
    );
  }

  if (stages.length < 2) {
    throw new TracePayloadError(
      "A trace needs one source and at least one handoff.",
    );
  }
  if (stages.length > 50) {
    throw new TracePayloadError("A trace can contain at most 50 stages.");
  }

  return {
    runName,
    guardrail,
    stages,
  };
}

export function createSampleTracePayload() {
  return {
    schemaVersion: "1.0",
    runName: "Clinical research handoff",
    guardrail:
      "Keep the uncertainty and the complete 12–18% range. Human approval is required before publishing.",
    events: [
      {
        sequence: 0,
        type: "source",
        agentId: "source",
        agentName: "Source evidence",
        content:
          "A pilot study suggests the treatment may reduce symptoms by 12–18%. The result is not confirmed.",
      },
      {
        sequence: 1,
        type: "handoff",
        agentId: "research-agent",
        agentName: "Research agent",
        content:
          "A pilot study suggests the treatment may reduce symptoms by 12–18%. The result is not confirmed.",
      },
      {
        sequence: 2,
        type: "handoff",
        agentId: "summary-agent",
        agentName: "Summary agent",
        content: "The study shows the treatment reduces symptoms by 18%.",
      },
    ],
  } as const;
}
