import assert from "node:assert/strict";
import test from "node:test";
import {
  LineageGuardBlockedError,
  LineageGuardSession,
  type RuntimeEvent,
} from "../sdk/index.ts";

test("blocks a broken handoff before a downstream agent runs", async () => {
  const calls: string[] = [];
  const events: RuntimeEvent[] = [];
  const guard = new LineageGuardSession({
    blockAtOrAbove: "medium",
    onEvent: (event) => events.push(event),
  }).recordSource(
    "Source",
    "A pilot suggests some users may improve by 12â€“18%. It is not confirmed.",
  );

  const result = await guard.runSequence(
    [
      {
        id: "writer",
        name: "Writing agent",
        execute: () => {
          calls.push("writer");
          return "The pilot proves all users improve by 18%.";
        },
      },
      {
        id: "publisher",
        name: "Publishing agent",
        execute: () => {
          calls.push("publisher");
          return "Published.";
        },
      },
    ],
    {},
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.blockedAgentId, "writer");
  assert.deepEqual(calls, ["writer"]);
  assert.equal(guard.isFrozen(), true);
  assert.equal(result.report.recovery.restartStageLabel, "Writing agent");
  assert.ok(events.some((event) => event.type === "handoff-blocked"));
});

test("never calls a side-effecting tool without approval", async () => {
  let executions = 0;
  const guard = new LineageGuardSession().recordSource(
    "Request",
    "Prepare an email draft.",
  );

  await assert.rejects(
    guard.executeTool(
      {
        toolName: "send-email",
        action: "Send the drafted email",
        input: { to: "customer@example.com" },
        sideEffect: true,
      },
      () => {
        executions += 1;
        return { sent: true };
      },
    ),
    (error: unknown) =>
      error instanceof LineageGuardBlockedError &&
      error.decision.status === "approval-required",
  );

  assert.equal(executions, 0);
});

test("allows read-only tools and approved external actions", async () => {
  const guard = new LineageGuardSession().recordSource(
    "Request",
    "Review the customer record and prepare a response.",
  );

  const record = await guard.executeTool(
    {
      toolName: "customer-record-read",
      action: "Read customer record",
      input: "CUS-42",
      sideEffect: false,
    },
    (customerId) => ({ customerId, tier: "standard" }),
  );
  const sent = await guard.executeTool(
    {
      toolName: "send-email",
      action: "Send approved response",
      input: "approved response",
      sideEffect: true,
      approvedBy: "reviewer@example.com",
    },
    (body) => ({ sent: true, body }),
  );

  assert.equal(record.customerId, "CUS-42");
  assert.equal(sent.sent, true);
});

test("restores a checkpoint and retries only the failed agent", async () => {
  const guard = new LineageGuardSession().recordSource(
    "Source",
    "The estimate may be 6% within 5 days.",
  );

  const blocked = guard.inspectHandoff(
    "summary",
    "Summary agent",
    "The estimate is proven to be 9% within 2 days.",
  );
  assert.equal(blocked.status, "blocked");

  const checkpoint = guard.resetToLastVerified();
  assert.equal(checkpoint.label, "Source");
  assert.equal(guard.isFrozen(), false);

  const corrected = guard.inspectHandoff(
    "summary",
    "Summary agent",
    "The estimate may be 6% within 5 days.",
  );
  assert.equal(corrected.status, "allowed");
  assert.equal(guard.getTrace().length, 2);
});

test("recovery targets the first blocking transition, not an allowed low signal", () => {
  const guard = new LineageGuardSession({
    blockAtOrAbove: "high",
  }).recordSource("Source", "Some users may save 5%.");

  const allowed = guard.inspectHandoff(
    "rewrite",
    "Rewrite agent",
    "Most users may save 5%.",
  );
  assert.equal(allowed.status, "allowed");

  const blocked = guard.inspectHandoff(
    "numbers",
    "Numbers agent",
    "Most users may save 20%.",
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.report.analysis.firstMutationIndex, 0);
  assert.equal(blocked.report.recovery.restartStageLabel, "Numbers agent");
});

test("supports the same agent running more than once in a loop", () => {
  const guard = new LineageGuardSession().recordSource(
    "Source",
    "The estimate may be 6%.",
  );

  guard.inspectHandoff("reviewer", "Reviewer", "The estimate may be 6%.");
  guard.inspectHandoff("reviewer", "Reviewer", "The estimate may be 6%.");

  assert.deepEqual(
    guard.getTrace().map((stage) => stage.id),
    ["source", "reviewer", "reviewer-2"],
  );
});

test("explicit deny policy overrides an approval", () => {
  const guard = new LineageGuardSession({
    toolPolicy: { deniedTools: ["shell-*"] },
  }).recordSource("Request", "Inspect the environment.");

  const decision = guard.authorizeTool({
    toolName: "shell-delete",
    action: "Delete files",
    sideEffect: true,
    approvedBy: "someone",
  });

  assert.equal(decision.status, "blocked");
});
