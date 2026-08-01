# Framework integrations

LineageGuard should inspect a proposed handoff before the next agent receives
it. Keep side-effecting tool implementations behind LineageGuard's registered
tool client; a website or after-the-fact trace cannot undo an action that has
already run.

The examples below add no framework dependencies to `lineageguard` itself.
Install the framework in the host application and use LineageGuard as the
small, dependency-free enforcement layer around it.

## OpenAI Agents SDK for TypeScript

The Agents SDK exposes `Agent` and `run`. Gate each completed agent output
before passing it into the next run:

```ts
import { Agent, run } from "@openai/agents";
import { LineageGuardSession } from "lineageguard";

const researcher = new Agent({
  name: "Researcher",
  instructions: "Summarize the evidence and preserve uncertainty.",
});
const writer = new Agent({
  name: "Writer",
  instructions: "Draft from the supplied research without strengthening claims.",
});

const guard = new LineageGuardSession({
  guardrail: "Preserve uncertainty. Human approval before publishing.",
  blockAtOrAbove: "medium",
}).recordSource("Authoritative source", sourceText);

const researchRun = await run(researcher, sourceText);
if (typeof researchRun.finalOutput !== "string") {
  throw new Error("Researcher did not return text.");
}

const researchGate = await guard.inspectHandoffAsync(
  "researcher",
  researcher.name,
  researchRun.finalOutput,
);
if (researchGate.status === "blocked") {
  await queueHumanReview(researchGate.report.recovery);
  throw new Error("LineageGuard blocked the researcher handoff.");
}

const writingRun = await run(writer, researchGate.output);
if (typeof writingRun.finalOutput !== "string") {
  throw new Error("Writer did not return text.");
}

const writingGate = await guard.inspectHandoffAsync(
  "writer",
  writer.name,
  writingRun.finalOutput,
);
if (writingGate.status === "blocked") {
  await queueHumanReview(writingGate.report.recovery);
  throw new Error("LineageGuard blocked the writer handoff.");
}
```

The Agents SDK can execute function tools inside its run loop. For a
side-effecting tool, register the real implementation with LineageGuard and
expose only a wrapper that calls the session's guarded tool client. Do not also
give the agent an unguarded reference to the implementation.

Official reference: [OpenAI Agents SDK quickstart](https://openai.github.io/openai-agents-js/guides/quickstart/)
and [tools guide](https://openai.github.io/openai-agents-js/guides/tools/).

## LangGraph.js

LangGraph nodes are ordinary functions. Wrap the model or agent invocation in
a node and stop the graph when LineageGuard blocks its output:

```ts
import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { z } from "zod/v4";
import { LineageGuardSession } from "lineageguard";

const WorkflowState = new StateSchema({
  currentText: z.string(),
});

const guard = new LineageGuardSession({
  guardrail: "Preserve uncertainty. Do not publish without approval.",
  blockAtOrAbove: "medium",
}).recordSource("Authoritative source", sourceText);

const guardedWriter: typeof WorkflowState.Node = async (state) => {
  const proposed = await invokeWriterAgent(state.currentText);
  const decision = await guard.inspectHandoffAsync(
    "writer",
    "Writer",
    proposed,
  );

  if (decision.status === "blocked") {
    await queueHumanReview(decision.report.recovery);
    throw new Error("LineageGuard blocked the writer node.");
  }

  return { currentText: decision.output };
};

const graph = new StateGraph(WorkflowState)
  .addNode("writer", guardedWriter)
  .addEdge(START, "writer")
  .addEdge("writer", END)
  .compile();

const result = await graph.invoke({ currentText: sourceText });
```

For a durable graph, persist `guard.toSnapshot()` beside the LangGraph
checkpoint and restore both before resuming. For branch/merge workflows, use
`LineageGuardGraphRun` and provide each node's parent IDs plus per-parent claim
projections at merge nodes.

Official reference: [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api).

## Hosted demo and HTTP boundary

The [live demo](https://lineageguard.ugrp44group.chatgpt.site) is intended for
interactive local analysis. Its public `POST /api/evaluate` route deliberately
returns `503` unless the deployer configures trusted workspace identity or a
tenant bearer-token map. This prevents an unauthenticated public analysis API
from being mistaken for a production enforcement service.

If another language must call LineageGuard over HTTP, deploy your own instance,
configure tenant authentication, and treat the network decision as fail-closed.
Tool implementations should still be wrapped in the host process.
