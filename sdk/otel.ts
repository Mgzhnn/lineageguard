import {
  runReliabilityGraphPipeline,
  type NormalizedTraceGraphPayload,
  type ReliabilityGraphOptions,
  type TraceGraphStage,
} from "../lib/graph.ts";
import { TRACE_LIMITS, TracePayloadError } from "../lib/trace-schema.ts";

export type OtlpLineageOptions = {
  traceId?: string;
  runName?: string;
  guardrail?: string;
  sourceText?: string;
  sourceLabel?: string;
  sourceAttributeKeys?: readonly string[];
  outputAttributeKeys?: readonly string[];
  labelAttributeKeys?: readonly string[];
  guardrailAttributeKeys?: readonly string[];
  workflowAttributeKeys?: readonly string[];
};

export type NormalizedOtlpLineageTrace = NormalizedTraceGraphPayload & {
  traceId: string;
  selectedSpanIds: string[];
};

type AttributeMap = Map<string, unknown>;

type ParsedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTimeUnixNano: bigint | null;
  attributes: AttributeMap;
  resourceAttributes: AttributeMap;
  linkedSpanIds: string[];
  inputIndex: number;
};

const DEFAULT_SOURCE_KEYS = [
  "lineageguard.source",
  "gen_ai.input.messages",
  "gen_ai.prompt",
] as const;
const DEFAULT_OUTPUT_KEYS = [
  "lineageguard.output",
  "gen_ai.output.messages",
  "gen_ai.completion",
] as const;
const DEFAULT_LABEL_KEYS = [
  "lineageguard.agent.name",
  "gen_ai.agent.name",
] as const;
const DEFAULT_GUARDRAIL_KEYS = ["lineageguard.guardrail"] as const;
const DEFAULT_WORKFLOW_KEYS = [
  "gen_ai.workflow.name",
  "service.name",
] as const;
const MAX_ATTRIBUTE_KEYS = 32;
const MAX_ATTRIBUTE_KEY_CHARACTERS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(
  value: unknown,
  location: string,
  allowMissing = false,
): unknown[] {
  if (value === undefined && allowMissing) return [];
  if (!Array.isArray(value)) {
    throw new TracePayloadError(`${location} must be an array.`);
  }
  return value;
}

function normalizeAttributeKeys(
  value: readonly string[] | undefined,
  defaults: readonly string[],
  field: string,
) {
  if (value === undefined) return defaults;
  if (!Array.isArray(value)) {
    throw new TracePayloadError(`${field} must be an array.`);
  }
  if (!value.length || value.length > MAX_ATTRIBUTE_KEYS) {
    throw new TracePayloadError(
      `${field} must contain between 1 and ${MAX_ATTRIBUTE_KEYS} keys.`,
    );
  }

  const seen = new Set<string>();
  return value.map((key, index) => {
    if (typeof key !== "string" || !key.trim()) {
      throw new TracePayloadError(
        `${field}[${index}] must be a non-empty string.`,
      );
    }
    const normalized = key.trim();
    if (normalized.length > MAX_ATTRIBUTE_KEY_CHARACTERS) {
      throw new TracePayloadError(
        `${field}[${index}] exceeds ${MAX_ATTRIBUTE_KEY_CHARACTERS} characters.`,
      );
    }
    if (seen.has(normalized)) {
      throw new TracePayloadError(
        `${field} contains duplicate key "${normalized}".`,
      );
    }
    seen.add(normalized);
    return normalized;
  });
}

function normalizeTraceId(value: unknown, location: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value)) {
    throw new TracePayloadError(
      `${location} must be a 32-character hexadecimal OTLP trace id.`,
    );
  }
  if (/^0{32}$/.test(value)) {
    throw new TracePayloadError(`${location} cannot be an all-zero trace id.`);
  }
  return value.toLowerCase();
}

function normalizeSpanId(
  value: unknown,
  location: string,
  allowEmpty = false,
) {
  if (allowEmpty && (value === undefined || value === "" || value === null)) {
    return null;
  }
  if (typeof value !== "string" || !/^[a-f0-9]{16}$/i.test(value)) {
    throw new TracePayloadError(
      `${location} must be a 16-character hexadecimal OTLP span id.`,
    );
  }
  if (/^0{16}$/.test(value)) {
    if (allowEmpty) return null;
    throw new TracePayloadError(`${location} cannot be an all-zero span id.`);
  }
  return value.toLowerCase();
}

function decodeAnyValue(value: unknown, location: string): unknown {
  if (!isRecord(value)) {
    throw new TracePayloadError(`${location} must be an OTLP AnyValue object.`);
  }
  if (typeof value.stringValue === "string") return value.stringValue;
  if (
    typeof value.boolValue === "boolean" ||
    typeof value.intValue === "number" ||
    typeof value.doubleValue === "number"
  ) {
    return value.boolValue ?? value.intValue ?? value.doubleValue;
  }
  if (typeof value.intValue === "string") return value.intValue;
  if (typeof value.bytesValue === "string") return value.bytesValue;
  if (isRecord(value.arrayValue)) {
    return requireArray(
      value.arrayValue.values,
      `${location}.arrayValue.values`,
      true,
    ).map((item, index) =>
      decodeAnyValue(item, `${location}.arrayValue.values[${index}]`),
    );
  }
  if (isRecord(value.kvlistValue)) {
    const entries = requireArray(
      value.kvlistValue.values,
      `${location}.kvlistValue.values`,
      true,
    ).map((entry, index) => {
      if (!isRecord(entry) || typeof entry.key !== "string" || !entry.key) {
        throw new TracePayloadError(
          `${location}.kvlistValue.values[${index}] must contain a key.`,
        );
      }
      return [
        entry.key,
        decodeAnyValue(
          entry.value,
          `${location}.kvlistValue.values[${index}].value`,
        ),
      ] as const;
    });
    return Object.fromEntries(entries);
  }
  throw new TracePayloadError(`${location} contains an unsupported AnyValue.`);
}

function parseAttributes(value: unknown, location: string) {
  const attributes = new Map<string, unknown>();
  for (const [index, item] of requireArray(value, location, true).entries()) {
    if (!isRecord(item) || typeof item.key !== "string" || !item.key.trim()) {
      throw new TracePayloadError(
        `${location}[${index}] must contain a non-empty key.`,
      );
    }
    const key = item.key.trim();
    if (attributes.has(key)) {
      throw new TracePayloadError(`${location} contains duplicate key "${key}".`);
    }
    attributes.set(
      key,
      decodeAnyValue(item.value, `${location}[${index}].value`),
    );
  }
  return attributes;
}

const IGNORED_CONTENT_KEYS = new Set([
  "finish_reason",
  "id",
  "index",
  "name",
  "role",
  "tool_call_id",
  "type",
]);

function collectText(value: unknown, depth = 0): string[] {
  if (depth > 12 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const nested = collectText(parsed, depth + 1);
        if (nested.length) return nested;
      } catch {
        // A text response that merely resembles JSON is still valid content.
      }
    }
    return [trimmed];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [`${value}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectText(item, depth + 1));
  }
  if (!isRecord(value)) return [];

  const prioritizedKeys = ["text", "content", "message", "parts", "output_text"];
  const prioritized = prioritizedKeys.flatMap((key) =>
    key in value ? collectText(value[key], depth + 1) : [],
  );
  if (prioritized.length) return prioritized;

  return Object.entries(value).flatMap(([key, item]) =>
    IGNORED_CONTENT_KEYS.has(key) ? [] : collectText(item, depth + 1),
  );
}

function attributeText(attributes: AttributeMap, keys: readonly string[]) {
  for (const key of keys) {
    if (!attributes.has(key)) continue;
    const parts = collectText(attributes.get(key));
    if (parts.length) return parts.join("\n");
  }
  return null;
}

function combinedAttributeText(
  span: ParsedSpan,
  keys: readonly string[],
) {
  return (
    attributeText(span.attributes, keys) ??
    attributeText(span.resourceAttributes, keys)
  );
}

function parseTimestamp(value: unknown) {
  if (
    (typeof value === "string" && /^\d+$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  ) {
    return BigInt(value);
  }
  return null;
}

function flattenSpans(input: unknown) {
  if (!isRecord(input)) {
    throw new TracePayloadError("OTLP trace payload must be a JSON object.");
  }
  const resourceSpans = requireArray(input.resourceSpans, "resourceSpans");
  const spans: ParsedSpan[] = [];
  let inputIndex = 0;

  resourceSpans.forEach((resourceEntry, resourceIndex) => {
    if (!isRecord(resourceEntry)) {
      throw new TracePayloadError(
        `resourceSpans[${resourceIndex}] must be an object.`,
      );
    }
    const resource = isRecord(resourceEntry.resource)
      ? resourceEntry.resource
      : {};
    const resourceAttributes = parseAttributes(
      resource.attributes,
      `resourceSpans[${resourceIndex}].resource.attributes`,
    );
    const scopeSpans = requireArray(
      resourceEntry.scopeSpans ?? resourceEntry.instrumentationLibrarySpans,
      `resourceSpans[${resourceIndex}].scopeSpans`,
    );

    scopeSpans.forEach((scopeEntry, scopeIndex) => {
      if (!isRecord(scopeEntry)) {
        throw new TracePayloadError(
          `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}] must be an object.`,
        );
      }
      requireArray(
        scopeEntry.spans,
        `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}].spans`,
      ).forEach((spanEntry, spanIndex) => {
        const location =
          `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}]` +
          `.spans[${spanIndex}]`;
        if (!isRecord(spanEntry)) {
          throw new TracePayloadError(`${location} must be an object.`);
        }
        if (typeof spanEntry.name !== "string" || !spanEntry.name.trim()) {
          throw new TracePayloadError(`${location}.name must be non-empty.`);
        }
        const traceId = normalizeTraceId(spanEntry.traceId, `${location}.traceId`);
        const spanId = normalizeSpanId(spanEntry.spanId, `${location}.spanId`)!;
        const parentSpanId = normalizeSpanId(
          spanEntry.parentSpanId,
          `${location}.parentSpanId`,
          true,
        );
        const links = requireArray(spanEntry.links, `${location}.links`, true);
        const linkedSpanIds = links.flatMap((link, linkIndex) => {
          if (!isRecord(link)) {
            throw new TracePayloadError(
              `${location}.links[${linkIndex}] must be an object.`,
            );
          }
          if (
            normalizeTraceId(
              link.traceId,
              `${location}.links[${linkIndex}].traceId`,
            ) !== traceId
          ) {
            return [];
          }
          const linked = normalizeSpanId(
            link.spanId,
            `${location}.links[${linkIndex}].spanId`,
          );
          return linked ? [linked] : [];
        });
        spans.push({
          traceId,
          spanId,
          parentSpanId,
          name: spanEntry.name.trim(),
          startTimeUnixNano: parseTimestamp(spanEntry.startTimeUnixNano),
          attributes: parseAttributes(
            spanEntry.attributes,
            `${location}.attributes`,
          ),
          resourceAttributes,
          linkedSpanIds,
          inputIndex,
        });
        inputIndex += 1;
      });
    });
  });

  if (!spans.length) {
    throw new TracePayloadError("OTLP trace payload contains no spans.");
  }
  return spans;
}

function selectedAncestor(
  spanId: string | null,
  spanById: ReadonlyMap<string, ParsedSpan>,
  selectedSpanIds: ReadonlySet<string>,
) {
  const visited = new Set<string>();
  let current = spanId;
  while (current) {
    if (visited.has(current)) {
      throw new TracePayloadError("OTLP span parent links contain a cycle.");
    }
    visited.add(current);
    if (selectedSpanIds.has(current)) return current;
    current = spanById.get(current)?.parentSpanId ?? null;
  }
  return null;
}

function normalizedOptionText(
  value: string | undefined,
  field: string,
  limit: number,
) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TracePayloadError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > limit) {
    throw new TracePayloadError(`${field} exceeds ${limit} characters.`);
  }
  return normalized || undefined;
}

export function parseOtlpTracePayload(
  input: unknown,
  options: OtlpLineageOptions = {},
): NormalizedOtlpLineageTrace {
  if (!isRecord(options)) {
    throw new TracePayloadError("OTLP lineage options must be an object.");
  }
  const outputKeys = normalizeAttributeKeys(
    options.outputAttributeKeys,
    DEFAULT_OUTPUT_KEYS,
    "options.outputAttributeKeys",
  );
  const sourceKeys = normalizeAttributeKeys(
    options.sourceAttributeKeys,
    DEFAULT_SOURCE_KEYS,
    "options.sourceAttributeKeys",
  );
  const labelKeys = normalizeAttributeKeys(
    options.labelAttributeKeys,
    DEFAULT_LABEL_KEYS,
    "options.labelAttributeKeys",
  );
  const guardrailKeys = normalizeAttributeKeys(
    options.guardrailAttributeKeys,
    DEFAULT_GUARDRAIL_KEYS,
    "options.guardrailAttributeKeys",
  );
  const workflowKeys = normalizeAttributeKeys(
    options.workflowAttributeKeys,
    DEFAULT_WORKFLOW_KEYS,
    "options.workflowAttributeKeys",
  );
  const allSpans = flattenSpans(input);
  const availableTraceIds = [...new Set(allSpans.map((span) => span.traceId))];
  const requestedTraceId = options.traceId
    ? normalizeTraceId(options.traceId, "options.traceId")
    : null;
  if (!requestedTraceId && availableTraceIds.length !== 1) {
    throw new TracePayloadError(
      "OTLP payload contains multiple traces; provide options.traceId.",
    );
  }
  const traceId = requestedTraceId ?? availableTraceIds[0];
  const traceSpans = allSpans.filter((span) => span.traceId === traceId);
  if (!traceSpans.length) {
    throw new TracePayloadError(`OTLP trace "${traceId}" was not found.`);
  }

  const spanById = new Map<string, ParsedSpan>();
  traceSpans.forEach((span) => {
    if (spanById.has(span.spanId)) {
      throw new TracePayloadError(
        `OTLP trace contains duplicate span id "${span.spanId}".`,
      );
    }
    spanById.set(span.spanId, span);
  });

  const selected = traceSpans
    .map((span) => ({
      span,
      output: combinedAttributeText(span, outputKeys),
    }))
    .filter(
      (candidate): candidate is { span: ParsedSpan; output: string } =>
        candidate.output !== null,
    )
    .sort((left, right) => {
      const leftTime = left.span.startTimeUnixNano;
      const rightTime = right.span.startTimeUnixNano;
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return leftTime < rightTime ? -1 : 1;
      }
      return left.span.inputIndex - right.span.inputIndex;
    });
  if (!selected.length) {
    throw new TracePayloadError(
      `No spans contain an output attribute (${outputKeys.join(", ")}).`,
    );
  }

  const selectedSpanIds = new Set(selected.map(({ span }) => span.spanId));
  const explicitSource = normalizedOptionText(
    options.sourceText,
    "options.sourceText",
    TRACE_LIMITS.stageTextCharacters,
  );
  const explicitSourceLabel =
    normalizedOptionText(
      options.sourceLabel,
      "options.sourceLabel",
      TRACE_LIMITS.labelCharacters,
    ) ?? "Authoritative input";
  const nodes: TraceGraphStage[] = [];

  selected.forEach(({ span, output }) => {
    const parentIds = new Set<string>();
    const parent = selectedAncestor(
      span.parentSpanId,
      spanById,
      selectedSpanIds,
    );
    if (parent) parentIds.add(parent);
    span.linkedSpanIds.forEach((linkedSpanId) => {
      const linked = selectedAncestor(
        linkedSpanId,
        spanById,
        selectedSpanIds,
      );
      if (linked && linked !== span.spanId) parentIds.add(linked);
    });

    if (!parentIds.size) {
      const sourceText =
        explicitSource ?? combinedAttributeText(span, sourceKeys);
      if (!sourceText) {
        throw new TracePayloadError(
          `Root output span "${span.spanId}" needs options.sourceText or one of ` +
            `${sourceKeys.join(", ")}.`,
        );
      }
      const sourceId = `source-${span.spanId}`;
      nodes.push({
        id: sourceId,
        label: explicitSourceLabel,
        text: sourceText,
        parentIds: [],
      });
      parentIds.add(sourceId);
    }

    nodes.push({
      id: span.spanId,
      label: combinedAttributeText(span, labelKeys) ?? span.name,
      text: output,
      parentIds: [...parentIds],
    });
  });

  if (nodes.length > TRACE_LIMITS.stages) {
    throw new TracePayloadError(
      `Selected OTLP trace expands to more than ${TRACE_LIMITS.stages} lineage nodes.`,
    );
  }

  const guardrail =
    normalizedOptionText(
      options.guardrail,
      "options.guardrail",
      TRACE_LIMITS.guardrailCharacters,
    ) ??
    selected
      .map(({ span }) => combinedAttributeText(span, guardrailKeys))
      .find((value): value is string => value !== null) ??
    "";
  const runName =
    normalizedOptionText(
      options.runName,
      "options.runName",
      TRACE_LIMITS.runNameCharacters,
    ) ??
    selected
      .map(({ span }) => combinedAttributeText(span, workflowKeys))
      .find((value): value is string => value !== null) ??
    `OTLP trace ${traceId.slice(0, 8)}`;

  return {
    traceId,
    runName,
    guardrail,
    nodes,
    selectedSpanIds: selected.map(({ span }) => span.spanId),
  };
}

export function runOtlpReliabilityPipeline(
  input: unknown,
  options: OtlpLineageOptions & ReliabilityGraphOptions = {},
) {
  const normalized = parseOtlpTracePayload(input, options);
  return runReliabilityGraphPipeline(
    normalized.nodes,
    normalized.guardrail,
    {
      blockAtOrAbove: options.blockAtOrAbove,
      rules: options.rules,
    },
  );
}
