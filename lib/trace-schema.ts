import type { TraceStage } from "./analysis.ts";

export const TRACE_LIMITS = {
  payloadBytes: 2_000_000,
  stages: 50,
  identifierCharacters: 128,
  labelCharacters: 200,
  runNameCharacters: 200,
  guardrailCharacters: 20_000,
  stageTextCharacters: 500_000,
  totalTextCharacters: 1_500_000,
} as const;

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
  maxLength: number,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new TracePayloadError(`${location}.${key} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new TracePayloadError(
      `${location}.${key} must be at most ${maxLength} characters.`,
    );
  }
  return normalized;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  fallback = "",
  maxLength = Number.POSITIVE_INFINITY,
) {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new TracePayloadError(`${key} must be a string when provided.`);
  }
  const normalized = value.trim();
  if (!normalized) return fallback;
  if (normalized.length > maxLength) {
    throw new TracePayloadError(
      `${key} must be at most ${maxLength} characters.`,
    );
  }
  return normalized;
}

function uniqueStageId(base: string, usedIds: Set<string>) {
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
  const id = `${base}-${suffix}`;
  usedIds.add(id);
  return id;
}

function parseStages(items: unknown[]): TraceStage[] {
  const usedIds = new Set<string>();
  return items.map((item, index) => {
    if (!isRecord(item)) {
      throw new TracePayloadError(`stages[${index}] must be an object.`);
    }
    let id: string;
    if (item.id === undefined) {
      id = uniqueStageId(`stage-${index + 1}`, usedIds);
    } else {
      id = requiredString(
        item,
        "id",
        `stages[${index}]`,
        TRACE_LIMITS.identifierCharacters,
      );
      if (usedIds.has(id)) {
        throw new TracePayloadError(`Stage id "${id}" must be unique.`);
      }
      usedIds.add(id);
    }
    return {
      id,
      label: requiredString(
        item,
        "label",
        `stages[${index}]`,
        TRACE_LIMITS.labelCharacters,
      ),
      text: requiredString(
        item,
        "text",
        `stages[${index}]`,
        TRACE_LIMITS.stageTextCharacters,
      ),
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
      agentId: requiredString(
        item,
        "agentId",
        `events[${index}]`,
        TRACE_LIMITS.identifierCharacters,
      ),
      agentName: requiredString(
        item,
        "agentName",
        `events[${index}]`,
        TRACE_LIMITS.labelCharacters,
      ),
      content: requiredString(
        item,
        "content",
        `events[${index}]`,
        TRACE_LIMITS.stageTextCharacters,
      ),
      timestamp:
        item.timestamp === undefined
          ? undefined
          : requiredString(item, "timestamp", `events[${index}]`, 100),
    };
  });

  events.sort((a, b) => a.sequence - b.sequence);
  if (events[0]?.type !== "source") {
    throw new TracePayloadError("The first event must have type \"source\".");
  }
  if (events.slice(1).some((event) => event.type === "source")) {
    throw new TracePayloadError("Only the first event can have type \"source\".");
  }
  const sequences = new Set(events.map((event) => event.sequence));
  if (sequences.size !== events.length) {
    throw new TracePayloadError("Event sequence numbers must be unique.");
  }

  const usedIds = new Set<string>();
  return events.map((event) => ({
    id: uniqueStageId(event.agentId, usedIds),
    label: event.agentName,
    text: event.content,
  }));
}

export function parseTracePayload(input: unknown): NormalizedTracePayload {
  if (!isRecord(input)) {
    throw new TracePayloadError("Trace payload must be a JSON object.");
  }

  if (
    input.schemaVersion !== undefined &&
    input.schemaVersion !== "1.0"
  ) {
    throw new TracePayloadError(
      "schemaVersion must be \"1.0\" when provided.",
    );
  }

  const guardrail = optionalString(
    input,
    "guardrail",
    "",
    TRACE_LIMITS.guardrailCharacters,
  );
  const runName = optionalString(
    input,
    "runName",
    "Imported agent run",
    TRACE_LIMITS.runNameCharacters,
  );
  let stages: TraceStage[];

  const hasStages = Array.isArray(input.stages);
  const hasEvents = Array.isArray(input.events);
  if (hasStages === hasEvents) {
    throw new TracePayloadError(
      "Trace payload must include exactly one of stages or events.",
    );
  }

  if (hasStages) {
    stages = parseStages(input.stages as unknown[]);
  } else if (hasEvents) {
    stages = parseEvents(input.events as unknown[]);
  } else {
    throw new TracePayloadError("Trace payload has an invalid trace array.");
  }

  if (stages.length < 2) {
    throw new TracePayloadError(
      "A trace needs one source and at least one handoff.",
    );
  }
  if (stages.length > TRACE_LIMITS.stages) {
    throw new TracePayloadError(
      `A trace can contain at most ${TRACE_LIMITS.stages} stages.`,
    );
  }
  const totalTextCharacters =
    guardrail.length +
    stages.reduce((total, stage) => total + stage.text.length, 0);
  if (totalTextCharacters > TRACE_LIMITS.totalTextCharacters) {
    throw new TracePayloadError(
      `Trace text must total at most ${TRACE_LIMITS.totalTextCharacters} characters.`,
    );
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
