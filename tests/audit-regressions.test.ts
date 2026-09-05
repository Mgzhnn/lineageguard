import assert from "node:assert/strict";
import test from "node:test";
import { authorizeEvaluationRequest } from "../lib/api-security.ts";
import { analyzeLineage, getTraceSignalSnapshot } from "../lib/analysis.ts";
import { fingerprintValue } from "../lib/fingerprint.ts";
import { parseTraceGraphPayload, runReliabilityGraphPipeline } from "../lib/graph.ts";
import { parseTracePayload, TracePayloadError } from "../lib/trace-schema.ts";
import { parseOtlpTracePayload } from "../sdk/otel.ts";
import { LineageGuardSession } from "../sdk/runtime.ts";
import { runReliabilityPipeline } from "../lib/pipeline.ts";
import { requireCurrentReport } from "../app/lineageguard/report-state.ts";

test("AUD-01: inherited object properties never authenticate a tenant", () => {
  const original = process.env.LINEAGEGUARD_API_KEYS_JSON;
  process.env.LINEAGEGUARD_API_KEYS_JSON = '{"real-tenant":"fixture-secret"}';
  try {
    const result = authorizeEvaluationRequest(new Request("https://fixture.example/api/evaluate", {
      headers: { "x-lineageguard-tenant": "__proto__", authorization: "Bearer [object Object]" },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  } finally {
    if (original === undefined) delete process.env.LINEAGEGUARD_API_KEYS_JSON;
    else process.env.LINEAGEGUARD_API_KEYS_JSON = original;
  }
});

test("AUD-01: a loopback URL is not production authentication", () => {
  const keys = process.env.LINEAGEGUARD_API_KEYS_JSON;
  const mode = process.env.NODE_ENV;
  delete process.env.LINEAGEGUARD_API_KEYS_JSON;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    assert.equal(authorizeEvaluationRequest(new Request("http://localhost/api/evaluate")).ok, false);
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.equal(authorizeEvaluationRequest(new Request("http://localhost/api/evaluate")).ok, true);
  } finally {
    if (keys === undefined) delete process.env.LINEAGEGUARD_API_KEYS_JSON;
    else process.env.LINEAGEGUARD_API_KEYS_JSON = keys;
    if (mode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: mode });
  }
});

const collisionPairs: [unknown, unknown][] = [
  [undefined, { $undefined: true }], [NaN, { $number: "NaN" }],
  [new Date("2026-01-01"), { $date: "2026-01-01T00:00:00.000Z" }],
  [new Uint8Array([1, 2]), { $bytes: [1, 2] }], [BigInt(1), { $bigint: "1" }],
];
for (const [index, [left, right]] of collisionPairs.entries()) {
  test(`AUD-02: typed values cannot collide with user records (${index})`, () => {
    assert.notEqual(fingerprintValue(left), fingerprintValue(right));
  });
}

test("AUD-02: sparse arrays cannot impersonate arrays of null", () => {
  assert.notEqual(fingerprintValue(Array(1)), fingerprintValue([null]));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("AUD-03: execution uses the input actually approved across an await", async () => {
  const ready = deferred<boolean>();
  const guard = new LineageGuardSession({ approvalVerifier: () => ready.promise })
    .recordSource("Source", "The amount is 5.");
  const input = { amount: 5 };
  const result = guard.executeTool({ toolName: "send", action: "Send", input,
    sideEffect: true, approval: { token: "fixture", approvedBy: "reviewer" } }, (value) => value.amount);
  input.amount = 5000;
  ready.resolve(true);
  assert.equal(await result, 5);
});

test("AUD-04: a freeze while approval is pending prevents execution", async () => {
  const ready = deferred<boolean>();
  const guard = new LineageGuardSession({ approvalVerifier: () => ready.promise })
    .recordSource("Source", "The amount is 5.");
  let executions = 0;
  const result = guard.executeTool({ toolName: "send", action: "Send", input: 5,
    sideEffect: true, approval: { token: "fixture", approvedBy: "reviewer" } }, () => { executions++; });
  guard.inspectHandoff("writer", "Writer", "The amount is 5000.");
  ready.resolve(true);
  await assert.rejects(result, /frozen|changed/i);
  assert.equal(executions, 0);
});

test("AUD-04: synchronous authorization cannot execute after a same-tick freeze", async () => {
  const guard = new LineageGuardSession().recordSource("Source", "The amount is 5.");
  let executions = 0;
  const result = guard.executeTool({ toolName: "read", action: "Read", sideEffect: false }, () => { executions++; });
  guard.inspectHandoff("writer", "Writer", "The amount is 5000.");
  await assert.rejects(result, /frozen|changed/i);
  assert.equal(executions, 0);
});

test("AUD-05: concurrent semantic handoffs cannot attach findings to another edge", async () => {
  const slow = deferred<null>();
  const guard = new LineageGuardSession({ semanticJudge: ({ agentId }) => agentId === "first" ? slow.promise : null })
    .recordSource("Source", "A stable claim.");
  const first = guard.inspectHandoffAsync("first", "First", "A stable claim.");
  const second = guard.inspectHandoffAsync("second", "Second", "A stable claim.");
  const rejected = assert.rejects(second, /in progress|serial|concurrent/i);
  slow.resolve(null);
  await first;
  await rejected;
  assert.equal(guard.getTrace().length, 2);
});

test("AUD-06: snapshots cannot lose a pending one-time approval reservation", async () => {
  const ready = deferred<boolean>();
  const guard = new LineageGuardSession({ approvalVerifier: () => ready.promise })
    .recordSource("Source", "A stable claim.");
  const operation = guard.executeTool({ toolName: "send", action: "Send", sideEffect: true,
    approval: { token: "fixture", approvedBy: "reviewer" } }, () => "sent");
  let threw = false;
  try { guard.toSnapshot(); } catch { threw = true; }
  ready.resolve(true);
  await operation;
  assert.equal(threw, true, "checkpoint must wait until pending operations settle");
});

test("AUD-07: callers cannot edit an internal recovery checkpoint through getReport", () => {
  const guard = new LineageGuardSession().recordSource("Source", "The amount is 5.");
  guard.inspectHandoff("writer", "Writer", "The amount is 5000.");
  const report = guard.getReport();
  report.recovery.restartStageIndex = null;
  assert.equal(guard.resetToLastVerified().text, "The amount is 5.");
});

const pair = (before: string, after: string) => analyzeLineage([
  { id: "source", label: "Source", text: before }, { id: "child", label: "Child", text: after },
]);
for (const [before, after] of [
  ["The change is -5%.", "The change is 5%."],
  ["The change is −5%.", "The change is 5%."],
  ["The value is 1.2345678901234.", "The value is 1.2345678901235."],
  ["The budget is ５０００.", "The budget is ５００００."],
]) {
  test(`AUD-08: numeric mutation is detected: ${before}`, () => {
    assert.ok(pair(before, after).issues.some((issue) => issue.type === "number"));
  });
}
test("AUD-08: equivalent metric ranges compare equal", () => {
  assert.deepEqual(getTraceSignalSnapshot("Dose: 500–1000mg.").numbers,
    getTraceSignalSnapshot("Dose: 0.5–1g.").numbers);
});
test("AUD-08: percent and percentage points remain distinct", () => {
  assert.ok(pair("Change: 5 percent.", "Change: 5 percentage points.").issues.some((issue) => issue.type === "number"));
});

const branches = [
  { id: "root", label: "Root", text: "The amount is 5.", parentIds: [] },
  { id: "a", label: "A", text: "The amount is 50.", parentIds: ["root"] },
  { id: "b", label: "B", text: "The amount is 500.", parentIds: ["root"] },
  { id: "b-child", label: "B child", text: "The amount is 500.", parentIds: ["b"] },
];
test("AUD-09: every broken branch and descendant is contaminated", () => {
  const result = runReliabilityGraphPipeline(branches);
  assert.deepEqual(new Set(result.recovery.contaminatedNodeIds), new Set(["a", "b", "b-child"]));
  assert.notEqual(result.nodes.find((node) => node.id === "b")?.state, "verified");
});
test("AUD-10: graph results are invariant under node permutation", () => {
  const original = runReliabilityGraphPipeline(branches);
  const reversed = runReliabilityGraphPipeline([...branches].reverse());
  assert.equal(original.firstBlockingEdgeId, reversed.firstBlockingEdgeId);
  assert.equal(original.fingerprint, reversed.fingerprint);
});
test("AUD-11: an edgeless graph is rejected", () => {
  assert.throws(() => parseTraceGraphPayload({ schemaVersion: "1.1", nodes: branches.slice(0, 2).map((node) => ({ ...node, parentIds: [] })) }), TracePayloadError);
});
test("AUD-11: prototype-like parent ids do not become inherited claim projections", () => {
  const result = runReliabilityGraphPipeline([
    { id: "__proto__", label: "Root", text: "The amount is 5.", parentIds: [] },
    { id: "child", label: "Child", text: "The amount is 50.", parentIds: ["__proto__"], inheritedClaims: {} },
  ]);
  assert.ok(result.firstBlockingEdgeId);
});
test("AUD-11: malformed Unicode ids are rejected by the importer", () => {
  assert.throws(() => parseTracePayload({ stages: [
    { id: "\ud800", label: "Root", text: "Claim." }, { id: "child", label: "Child", text: "Claim." },
  ] }), TracePayloadError);
});

const otlp = (value: unknown, extra: Record<string, unknown> = {}) => ({ resourceSpans: [{ scopeSpans: [{ spans: [{
  traceId: "1234567890abcdef1234567890abcdef", spanId: "1111111111111111", name: "Agent", ...extra,
  attributes: [{ key: "lineageguard.source", value: { stringValue: "Claim." } }, { key: "lineageguard.output", value }],
}] }] }] });
test("AUD-12: cyclic AnyValue returns a validation error", () => {
  const value: { arrayValue: { values: unknown[] } } = { arrayValue: { values: [] } };
  value.arrayValue.values.push(value);
  assert.throws(() => parseOtlpTracePayload(otlp(value)), TracePayloadError);
});
test("AUD-12: OTLP parser itself rejects invalid graph topology", () => {
  assert.throws(() => parseOtlpTracePayload(otlp({ stringValue: "Claim." }, { parentSpanId: "1111111111111111" })), TracePayloadError);
});
test("AUD-12: duplicate nested attribute keys are rejected", () => {
  assert.throws(() => parseOtlpTracePayload(otlp({ kvlistValue: { values: [
    { key: "content", value: { stringValue: "first" } }, { key: "content", value: { stringValue: "second" } },
  ] } })), TracePayloadError);
});

test("AUD-14: exports reject changed text, labels, guardrails and removed stages", () => {
  const stages = branches.slice(0, 2).map(({ id, label, text }) => ({ id, label, text }));
  const report = runReliabilityPipeline(stages, "Keep the amounts.");
  assert.doesNotThrow(() => requireCurrentReport(report, stages, "Keep the amounts."));
  for (const changes of [{ label: "Edited" }, { text: "The amount is 5000." }]) {
    assert.throws(() => requireCurrentReport(report, [stages[0], { ...stages[1], ...changes }], "Keep the amounts."), /again/);
  }
  assert.throws(() => requireCurrentReport(report, stages.slice(0, 1), "Keep the amounts."), /again/);
  assert.throws(() => requireCurrentReport(report, stages, "Changed rule."), /again/);
});

test("AUD-02: fingerprinting never invokes array accessors", () => {
  let reads = 0;
  const values: unknown[] = [];
  Object.defineProperty(values, "0", { enumerable: true, get: () => { reads++; return 1; } });
  assert.throws(() => fingerprintValue(values), /accessor/i);
  assert.equal(reads, 0);
});

test("AUD-02: built-in value properties cannot disappear from approval scope", () => {
  assert.throws(() => fingerprintValue(Object.assign(new Date(), { amount: 5 })), /custom properties/i);
  assert.throws(() => fingerprintValue(Object.assign(new Uint8Array([1]), { amount: 5 })), /custom properties/i);
  class CustomArray extends Array<number> {}
  assert.throws(() => fingerprintValue(new CustomArray(1, 2)), /subclasses/i);
});

test("AUD-03: shared memory cannot remain mutable after input capture", async () => {
  const guard = new LineageGuardSession().recordSource("Source", "Read bytes.");
  let calls = 0;
  await assert.rejects(guard.executeTool({ toolName: "read", action: "Read", sideEffect: false,
    input: new Uint8Array(new SharedArrayBuffer(4)) }, () => { calls++; }), /shared bytes/i);
  assert.equal(calls, 0);
});

test("AUD-04: an already-running verifier is invalidated by a freeze and recovery", async () => {
  const ready = deferred<boolean>();
  const started = deferred<void>();
  const guard = new LineageGuardSession({ approvalVerifier: () => { started.resolve(); return ready.promise; } })
    .recordSource("Source", "The amount is 5.");
  let executions = 0;
  const result = guard.executeTool({ toolName: "send", action: "Send", sideEffect: true,
    approval: { token: "fixture", approvedBy: "reviewer" } }, () => { executions++; });
  await started.promise;
  guard.inspectHandoff("writer", "Writer", "The amount is 50.");
  guard.resetToLastVerified();
  ready.resolve(true);
  await assert.rejects(result, /changed|frozen/i);
  assert.equal(executions, 0);
});

test("AUD-07: editing a returned decision or snapshot cannot forge cached approval", () => {
  const guard = new LineageGuardSession().recordSource("Source", "The amount is 5.");
  const decision = guard.inspectHandoff("writer", "Writer", "The amount is 50.", { idempotencyKey: "writer" });
  decision.status = "allowed";
  const snapshot = guard.toSnapshot();
  snapshot.handoffRequests[0].decision.status = "allowed";
  assert.equal(guard.inspectHandoff("writer", "Writer", "The amount is 50.", { idempotencyKey: "writer" }).status, "blocked");
});

test("AUD-05: concurrent agents are rejected before the second callback runs", async () => {
  const done = deferred<string>();
  const guard = new LineageGuardSession().recordSource("Source", "Claim.");
  const first = guard.runAgent({ id: "a", name: "A", execute: () => done.promise }, {});
  let calls = 0;
  await assert.rejects(guard.runAgent({ id: "b", name: "B", execute: () => { calls++; return "Claim."; } }, {}), /serial/i);
  done.resolve("Claim.");
  await first;
  assert.equal(calls, 0);
});

test("AUD-10: incoming parent order does not change graph receipts", () => {
  const nodes = [branches[0], { ...branches[0], id: "other" },
    { ...branches[1], parentIds: ["root", "other"] }];
  assert.equal(runReliabilityGraphPipeline(nodes).fingerprint,
    runReliabilityGraphPipeline(nodes.map((node) => ({ ...node, parentIds: [...node.parentIds].reverse() }))).fingerprint);
});

test("AUD-11: raw graph wrong types produce validation errors", () => {
  assert.throws(() => runReliabilityGraphPipeline([{ ...branches[0], text: 1 }, branches[1]] as never), TracePayloadError);
  assert.throws(() => parseTracePayload({ stages: [], events: "invalid" }), TracePayloadError);
});

test("AUD-12: ambiguous AnyValue variants are rejected", () => {
  assert.throws(() => parseOtlpTracePayload(otlp({ stringValue: "Claim.", intValue: "12" })), TracePayloadError);
});
