# Agent Runtime Integration

LineageGuard belongs inside the orchestration loop. The website is its debugger,
not its enforcement boundary.

## The three hooks

Every integration needs these hooks:

```text
authoritative source
        |
        v
  model/agent output
        |
        v
  inspectHandoff() ---- block ----> review + checkpoint retry
        |
       allow
        v
    next agent
        |
        v
  executeTool() ------- deny -----> tool implementation is never called
        |
       allow
        v
 external side effect
```

`inspectHandoff` must run before the proposed output becomes another agent's
input. `executeTool` must wrap the actual implementation rather than audit it
afterward.

## Option A: supervise an ordered agent sequence

An agent is any object with an `id`, `name`, and `execute` callback. The callback
can call any local model, hosted model, rules engine, or human queue.

```ts
import {
  LineageGuardSession,
  type GuardedAgent,
} from "lineageguard";

const guard = new LineageGuardSession({
  runName: "Research to publishing",
  guardrail: "Preserve uncertainty. Human approval before publishing.",
  blockAtOrAbove: "medium",
  approvalVerifier: approvalService.verify,
  tools: [
    {
      name: "publish-article",
      action: "Publish final article",
      sideEffect: true,
      execute: publishingApi.publish,
    },
  ],
  onEvent: (event) => observability.write(event),
}).recordSource("Research source", sourceText);

const agents: GuardedAgent<AppContext>[] = [
  {
    id: "research",
    name: "Research agent",
    execute: ({ input }) => callYourModel(researchPrompt, input),
  },
  {
    id: "writer",
    name: "Writing agent",
    execute: ({ input }) => callYourModel(writerPrompt, input),
  },
  {
    id: "publisher",
    name: "Publishing agent",
    execute: ({ input, tools }) =>
      tools.execute("publish-article", input, {
        approval: {
          token: approvalQueue.currentToken(),
          approvedBy: approvalQueue.currentReviewer(),
        },
        idempotencyKey: `publish:${articleId}`,
      }),
  },
];

const result = await guard.runSequence(agents, appContext);
```

`runSequence` returns immediately when a handoff crosses the configured
threshold. Later agents are not invoked.

## Option B: insert it into an existing serial graph or loop

For a graph framework, keep its scheduler and add two middleware calls:

```ts
const proposedOutput = await existingAgent.invoke(currentInput);
const handoff = guard.inspectHandoff(
  node.id,
  node.displayName,
  proposedOutput,
);

if (handoff.status === "blocked") {
  queueHumanReview(handoff.report.recovery);
  return { state: "blocked" };
}

graphState.nextInput = handoff.output;
```

After a reviewer corrects the failure:

```ts
const checkpoint = guard.resetToLastVerified();
graphState.nextInput = checkpoint.text;
graphState.currentNode = failedNode;
```

This retries only the failed node; previously verified work is preserved.

For a true branch/merge DAG, use `LineageGuardGraphRun` or submit the v1.1 graph
contract. Every node declares `parentIds`; merge nodes should provide
`inheritedClaims[parentId]` so each edge compares the relevant claim projection
instead of unrelated full documents.

## Persist and resume a session

Implement the small snapshot-store contract with your transactional database,
workflow engine, or durable queue:

```ts
const snapshotStore: LineageGuardSnapshotStore = {
  load: (sessionId) => database.lineageSessions.get(sessionId),
  save: (snapshot) =>
    database.lineageSessions.put(snapshot.sessionId, snapshot),
};

await guard.checkpoint(snapshotStore);

const resumed = await LineageGuardSession.resume(
  snapshotStore,
  guard.sessionId,
  {
    approvalVerifier: approvalService.verify,
    tools: registeredTools,
  },
);
```

Snapshots contain no tool implementations, callbacks, raw approval tokens, or
prior tool results. Those are reattached by the host. If the session used custom
lineage rules, restore requires the same rule IDs so a resumed run cannot
silently change policy. A restored idempotency record without a cached result
fails closed instead of repeating a side effect.

## Protect tools before execution

Read-only tools are allowed by default. Side-effecting tools require a scoped
approval token verified by the host:

```ts
await guard.executeTool(
  {
    toolName: "send-email",
    action: "Send customer response",
    input: email,
    sideEffect: true,
    approval: {
      token: signedApproval.token,
      approvedBy: signedApproval.reviewerEmail,
    },
    idempotencyKey: `send:${messageId}`,
  },
  emailProvider.send,
);
```

Configure explicit policy when required:

```ts
const guard = new LineageGuardSession({
  toolPolicy: {
    allowedTools: ["database-read", "search-*"],
    deniedTools: ["shell-*", "delete-account"],
    approvalRequiredTools: ["send-email", "issue-refund"],
    sideEffectTools: ["send-*", "publish-*", "delete-*"],
    defaultSideEffectMode: "require-approval",
  },
});
```

Explicit denies win even when an approval is supplied. Wildcards are supported
as a trailing `*`. `sideEffectTools` lets host-owned policy override an
incorrect `sideEffect: false` declaration.

The verifier receives the session id, run id, tool name, action, SHA-256 input
fingerprint, token, and reviewer. It should validate expiry, reviewer identity,
scope, and revocation. Tokens are consumed once after authorization.

Prefer registered tools and give agents only `GuardedToolClient`. Do not let
model text choose the side-effect classification, register implementations, or
issue approvals. The SDK cannot secure an implementation that remains callable
outside the wrapper.

## Python, Go, Java, and other runtimes

Run LineageGuard as a sidecar and submit the accumulated trace before continuing
the workflow:

```http
POST /api/evaluate
Content-Type: application/json
Authorization: Bearer tenant-secret
X-LineageGuard-Tenant: tenant-a

{
  "runName": "External agent run",
  "blockAtOrAbove": "medium",
  "guardrail": "Do not publish without approval.",
  "events": []
}
```

The response includes:

```json
{
  "status": "ok",
  "decision": "block",
  "blockingTransitionIndex": 1,
  "runId": "RUN-1234567890ABCDEF",
  "recovery": {
    "status": "review-required",
    "restartStageLabel": "Writing agent",
    "actions": []
  }
}
```

Do not call the next agent when the decision is `block`.

On a hosted endpoint, workspace-authenticated identity is accepted only when
`LINEAGEGUARD_TRUST_WORKSPACE_IDENTITY=true` behind a dispatcher that strips
user-supplied identity headers. External callers use the configured tenant
bearer map. An unconfigured public endpoint returns `503` rather than failing
open. Built-in quotas are per-isolate; use a gateway for globally coordinated
multi-region limits.

For tool safety, a local wrapper in the host language remains preferable. A
network check can fail open if the caller ignores an error, and it cannot undo
a tool that an opaque agent already invoked.

## OpenTelemetry ingestion

If the agent platform already exports OTLP/JSON, convert its GenAI spans
directly:

```ts
import {
  parseOtlpTracePayload,
  runOtlpReliabilityPipeline,
} from "lineageguard/otel";

const normalized = parseOtlpTracePayload(otlpJson, {
  traceId,
  guardrail,
});
const report = runOtlpReliabilityPipeline(otlpJson, {
  traceId,
  guardrail,
});
```

The adapter uses standard `gen_ai.input.messages` and
`gen_ai.output.messages` attributes by default. `lineageguard.source`,
`lineageguard.output`, `lineageguard.guardrail`, and
`lineageguard.agent.name` are supported when an instrumentation layer wants
explicit values. Attribute-key lists are configurable.

Only spans with a recognized output attribute become lineage nodes. Parent
spans and same-trace links create graph edges. A selected root output must have
an input/source attribute or an explicit `sourceText`; otherwise conversion
fails closed. Batches containing multiple traces require an explicit
`traceId`.

GenAI input and output attributes commonly contain sensitive content. Apply
redaction, access control, and retention policy before exporting or storing
them. LineageGuard performs this conversion locally and does not transmit the
trace.

## What model-independent means

LineageGuard does not call the model. Your agent callback can use any model or
no model at all. Integration depends only on plain input/output text and an
explicit tool boundary.

It does not mean perfect semantic understanding. The free detector is
deterministic and intentionally inspectable; human review remains the final
authority for ambiguous warnings.
