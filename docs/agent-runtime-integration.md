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
} from "../sdk/index.ts";

const guard = new LineageGuardSession({
  runName: "Research to publishing",
  guardrail: "Preserve uncertainty. Human approval before publishing.",
  blockAtOrAbove: "medium",
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
    execute: ({ input, guard }) =>
      guard.executeTool(
        {
          toolName: "publish-article",
          action: "Publish final article",
          input,
          sideEffect: true,
          approvedBy: approvalQueue.currentReviewer(),
        },
        publishingApi.publish,
      ),
  },
];

const result = await guard.runSequence(agents, appContext);
```

`runSequence` returns immediately when a handoff crosses the configured
threshold. Later agents are not invoked.

## Option B: insert it into an existing graph or loop

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

## Protect tools before execution

Read-only tools are allowed by default. Side-effecting tools require named human
approval by default:

```ts
await guard.executeTool(
  {
    toolName: "send-email",
    action: "Send customer response",
    input: email,
    sideEffect: true,
    approvedBy: reviewerEmail,
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
    defaultSideEffectMode: "require-approval",
  },
});
```

Explicit denies win even when an approval is supplied. Wildcards are supported
as a trailing `*`.

## Python, Go, Java, and other runtimes

Run LineageGuard as a sidecar and submit the accumulated trace before continuing
the workflow:

```http
POST /api/evaluate
Content-Type: application/json

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
  "runId": "RUN-12345678",
  "recovery": {
    "status": "review-required",
    "restartStageLabel": "Writing agent",
    "actions": []
  }
}
```

Do not call the next agent when the decision is `block`.

For tool safety, a local wrapper in the host language remains preferable. A
network check can fail open if the caller ignores an error, and it cannot undo
a tool that an opaque agent already invoked.

## What model-independent means

LineageGuard does not call the model. Your agent callback can use any model or
no model at all. Integration depends only on plain input/output text and an
explicit tool boundary.

It does not mean perfect semantic understanding. The free detector is
deterministic and intentionally inspectable; human review remains the final
authority for ambiguous warnings.
