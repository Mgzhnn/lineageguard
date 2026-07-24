import assert from "node:assert/strict";
import test from "node:test";
import {
  createSampleTracePayload,
  parseTracePayload,
  TracePayloadError,
} from "../lib/trace-schema.ts";

test("normalizes an ordered event log into trace stages", () => {
  const payload = createSampleTracePayload();
  const parsed = parseTracePayload(payload);

  assert.equal(parsed.stages.length, 3);
  assert.equal(parsed.stages[0].label, "Source evidence");
  assert.equal(parsed.stages[2].id, "summary-agent");
  assert.match(parsed.guardrail, /human approval/i);
});

test("accepts the direct stages format", () => {
  const parsed = parseTracePayload({
    runName: "Direct trace",
    guardrail: "",
    stages: [
      { id: "s", label: "Source", text: "Some users may see 5%." },
      { id: "a", label: "Agent", text: "All users will see 5%." },
    ],
  });

  assert.equal(parsed.runName, "Direct trace");
  assert.deepEqual(
    parsed.stages.map((stage) => stage.id),
    ["s", "a"],
  );
});

test("rejects a handoff log without a source event", () => {
  assert.throws(
    () =>
      parseTracePayload({
        events: [
          {
            sequence: 0,
            type: "handoff",
            agentId: "a",
            agentName: "Agent",
            content: "Output",
          },
          {
            sequence: 1,
            type: "handoff",
            agentId: "b",
            agentName: "Agent B",
            content: "Output B",
          },
        ],
      }),
    TracePayloadError,
  );
});

test("rejects duplicate stage ids before building an ambiguous graph", () => {
  assert.throws(
    () =>
      parseTracePayload({
        stages: [
          { id: "same", label: "Source", text: "Source text." },
          { id: "same", label: "Agent", text: "Agent text." },
        ],
      }),
    /must be unique/i,
  );
});

test("creates unique stage instances when an event agent runs twice", () => {
  const parsed = parseTracePayload({
    events: [
      {
        sequence: 0,
        type: "source",
        agentId: "source",
        agentName: "Source",
        content: "Source text.",
      },
      {
        sequence: 1,
        type: "handoff",
        agentId: "reviewer",
        agentName: "Reviewer",
        content: "First pass.",
      },
      {
        sequence: 2,
        type: "handoff",
        agentId: "reviewer",
        agentName: "Reviewer",
        content: "Second pass.",
      },
    ],
  });

  assert.deepEqual(
    parsed.stages.map((stage) => stage.id),
    ["source", "reviewer", "reviewer-2"],
  );
});

test("rejects ambiguous trace shapes and additional source events", () => {
  assert.throws(
    () =>
      parseTracePayload({
        stages: [
          { label: "Source", text: "Source text." },
          { label: "Agent", text: "Agent text." },
        ],
        events: [],
      }),
    /exactly one/i,
  );

  assert.throws(
    () =>
      parseTracePayload({
        events: [
          {
            sequence: 0,
            type: "source",
            agentId: "source",
            agentName: "Source",
            content: "Source text.",
          },
          {
            sequence: 1,
            type: "source",
            agentId: "source-2",
            agentName: "Another source",
            content: "Another source text.",
          },
        ],
      }),
    /only the first event/i,
  );
});

test("rejects an unsupported schema version", () => {
  assert.throws(
    () =>
      parseTracePayload({
        schemaVersion: "2.0",
        stages: [
          { label: "Source", text: "Source text." },
          { label: "Agent", text: "Agent text." },
        ],
      }),
    /schemaVersion/i,
  );
});
