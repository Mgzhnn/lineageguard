import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOtlpTracePayload,
  runOtlpReliabilityPipeline,
} from "../sdk/otel.ts";
import { TracePayloadError } from "../lib/trace-schema.ts";

const TRACE_ID = "a".repeat(32);
const ROOT_SPAN_ID = "1".repeat(16);
const CHILD_SPAN_ID = "2".repeat(16);

function attribute(key: string, stringValue: string) {
  return { key, value: { stringValue } };
}

function otlpFixture() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [attribute("service.name", "support-agents")],
        },
        scopeSpans: [
          {
            scope: { name: "agent-runtime" },
            spans: [
              {
                traceId: TRACE_ID,
                spanId: ROOT_SPAN_ID,
                parentSpanId: "",
                name: "research-agent",
                startTimeUnixNano: "100",
                attributes: [
                  attribute(
                    "gen_ai.input.messages",
                    JSON.stringify([
                      {
                        role: "user",
                        parts: [
                          {
                            type: "text",
                            content:
                              "A pilot suggests some users may improve by 12–18%.",
                          },
                        ],
                      },
                    ]),
                  ),
                  attribute(
                    "gen_ai.output.messages",
                    JSON.stringify([
                      {
                        role: "assistant",
                        parts: [
                          {
                            type: "text",
                            content:
                              "A pilot suggests some users may improve by 12–18%.",
                          },
                        ],
                      },
                    ]),
                  ),
                  attribute("gen_ai.workflow.name", "Support workflow"),
                  attribute(
                    "lineageguard.guardrail",
                    "Preserve uncertainty and the complete range.",
                  ),
                ],
              },
              {
                traceId: TRACE_ID,
                spanId: CHILD_SPAN_ID,
                parentSpanId: ROOT_SPAN_ID,
                name: "writer-agent",
                startTimeUnixNano: "200",
                attributes: [
                  attribute(
                    "gen_ai.output.messages",
                    JSON.stringify([
                      {
                        role: "assistant",
                        parts: [
                          {
                            type: "text",
                            content:
                              "The pilot proves all users improve by 18%.",
                          },
                        ],
                      },
                    ]),
                  ),
                  attribute("lineageguard.agent.name", "Writer"),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

test("converts OTLP/JSON GenAI spans into a lineage graph", () => {
  const trace = parseOtlpTracePayload(otlpFixture());

  assert.equal(trace.traceId, TRACE_ID);
  assert.equal(trace.runName, "Support workflow");
  assert.equal(trace.nodes.length, 3);
  assert.deepEqual(
    trace.nodes.map((node) => node.id),
    [`source-${ROOT_SPAN_ID}`, ROOT_SPAN_ID, CHILD_SPAN_ID],
  );
  assert.deepEqual(trace.nodes[2].parentIds, [ROOT_SPAN_ID]);
  assert.equal(trace.nodes[2].label, "Writer");
});

test("detects mutation in OTLP output spans", () => {
  const report = runOtlpReliabilityPipeline(otlpFixture());

  assert.equal(
    report.firstBlockingEdgeId,
    `${ROOT_SPAN_ID}->${CHILD_SPAN_ID}`,
  );
  assert.equal(report.recovery.retryNodeLabel, "Writer");
  assert.ok(
    report.issues.some(
      (issue) =>
        issue.type === "number" ||
        issue.type === "certainty" ||
        issue.type === "quantifier",
    ),
  );
});

test("requires explicit trace selection for an OTLP batch", () => {
  const fixture = otlpFixture();
  const secondTraceId = "b".repeat(32);
  fixture.resourceSpans[0].scopeSpans[0].spans.push({
    traceId: secondTraceId,
    spanId: "3".repeat(16),
    parentSpanId: "",
    name: "other-agent",
    startTimeUnixNano: "300",
    attributes: [
      attribute("lineageguard.source", "A separate source."),
      attribute("lineageguard.output", "A separate source."),
    ],
  });

  assert.throws(
    () => parseOtlpTracePayload(fixture),
    /multiple traces/i,
  );
  assert.equal(
    parseOtlpTracePayload(fixture, { traceId: secondTraceId }).traceId,
    secondTraceId,
  );
});

test("fails closed when an OTLP root output has no authoritative input", () => {
  const fixture = otlpFixture();
  fixture.resourceSpans[0].scopeSpans[0].spans[0].attributes =
    fixture.resourceSpans[0].scopeSpans[0].spans[0].attributes.filter(
      (item) => item.key !== "gen_ai.input.messages",
    );

  assert.throws(
    () => parseOtlpTracePayload(fixture),
    /needs options\.sourceText/i,
  );
});

test("rejects malformed OTLP identifiers", () => {
  const fixture = otlpFixture();
  fixture.resourceSpans[0].scopeSpans[0].spans[0].traceId = "not-a-trace";

  assert.throws(
    () => parseOtlpTracePayload(fixture),
    TracePayloadError,
  );
});

test("validates custom OTLP attribute-key options", () => {
  assert.throws(
    () =>
      parseOtlpTracePayload(otlpFixture(), {
        outputAttributeKeys: ["lineageguard.output", "lineageguard.output"],
      }),
    /duplicate key/i,
  );
  assert.throws(
    () =>
      parseOtlpTracePayload(otlpFixture(), {
        sourceAttributeKeys: "lineageguard.source" as never,
      }),
    /must be an array/i,
  );
  assert.throws(
    () => parseOtlpTracePayload(otlpFixture(), null as never),
    /options must be an object/i,
  );
});

test("ignores non-text output parts such as tool calls", () => {
  const fixture = otlpFixture();
  const child = fixture.resourceSpans[0].scopeSpans[0].spans[1];
  child.attributes = [
    attribute(
      "gen_ai.output.messages",
      JSON.stringify([
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              id: "call-1",
              name: "send_email",
              arguments: {
                to: "customer@example.com",
                body: "The pilot proves all users improve by 18%.",
              },
            },
          ],
        },
      ]),
    ),
    attribute("lineageguard.agent.name", "Writer"),
  ];

  const trace = parseOtlpTracePayload(fixture);
  assert.deepEqual(
    trace.nodes.map((node) => node.id),
    [`source-${ROOT_SPAN_ID}`, ROOT_SPAN_ID],
  );
  assert.ok(
    trace.nodes.every(
      (node) =>
        !node.text.includes("customer@example.com") &&
        !node.text.includes("send_email") &&
        !node.text.includes("proves"),
    ),
  );
});

test("keeps a JSON-shaped assistant answer as raw text", () => {
  const fixture = otlpFixture();
  const child = fixture.resourceSpans[0].scopeSpans[0].spans[1];
  child.attributes[0] = attribute(
    "gen_ai.output.messages",
    JSON.stringify([
      {
        role: "assistant",
        parts: [{ type: "text", content: '{"approved": true, "name": "Bob"}' }],
      },
    ]),
  );
  assert.equal(
    parseOtlpTracePayload(fixture).nodes[2].text,
    '{"approved": true, "name": "Bob"}',
  );

  // A message wrapper is still unwrapped; only its text parts contribute.
  child.attributes[0] = attribute(
    "gen_ai.output.messages",
    JSON.stringify([
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "reasoning", summary: "private chain of thought" },
          { type: "output_text", text: "The pilot proves all users improve by 18%." },
        ],
      },
    ]),
  );
  assert.equal(
    parseOtlpTracePayload(fixture).nodes[2].text,
    "The pilot proves all users improve by 18%.",
  );
});
