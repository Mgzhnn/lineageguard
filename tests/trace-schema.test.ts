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
