import assert from "node:assert/strict";
import test from "node:test";
import {
  LineageGuardBlockedError,
  LineageGuardDuplicateExecutionError,
  LineageGuardSession,
  type LineageGuardSessionSnapshot,
  type LineageGuardSnapshotStore,
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
    "A pilot suggests some users may improve by 12–18%. It is not confirmed.",
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
  const guard = new LineageGuardSession({
    approvalVerifier: ({ approval, toolName, action }) =>
      approval.token === "signed-approval" &&
      approval.approvedBy === "reviewer@example.com" &&
      toolName === "send-email" &&
      action === "Send approved response",
  }).recordSource(
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
      approval: {
        token: "signed-approval",
        approvedBy: "reviewer@example.com",
      },
    },
    (body) => ({ sent: true, body }),
  );

  assert.equal(record.customerId, "CUS-42");
  assert.equal(sent.sent, true);
});

test("sync approval preflight routes asynchronous verifiers to the async API", () => {
  const guard = new LineageGuardSession({
    approvalVerifier: () => Promise.resolve(true),
  }).recordSource("Request", "Prepare an email.");

  const decision = guard.authorizeTool({
    toolName: "send-email",
    action: "Send email",
    input: "message",
    sideEffect: true,
    approval: {
      token: "signed-approval",
      approvedBy: "reviewer@example.com",
    },
  });

  assert.equal(decision.status, "approval-required");
  assert.equal(decision.approvalVerified, false);
  assert.match(decision.reason, /authorizeToolAsync/);
});

test("awaits an asynchronous approval verifier before executing", async () => {
  let verifierCalls = 0;
  let executionCalls = 0;
  const guard = new LineageGuardSession({
    approvalVerifier: async ({ approval }) => {
      verifierCalls += 1;
      await Promise.resolve();
      return approval.token === "signed-approval";
    },
  }).recordSource("Request", "Prepare an email.");

  const result = await guard.executeTool(
    {
      toolName: "send-email",
      action: "Send email",
      input: "message",
      sideEffect: true,
      approval: {
        token: "signed-approval",
        approvedBy: "reviewer@example.com",
      },
    },
    (input) => {
      executionCalls += 1;
      return `sent:${input}`;
    },
  );

  assert.equal(result, "sent:message");
  assert.equal(verifierCalls, 1);
  assert.equal(executionCalls, 1);
});

test("reserves a one-time approval token during asynchronous verification", async () => {
  let releaseVerifier!: () => void;
  let markVerifierStarted!: () => void;
  const verifierStarted = new Promise<void>((resolve) => {
    markVerifierStarted = resolve;
  });
  const verifierReleased = new Promise<void>((resolve) => {
    releaseVerifier = resolve;
  });
  let executionCalls = 0;
  const guard = new LineageGuardSession({
    approvalVerifier: async () => {
      markVerifierStarted();
      await verifierReleased;
      return true;
    },
  }).recordSource("Request", "Prepare an email.");
  const intent = {
    toolName: "send-email",
    action: "Send email",
    input: "message",
    sideEffect: true,
    approval: {
      token: "one-time-token",
      approvedBy: "reviewer@example.com",
    },
  };

  const first = guard.executeTool(intent, () => {
    executionCalls += 1;
    return "sent";
  });
  await verifierStarted;

  await assert.rejects(
    guard.executeTool(intent, () => {
      executionCalls += 1;
      return "sent-again";
    }),
    (error: unknown) =>
      error instanceof LineageGuardBlockedError &&
      /already being verified or used/i.test(error.message),
  );

  releaseVerifier();
  assert.equal(await first, "sent");
  assert.equal(executionCalls, 1);
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
  assert.equal(allowed.report.recovery.status, "not-required");

  const blocked = guard.inspectHandoff(
    "numbers",
    "Numbers agent",
    "Most users may save 20%.",
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.report.analysis.firstMutationIndex, 0);
  assert.equal(blocked.report.recovery.restartStageLabel, "Numbers agent");

  const checkpoint = guard.resetToLastVerified();
  assert.equal(checkpoint.label, "Rewrite agent");
  assert.equal(guard.getTrace().length, 2);
  assert.equal(guard.getRecoveryPacket().status, "not-required");
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

test("blocks tools until an authoritative source is recorded", () => {
  const guard = new LineageGuardSession();

  const decision = guard.authorizeTool({
    toolName: "customer-record-read",
    action: "Read customer record",
    sideEffect: false,
  });

  assert.equal(decision.status, "blocked");
  assert.match(decision.reason, /authoritative source/i);
});

test("host policy can classify a mislabeled tool as side-effecting", () => {
  const guard = new LineageGuardSession({
    toolPolicy: { sideEffectTools: ["send-*"] },
  }).recordSource("Request", "Prepare a draft.");

  const decision = guard.authorizeTool({
    toolName: "send-email",
    action: "Send the draft",
    sideEffect: false,
  });

  assert.equal(decision.status, "approval-required");
  assert.equal(decision.intent.sideEffect, true);
});

test("does not accept a reviewer name as authorization", () => {
  const guard = new LineageGuardSession().recordSource(
    "Request",
    "Prepare an email.",
  );

  const decision = guard.authorizeTool({
    toolName: "send-email",
    action: "Send email",
    sideEffect: true,
    approvedBy: "model-invented@example.com",
  });

  assert.equal(decision.status, "approval-required");
  assert.equal(decision.approvalVerified, false);
});

test("registered tools keep side-effect classification under host control", async () => {
  let executions = 0;
  const guard = new LineageGuardSession({
    approvalVerifier: ({ approval, toolName }) =>
      approval.token === "valid-once" && toolName === "send-email",
    tools: [
      {
        name: "send-email",
        action: "Send customer email",
        sideEffect: true,
        execute: (body: unknown) => {
          executions += 1;
          return { body };
        },
      },
    ],
  }).recordSource("Request", "Prepare an email.");

  await assert.rejects(
    guard.executeRegisteredTool("send-email", "hello"),
    LineageGuardBlockedError,
  );
  const result = await guard.executeRegisteredTool<string, { body: unknown }>(
    "send-email",
    "hello",
    {
      approval: {
        token: "valid-once",
        approvedBy: "reviewer@example.com",
      },
    },
  );

  assert.equal(result.body, "hello");
  assert.equal(executions, 1);
});

test("consumes scoped approvals once", async () => {
  const guard = new LineageGuardSession({
    approvalVerifier: ({ approval }) => approval.token === "single-use",
  }).recordSource("Request", "Prepare an email.");
  const intent = {
    toolName: "send-email",
    action: "Send email",
    input: "hello",
    sideEffect: true,
    approval: {
      token: "single-use",
      approvedBy: "reviewer@example.com",
    },
  };

  await guard.executeTool(intent, () => "sent");
  await assert.rejects(
    guard.executeTool(intent, () => "sent again"),
    (error: unknown) =>
      error instanceof LineageGuardBlockedError &&
      error.decision.status === "blocked" &&
      /consumed/i.test(error.decision.reason),
  );
});

test("deduplicates tool execution by operation fingerprint", async () => {
  let executions = 0;
  const guard = new LineageGuardSession().recordSource(
    "Request",
    "Read a customer record.",
  );
  const intent = {
    toolName: "customer-read",
    action: "Read customer",
    input: "CUS-42",
    sideEffect: false,
    idempotencyKey: "read-customer-42",
  };

  const first = await guard.executeTool(intent, () => {
    executions += 1;
    return { tier: "standard" };
  });
  const second = await guard.executeTool(intent, () => {
    executions += 1;
    return { tier: "wrong" };
  });

  assert.deepEqual(second, first);
  assert.equal(executions, 1);
  await assert.rejects(
    guard.executeTool(
      { ...intent, input: "CUS-99" },
      () => ({ tier: "other" }),
    ),
    LineageGuardDuplicateExecutionError,
  );
});

test("deduplicates concurrent tool execution before authorization resolves", async () => {
  let releaseExecution!: () => void;
  const executionReleased = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  let executions = 0;
  const guard = new LineageGuardSession().recordSource(
    "Request",
    "Read a customer record.",
  );
  const intent = {
    toolName: "customer-read",
    action: "Read customer",
    input: "CUS-42",
    sideEffect: false,
    idempotencyKey: "concurrent-read-42",
  };

  const first = guard.executeTool(intent, async () => {
    executions += 1;
    await executionReleased;
    return { tier: "standard" };
  });
  const duplicate = guard.executeTool(intent, () => {
    executions += 1;
    return { tier: "wrong" };
  });

  releaseExecution();
  const [firstResult, duplicateResult] = await Promise.all([
    first,
    duplicate,
  ]);
  assert.deepEqual(duplicateResult, firstResult);
  assert.equal(executions, 1);
});

test("deduplicates handoff recording and rejects key reuse", () => {
  const guard = new LineageGuardSession().recordSource(
    "Source",
    "The estimate may be 5%.",
  );
  const first = guard.inspectHandoff(
    "writer",
    "Writer",
    "The estimate may be 5%.",
    { idempotencyKey: "writer-pass-1" },
  );
  const duplicate = guard.inspectHandoff(
    "writer",
    "Writer",
    "The estimate may be 5%.",
    { idempotencyKey: "writer-pass-1" },
  );

  assert.equal(duplicate.report.id, first.report.id);
  assert.equal(guard.getTrace().length, 2);
  assert.throws(
    () =>
      guard.inspectHandoff(
        "writer",
        "Writer",
        "The estimate is 10%.",
        { idempotencyKey: "writer-pass-1" },
      ),
    LineageGuardDuplicateExecutionError,
  );
});

test("restores frozen sessions from durable snapshots", async () => {
  let saved: LineageGuardSessionSnapshot | null = null;
  const store: LineageGuardSnapshotStore = {
    load: async () => saved,
    save: async (snapshot) => {
      saved = snapshot;
    },
  };
  const guard = new LineageGuardSession({
    sessionId: "session-42",
  }).recordSource("Source", "The estimate may be 5%.");
  guard.inspectHandoff(
    "writer",
    "Writer",
    "The estimate is proven to be 10%.",
    { idempotencyKey: "writer-1" },
  );
  await guard.checkpoint(store);

  const restored = await LineageGuardSession.resume(store, "session-42");
  assert.equal(restored.isFrozen(), true);
  assert.equal(restored.getRecoveryPacket().restartStageLabel, "Writer");
  const checkpoint = restored.resetToLastVerified();
  assert.equal(checkpoint.label, "Source");
});

test("persisted idempotency records fail closed when results are unavailable", async () => {
  const guard = new LineageGuardSession().recordSource(
    "Source",
    "Read a record.",
  );
  const intent = {
    toolName: "record-read",
    action: "Read record",
    input: "42",
    sideEffect: false,
    idempotencyKey: "record-42",
  };
  await guard.executeTool(intent, () => ({ id: 42 }));
  const restored = LineageGuardSession.restore(guard.toSnapshot());

  await assert.rejects(
    restored.executeTool(intent, () => ({ id: 42 })),
    LineageGuardDuplicateExecutionError,
  );
});

test("isolates observability failures by default", () => {
  const guard = new LineageGuardSession({
    onEvent: () => {
      throw new Error("telemetry unavailable");
    },
  });

  assert.doesNotThrow(() => guard.recordSource("Source", "Source text."));
});

test("agents receive a restricted tool client instead of the session by default", async () => {
  let exposedGuard: LineageGuardSession | undefined;
  let hasToolClient = false;
  const guard = new LineageGuardSession().recordSource(
    "Source",
    "Source text.",
  );

  await guard.runAgent(
    {
      id: "agent",
      name: "Agent",
      execute: ({ guard: agentGuard, tools }) => {
        exposedGuard = agentGuard;
        hasToolClient = typeof tools.execute === "function";
        return "Source text.";
      },
    },
    {},
  );

  assert.equal(exposedGuard, undefined);
  assert.equal(hasToolClient, true);
});

test("requires custom rule parity when restoring a session", () => {
  const rule = {
    id: "domain-policy-v1",
    family: "authority" as const,
    evaluate: () => null,
  };
  const snapshot = new LineageGuardSession({
    rules: [rule],
  })
    .recordSource("Source", "Source text.")
    .toSnapshot();

  assert.throws(
    () => LineageGuardSession.restore(snapshot),
    /same custom rule ids/i,
  );
  assert.doesNotThrow(() =>
    LineageGuardSession.restore(snapshot, { rules: [rule] }),
  );
});

test("rejects a snapshot with a corrupted enforcement policy", () => {
  const snapshot = new LineageGuardSession()
    .recordSource("Source", "Source text.")
    .toSnapshot();
  const corrupted = {
    ...snapshot,
    blockAtOrAbove: "disabled",
  } as unknown as LineageGuardSessionSnapshot;

  assert.throws(
    () => LineageGuardSession.restore(corrupted),
    /blocking threshold is invalid/i,
  );
});

test("rejects invalid live enforcement policy instead of weakening it", () => {
  assert.throws(
    () =>
      new LineageGuardSession({
        blockAtOrAbove: "disabled" as never,
      }),
    /blocking threshold must be/i,
  );
  assert.throws(
    () =>
      new LineageGuardSession({
        toolPolicy: {
          defaultSideEffectMode: "bypass" as never,
        },
      }),
    /side-effect policy mode is invalid/i,
  );
  assert.throws(
    () =>
      new LineageGuardSession({
        exposeSessionToAgents: "false" as never,
      }),
    /session exposure must be a boolean/i,
  );
  assert.throws(
    () =>
      new LineageGuardSession({
        tools: [
          {
            name: "send-email",
            action: "Send email",
            sideEffect: undefined as never,
            execute: () => undefined,
          },
        ],
      }),
    /explicit sideEffect boolean/i,
  );
});

test("blocks a paraphrase flagged by the semantic judge", async () => {
  const judged: string[] = [];
  const guard = new LineageGuardSession({
    semanticJudge: (context) => {
      judged.push(context.proposedOutput);
      if (/finished/i.test(context.proposedOutput)) {
        return [
          {
            severity: "high",
            title: "Paraphrase changed the claim's status",
            explanation: "An in-progress review became a finished one.",
          },
        ];
      }
      return null;
    },
  }).recordSource(
    "Source",
    "The trial data is still under review by the safety board.",
  );

  const result = await guard.runSequence(
    [
      {
        id: "summarizer",
        name: "Summarizer",
        execute: () =>
          "The safety board finished its review of the trial data.",
      },
    ],
    {},
  );

  assert.equal(result.status, "blocked");
  assert.equal(judged.length, 1);
  const issue = result.report.analysis.issues.find(
    (item) => item.type === "custom",
  );
  assert.ok(issue);
  assert.match(issue.id, /lineageguard:semantic-judge/);
  assert.equal(issue.family, "meaning");
});

test("requires a semantic judge for hybrid and semantic modes", () => {
  assert.throws(
    () => new LineageGuardSession({ analysisMode: "hybrid" }),
    /requires a semanticJudge/i,
  );
  assert.throws(
    () => new LineageGuardSession({ analysisMode: "semantic" }),
    /requires a semanticJudge/i,
  );
});

test("semantic mode uses dynamic findings without deterministic fallback", async () => {
  let judgeCalls = 0;
  const guard = new LineageGuardSession({
    analysisMode: "semantic",
    semanticJudge: () => {
      judgeCalls += 1;
      return null;
    },
  }).recordSource("Source", "Some users may save 5%.");

  assert.throws(
    () =>
      guard.inspectHandoff(
        "writer",
        "Writer",
        "All users are guaranteed to save 50%.",
      ),
    /inspectHandoffAsync/i,
  );

  const decision = await guard.inspectHandoffAsync(
    "writer",
    "Writer",
    "All users are guaranteed to save 50%.",
  );
  assert.equal(decision.status, "allowed");
  assert.equal(decision.report.analysis.issues.length, 0);
  assert.equal(judgeCalls, 1);
});

test("hybrid mode keeps deterministic evidence checks", async () => {
  const guard = new LineageGuardSession({
    analysisMode: "hybrid",
    semanticJudge: () => null,
  }).recordSource("Source", "Some users may save 5%.");

  const decision = await guard.inspectHandoffAsync(
    "writer",
    "Writer",
    "Some users may save 50%.",
  );
  assert.equal(decision.status, "blocked");
  assert.ok(
    decision.report.analysis.issues.some((issue) => issue.type === "number"),
  );
});

test("applies the semantic judge in an existing framework loop", async () => {
  let judgeCalls = 0;
  const guard = new LineageGuardSession({
    analysisMode: "semantic",
    semanticJudge: ({ proposedOutput }) => {
      judgeCalls += 1;
      return proposedOutput.includes("finished")
        ? [
            {
              severity: "high",
              title: "Status changed",
              explanation: "An in-progress review became a finished review.",
            },
          ]
        : null;
    },
  }).recordSource("Source", "The safety review is still in progress.");

  const decision = await guard.inspectHandoffAsync(
    "writer",
    "Writer",
    "The safety review finished.",
    { idempotencyKey: "writer-1" },
  );
  const duplicate = await guard.inspectHandoffAsync(
    "writer",
    "Writer",
    "The safety review finished.",
    { idempotencyKey: "writer-1" },
  );

  assert.equal(decision.status, "blocked");
  assert.equal(duplicate, decision);
  assert.equal(judgeCalls, 1);
});

test("semantic judge failures fail closed by default and warn when configured", async () => {
  const failingJudge = () => {
    throw new Error("judge offline");
  };
  const events: RuntimeEvent[] = [];

  const blocking = new LineageGuardSession({
    semanticJudge: failingJudge,
    onEvent: (event) => events.push(event),
  }).recordSource("Source", "Summarize the support request.");
  const blocked = await blocking.runSequence(
    [
      {
        id: "writer",
        name: "Writer",
        execute: () => "A summary of the support request.",
      },
    ],
    {},
  );
  assert.equal(blocked.status, "blocked");
  assert.ok(events.some((event) => event.type === "semantic-judge-failed"));

  const warning = new LineageGuardSession({
    semanticJudge: failingJudge,
    semanticJudgeFailureMode: "warn",
  }).recordSource("Source", "Summarize the support request.");
  const allowed = await warning.runSequence(
    [
      {
        id: "writer",
        name: "Writer",
        execute: () => "A summary of the support request.",
      },
    ],
    {},
  );
  assert.equal(allowed.status, "completed");
  assert.ok(
    allowed.report.analysis.issues.some(
      (issue) =>
        issue.type === "custom" && issue.severity === "low",
    ),
  );
});

test("persists semantic findings through snapshots", async () => {
  let saved: LineageGuardSessionSnapshot | null = null;
  const store: LineageGuardSnapshotStore = {
    load: async () => saved,
    save: async (snapshot) => {
      saved = snapshot;
    },
  };
  const semanticJudge = () => [
    {
      severity: "high" as const,
      title: "Semantic drift",
      explanation: "The paraphrase changed the claim.",
    },
  ];
  const guard = new LineageGuardSession({
    sessionId: "judge-session",
    semanticJudge,
  }).recordSource("Source", "The report is still in draft.");
  const result = await guard.runSequence(
    [
      {
        id: "writer",
        name: "Writer",
        execute: () => "A restated version of the report summary.",
      },
    ],
    {},
  );
  assert.equal(result.status, "blocked");
  const persisted: LineageGuardSessionSnapshot | null =
    await guard.checkpoint(store);
  assert.equal(persisted?.semanticFindings?.length, 1);
  assert.equal(persisted?.analysisMode, "hybrid");

  const restored = await LineageGuardSession.resume(store, "judge-session", {
    semanticJudge,
  });
  assert.ok(
    restored
      .getReport()
      .analysis.issues.some(
        (issue) => issue.type === "custom" && issue.title === "Semantic drift",
      ),
  );

  const checkpoint = restored.resetToLastVerified();
  assert.equal(checkpoint.label, "Source");
  assert.equal(
    restored
      .getReport()
      .analysis.issues.some((issue) => issue.type === "custom"),
    false,
  );
});

test("rejects rules that claim the reserved semantic judge id", () => {
  assert.throws(
    () =>
      new LineageGuardSession({
        rules: [
          {
            id: "lineageguard:semantic-judge",
            family: "meaning",
            evaluate: () => null,
          },
        ],
      }),
    /reserved/i,
  );
});
