# lineageguard

Dependency-free claim-lineage analysis and runtime enforcement for AI agent
handoffs.

[Live demo](https://lineageguard.ugrp44group.chatgpt.site) ·
[GitHub](https://github.com/Mgzhnn/lineageguard) ·
[Framework integrations](https://github.com/Mgzhnn/lineageguard/blob/main/docs/framework-integrations.md)

## Install

```bash
pnpm add lineageguard
```

Node.js 20 or newer is supported. The package includes ESM JavaScript,
declaration files, source maps, and no runtime dependencies.

## Runnable quickstart

Save as `quickstart.mjs` and run `node quickstart.mjs`. No model, credentials,
external tools, or host callbacks are needed:

```js
import { LineageGuardSession } from "lineageguard";

const guard = new LineageGuardSession()
  .recordSource("Budget", "The budget is $5k.");
const decision = guard.inspectHandoff(
  "writer", "Writer", "The budget is $50,000.",
);
console.log(decision.status); // blocked
console.log(guard.isFrozen()); // true
```

The integration snippets below use host-supplied functions and data.

## Supervise an agent run

```ts
import { LineageGuardSession } from "lineageguard";

const guard = new LineageGuardSession({
  guardrail: "Preserve uncertainty. Approval before publishing.",
  approvalVerifier: verifyApproval,
  tools: [
    {
      name: "publish",
      action: "Publish article",
      sideEffect: true,
      execute: publishArticle,
    },
  ],
}).recordSource("Research source", sourceText);

const result = await guard.runSequence(agents, applicationContext);
if (result.status === "blocked") {
  queueReview(result.report.recovery);
}
```

## Choose an analysis mode

```ts
const guard = new LineageGuardSession({
  analysisMode: "semantic",
  semanticJudge: async ({ from, proposedOutput }) =>
    reviewMeaningDynamically(from.text, proposedOutput),
}).recordSource("Source", sourceText);

const decision = await guard.inspectHandoffAsync(
  "writer",
  "Writer",
  proposedOutput,
);
```

`deterministic` uses the offline English rules, `hybrid` combines them with the
judge, and `semantic` uses the judge alone. Hybrid is recommended when stable
numeric enforcement and nuanced semantic review are both important. Hybrid and
semantic modes reject synchronous `inspectHandoff()` calls so the judge cannot
be skipped accidentally.

Agents receive a restricted registered-tool client. Side-effecting tools fail
closed unless host policy explicitly allows them or a configured verifier
accepts a scoped, one-time approval token. Keep tool implementations, approval
issuance, durable storage, and distributed locks outside model-controlled code.

Approval verifiers may be synchronous or asynchronous. `executeTool()` and the
registered tool client await asynchronous verification and reserve the token
while it is pending. For an async preflight without execution, use
`authorizeToolAsync()`.

## Analyze a graph

```ts
import { LineageGuardGraphRun } from "lineageguard/graph";

const report = new LineageGuardGraphRun({ guardrail })
  .recordRoot("source", "Source", sourceText)
  .recordHandoff("writer", "Writer", writerOutput, ["source"])
  .finalize();
```

Merge nodes can provide a claim projection for each parent, so unrelated
branches are not compared as one document.

## Import OpenTelemetry

```ts
import { runOtlpReliabilityPipeline } from "lineageguard/otel";

const report = runOtlpReliabilityPipeline(otlpJson, {
  traceId,
  guardrail,
});
```

The adapter accepts OTLP/JSON traces, reads standard
`gen_ai.input.messages`/`gen_ai.output.messages` attributes, follows span
parents and same-trace links, and fails closed when a root output has no
authoritative input.

## Exports

Sessions are serial: overlapping agent/handoff calls reject before the second
callback runs. Wait for all tools and approvals before calling `toSnapshot()` or
`checkpoint()`. Tool inputs are detached copies; pending authorizations are
invalidated if the session changes. Reports and decisions are defensive copies.
Recovery instructions are plain data. The host must authenticate a reviewer
before calling `resetToLastVerified()` or releasing downstream work; reset does
not itself verify human approval. Distributed locks remain a host responsibility.

Graph imports support at most 50 nodes. JSON imports are limited to 2 MB, 64 levels
of nesting and 100,000 visited values/keys. Graph ties are ordered by ID, and
contamination includes all blocking branches. A single recovery packet identifies
the first retry; repair remaining independent breaks and reevaluate the graph.

Numeric rules handle signed decimal values, full-width digits, exact powers of
ten, and equivalent metric ranges. They do not establish arbitrary locale or
multilingual semantic equivalence. A quiet lexical result is not proof of safety.

Fingerprint encoding escapes tag-shaped objects and distinguishes sparse arrays.
It rejects accessors, custom properties on built-in values, built-in subclasses,
and nesting beyond 100 levels. Convert Node Buffer inputs to a private, non-shared Uint8Array.
Ordinary lower-case ASCII JSON object fingerprints are preserved; tag-shaped
objects, sparse arrays, and keys whose order differs under locale collation can
change. Existing operation records with nonmatching fingerprints fail closed.

- `lineageguard`: complete SDK and public types
- `lineageguard/runtime`: runtime supervisor and tool boundary
- `lineageguard/graph`: DAG builder
- `lineageguard/otel`: OTLP/JSON adapter
- `lineageguard/analysis`: deterministic detector
- `lineageguard/pipeline`: reports and recovery packets

LineageGuard is an inspectable warning and enforcement layer, not a truth
oracle. Production hosts remain responsible for factual verification,
authenticated approval issuance, durable transactions, and ensuring tools
cannot bypass the registered boundary.
