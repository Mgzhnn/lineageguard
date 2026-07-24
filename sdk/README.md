# lineageguard

Dependency-free claim-lineage analysis and runtime enforcement for AI agent
handoffs.

## Install

```bash
pnpm add lineageguard
```

Node.js 20 or newer is supported. The package includes ESM JavaScript,
declaration files, source maps, and no runtime dependencies.

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

Agents receive a restricted registered-tool client. Side-effecting tools fail
closed unless host policy explicitly allows them or a configured verifier
accepts a scoped, one-time approval token. Keep tool implementations, approval
issuance, durable storage, and distributed locks outside model-controlled code.

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
