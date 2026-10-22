// Detector gaps found in the 2026-10-22 review. Each case passed silently (or
// was mis-read) before the fix.
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLineage } from "../lib/analysis.ts";
import { runReliabilityGraphPipeline } from "../lib/graph.ts";

const pair = (source: string, output: string, guardrail = "") =>
  analyzeLineage(
    [
      { id: "source", label: "Source", text: source },
      { id: "agent", label: "Agent", text: output },
    ],
    guardrail,
  );
const titles = (source: string, output: string, guardrail = "") =>
  pair(source, output, guardrail).issues.map((issue) => `${issue.severity}:${issue.title}`);

test("an added negation that flips the claim is high", () => {
  assert.ok(titles("The vaccine is safe for children.", "The vaccine is not safe for children.")
    .includes("high:A negation was added"));
  assert.ok(titles("The drug was approved by the regulator.", "The drug was never approved by the regulator.")
    .includes("high:A negation was added"));
});

test("a negated action status is not a flipped claim", () => {
  assert.equal(pair("Prepare a customer email draft.", "Draft only: the customer email is ready but not sent.")
    .issues.some((issue) => issue.title === "A negation was added"), false);
});

test("numbers keep their units and suffixes", () => {
  for (const [a, b] of [
    ["Throughput improved 30x.", "Throughput improved 35x."],
    ["Latency was 40ms.", "Latency was 45ms."],
    ["Use 64GB nodes.", "Use 68GB nodes."],
    ["Revenue was $50bn.", "Revenue was $55bn."],
    ["Meet at 10am.", "Meet at 11am."],
    ["It was the 12th attempt.", "It was the 13th attempt."],
    ["The site is 5 miles away.", "The site is 5 feet away."],
    ["It is 5°C outside.", "It is 5°F outside."],
  ]) {
    assert.ok(titles(a, b).includes("high:Numeric claim changed"), `${a} -> ${b}`);
  }
});

test("a decimal comma is not a thousands separator", () => {
  assert.ok(titles("Give 1,5 mg daily.", "Give 15 mg daily.").includes("high:Numeric claim changed"));
  assert.ok(titles("Give 2,50 mg.", "Give 250 mg.").includes("high:Numeric claim changed"));
  assert.deepEqual(titles("We have 12,000 users.", "We have 12000 users."), []);
});

test("dropping a numeric bound changes the claim", () => {
  assert.ok(titles("Up to 40% of users saw it.", "40% of users saw it.").includes("high:Numeric claim changed"));
  assert.ok(titles("Fewer than 5% failed.", "5% failed.").includes("high:Numeric claim changed"));
  assert.deepEqual(titles("Up to 40% of users saw it.", "Up to 40 percent of users saw it."), []);
});

test("a capital M after digits is million, not metres", () => {
  assert.deepEqual(titles("We have 5M users.", "We have 5 million users."), []);
});

test("base verb forms and 'probably' are hedges", () => {
  assert.ok(titles("Studies suggest the drug works.", "Studies prove the drug works.")
    .includes("high:Confidence was inflated"));
  assert.ok(titles("Early data suggest the drug reduces mortality in adults.", "The drug reduces mortality in adults.")
    .some((title) => title.endsWith("A hedge was dropped")));
  assert.ok(titles("The outage was probably caused by the deploy.", "The outage was caused by the deploy.")
    .some((title) => title.endsWith("A hedge was dropped")));
});

test("a hedge in a trailing comma clause does not excuse an inflated claim", () => {
  assert.ok(titles(
    "The study suggests the drug reduces mortality.",
    "The study confirmed the drug reduces mortality, with possible mild side effects.",
  ).includes("high:Confidence was inflated"));
});

test("zero-width and full-width characters cannot hide a term", () => {
  for (const output of ["The study con​firmed it works.", "The study ｃｏｎｆｉｒｍｅｄ it works."]) {
    assert.ok(titles("The study suggests it works.", output).includes("high:Confidence was inflated"), output);
  }
  assert.ok(titles("Results hasnʼt been verified.", "Results have been verified.")
    .includes("high:A negative condition disappeared"));
});

test("a protected action after a dropped guardrail is still found", () => {
  const result = analyzeLineage(
    [
      { id: "s", label: "Source", text: "Draft an email to customers; do not send any email without human approval." },
      { id: "w", label: "Writer", text: "The draft is not final." },
      { id: "m", label: "Mailer", text: "I sent the email to the customers. The draft is not final." },
    ],
    "Do not send any email to customers without human approval.",
  );
  // The Writer drops the guardrail (medium); the Mailer then completes it.
  assert.ok(result.issues.some((issue) => issue.title === "Guardrail was not carried forward"));
  assert.equal(result.overallSeverity, "high");
  assert.ok(result.issues.some((issue) => issue.title === "Protected action appears completed"));
});

test("a guardrail outside language coverage is reported, not silently ignored", () => {
  const result = pair(
    "Prepare a reply to the customer complaint.",
    "I sent the email to the customers.",
    "고객에게 이메일을 보내지 마십시오. 승인 후에만 보낼 수 있습니다.",
  );
  assert.ok(result.issues.some((issue) => issue.title === "Guardrail language outside detector coverage"));
});

test("a merge node's own text is checked against the guardrail", () => {
  const run = runReliabilityGraphPipeline(
    [
      { id: "a", label: "Research A", text: "Plan A saves 10%.", parentIds: [] },
      { id: "b", label: "Research B", text: "Plan B saves 12%.", parentIds: [] },
      {
        id: "merge",
        label: "Merge",
        text: "Plan A saves 10%. Plan B saves 12%. I emailed all customers that everyone saves 50%.",
        parentIds: ["a", "b"],
        inheritedClaims: { a: "Plan A saves 10%.", b: "Plan B saves 12%." },
      },
    ],
    "Do not email customers without human approval.",
  );
  assert.notEqual(run.firstBlockingEdgeId, null);
  assert.ok(run.edges.some((edge) =>
    edge.issues.some((issue) => issue.title === "Protected action appears completed")));
});

// Group 2: engine cost, API decision, stage ids and failed logins.
import { runReliabilityPipeline } from "../lib/pipeline.ts";
import { parseTracePayload } from "../lib/trace-schema.ts";
import { authorizeEvaluationRequest, resetEvaluationRateLimits } from "../lib/api-security.ts";

test("a long stage of strong terms and hedges stays linear", () => {
  const started = performance.now();
  runReliabilityPipeline(
    [
      { id: "a", label: "A", text: "Summary." },
      { id: "b", label: "B", text: "may confirmed ".repeat(15_000) },
    ],
    "",
  );
  assert.ok(performance.now() - started < 3_000, "200 KB of 'may confirmed' took too long");
});

test("a long stage of action verbs under a guardrail stays linear", () => {
  const started = performance.now();
  runReliabilityPipeline(
    [
      { id: "a", label: "A", text: "Draft the email." },
      { id: "b", label: "B", text: "sent. ".repeat(60_000) },
    ],
    "Do not send email.",
  );
  assert.ok(performance.now() - started < 3_000, "360 KB of 'sent.' took too long");
});

test("with a blocking threshold the report's first break is the blocking transition", () => {
  const report = runReliabilityPipeline(
    [
      { id: "source", label: "Source", text: "The pilot suggests the tool may help some teams." },
      { id: "research", label: "Research", text: "The pilot suggests the tool may help some teams. It will ship next week." },
      { id: "summary", label: "Summary", text: "The pilot proves the tool helps all teams. It will ship next week." },
    ],
    "",
    { blockAtOrAbove: "high" },
  );
  const blocking = report.analysis.transitions.findIndex((transition) => transition.severity === "high");
  assert.ok(blocking > 0, "the test needs a below-threshold issue before the blocking one");
  assert.equal(report.ruleFamilyAgreement.transitionIndex, blocking);
  assert.equal(report.graph.nodes[blocking + 1].state, "first-break");
  assert.equal(report.graph.nodes[blocking].state, "verified");
});

test("generated stage ids never take an id the caller chose", () => {
  const parsed = parseTracePayload({
    stages: [
      { label: "First", text: "A claim." },
      { id: "stage-1", label: "Second", text: "A claim." },
    ],
  });
  assert.deepEqual(new Set(parsed.stages.map((stage) => stage.id)).size, 2);
  assert.equal(parsed.stages[1].id, "stage-1");
});

test("failed logins are rate-limited too", () => {
  const original = process.env.LINEAGEGUARD_API_KEYS_JSON;
  process.env.LINEAGEGUARD_API_KEYS_JSON = JSON.stringify({ "tenant-a": "strong-secret" });
  try {
    resetEvaluationRateLimits();
    const attempt = (token: string) => authorizeEvaluationRequest(
      new Request("https://public.example/api/evaluate", {
        headers: { authorization: `Bearer ${token}`, "x-lineageguard-tenant": "tenant-a" },
      }),
    );
    const statuses = Array.from({ length: 12 }, (_, i) => {
      const access = attempt(`guess-${i}`);
      return access.ok ? 200 : access.status;
    });
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.equal(statuses[10], 429);
  } finally {
    resetEvaluationRateLimits();
    if (original === undefined) delete process.env.LINEAGEGUARD_API_KEYS_JSON;
    else process.env.LINEAGEGUARD_API_KEYS_JSON = original;
  }
});

test("a deduplicated 128-character agent id still fits the id limit", () => {
  const agentId = "a".repeat(128);
  const parsed = parseTracePayload({
    events: [
      { type: "source", sequence: 0, agentId, agentName: "Source", content: "A claim.", timestamp: "2026-10-22T00:00:00Z" },
      { type: "handoff", sequence: 1, agentId, agentName: "Same agent", content: "A claim.", timestamp: "2026-10-22T00:00:01Z" },
    ],
  });
  assert.ok(parsed.stages.every((stage) => stage.id.length <= 128));
  assert.doesNotThrow(() => parseTracePayload({ stages: parsed.stages }));
});
