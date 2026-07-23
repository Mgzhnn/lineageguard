# LineageGuard

LineageGuard is a free, model-independent reliability control plane for AI
agent handoffs. It records what each agent received and produced, finds the
first handoff where evidence, meaning, or authority changed, shows the
downstream blast radius, and prepares the smallest safe retry.

It is one product with three usable surfaces:

- a runtime supervisor that blocks unsafe handoffs before downstream agents run;
- a pre-tool gate that prevents unapproved external side effects;
- a visual forensic workspace and framework-neutral HTTP/JSON adapter.

No model API, API key, account, database, analytics service, or paid service is
required. Analysis is deterministic and runs locally.

## What the pipeline does

Every run passes through seven visible modules:

1. **Trace Collector** validates and orders the source and handoffs.
2. **Claim Lineage Mapper** builds an ancestry graph for the claim.
3. **Evidence Sentinel** watches numbers, ranges, quantities, dates, and units.
4. **Meaning Sentinel** watches confidence, scope, and negation.
5. **Authority Firewall** enforces inherited restrictions and approval gates.
6. **Contamination Tracer** identifies descendants of the first failed handoff.
7. **Recovery Orchestrator** freezes unsafe descendants and creates a minimal
   rollback-and-retry packet.

The interface exposes the exact rules and evidence. Its rule-family agreement
is not presented as a probability or a made-up model confidence score.

## Signature experience

**Truth-Decay Replay** lets a reviewer play the run one handoff at a time. The
first transition where a structured claim changes turns red; later stages
become the visible blast radius. The resulting **Mutation Receipt** contains a
stable run fingerprint, first break, signal types, evidence, and human verdicts.

## Run locally

Prerequisite: Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev
```

Open the local URL printed in the terminal. The repository includes planted
clinical, customer-support, and clean-chain examples.

## Instrument an agent runtime

```ts
import { LineageGuardSession } from "./sdk/index.ts";

const guard = new LineageGuardSession({
  runName: "Customer support run",
  guardrail: "Draft only. Do not contact the customer.",
  blockAtOrAbove: "medium",
}).recordSource("Customer request", sourceText);

const result = await guard.runSequence(agents, applicationContext);

if (result.status === "blocked") {
  showHumanReview(result.report.recovery);
  guard.resetToLastVerified();
}
```

An agent that can call tools must receive the guard and use its executor:

```ts
await guard.executeTool(
  {
    toolName: "send-email",
    action: "Send customer response",
    input: email,
    sideEffect: true,
    approvedBy: humanApproval?.reviewer,
  },
  (approvedEmail) => emailProvider.send(approvedEmail),
);
```

The second callback is never called when the tool is denied or still needs
approval. This is enforcement inside the workflow, not post-run reporting.

Run the dependency-free reference workflow:

```bash
pnpm demo:agent
```

It attempts to send an email, LineageGuard blocks the tool before execution,
and the final count remains `Emails actually sent: 0`.

See [docs/agent-runtime-integration.md](./docs/agent-runtime-integration.md)
for the interception contract and integration patterns.

## Connect another language or framework

For Python, Go, Java, or a separate agent service, submit the accumulated trace
before handing the proposed output to the next agent:

```text
POST /api/evaluate
```

The response contains `decision: "allow" | "block"`, the blocking transition,
and a recovery packet. The endpoint is stateless and uses the same engine.

Tool execution should still be wrapped locally in the host process: once an
opaque framework has already executed a tool, no external monitor can undo it.

## Import a generic trace

The workspace accepts either a direct `stages` array or an ordered `events`
array:

```json
{
  "schemaVersion": "1.0",
  "runName": "Support handoff",
  "guardrail": "Draft only. Do not send.",
  "events": [
    {
      "sequence": 0,
      "type": "source",
      "agentId": "source",
      "agentName": "Customer request",
      "content": "Prepare a refund email draft."
    },
    {
      "sequence": 1,
      "type": "handoff",
      "agentId": "action-agent",
      "agentName": "Action agent",
      "content": "The refund email was sent."
    }
  ]
}
```

See [docs/trace-contract.md](./docs/trace-contract.md) for validation rules.

## Test and build

```bash
pnpm test
pnpm lint
```

`pnpm test` runs detector, pipeline, runtime enforcement, SDK, and schema tests;
creates a production build; checks the rendered interface; and verifies both
API contracts.

Individual commands:

```bash
pnpm test:engine
pnpm build
pnpm test:render
```

## Deployment contract

The application is stateless and Cloudflare-compatible. A deployment exposes:

```text
GET /api/health
POST /api/evaluate
```

The health response declares the product version, deterministic local analysis,
whether a paid API is required, and the supported capabilities. The project
contains `.openai/hosting.json` for deployment through Sites, but no hosted
service is required for local use.

## Privacy and cost

- **API cost:** $0.
- **Network during analysis:** none.
- **Storage:** trace input stays in React state and is not written to a server.
- **Import:** JSON files are parsed locally and limited to 2 MB in the UI.
- **Export:** reports, recovery packets, and JSON are generated locally.

Installing the open-source development dependencies may use the network. That
is separate from analyzing a trace.

## Honest limitations

LineageGuard is a smoke detector, not a truth machine. It catches explicit
structural mutations but can miss subtle paraphrases, domain-specific meaning,
sarcasm, and a false claim that remains unchanged throughout the chain. It can
also warn on a harmless rewrite.

Human confirmation is therefore part of the product, not hidden in fine print.
Do not use the current rules as a replacement for source verification,
compliance review, medical judgment, or safety approval.

## Project structure

```text
app/
  LineageGuard.tsx       Interactive control plane
  api/health/route.ts    Deployment health contract
  api/evaluate/route.ts  Framework-neutral handoff gate
lib/
  analysis.ts            Dependency-free mutation detector
  pipeline.ts            Seven-module reliability pipeline and recovery
  trace-schema.ts        Generic JSON validation and normalization
sdk/
  index.ts               Runtime instrumentation API
  runtime.ts             Agent, handoff, tool, and recovery supervisor
examples/
  guarded-agent-runtime.ts  Executable non-web integration
docs/
  agent-runtime-integration.md  Runtime interception guide
  trace-contract.md      Framework-independent trace contract
tests/
  analysis.test.ts       Detection behavior
  pipeline.test.ts       Graph, modules, and recovery behavior
  sdk.test.ts            Runtime SDK behavior
  runtime.test.ts        Live blocking and tool enforcement
  trace-schema.test.ts   Import validation
  rendered-html.test.mjs Production render and health smoke tests
```

The design boundaries and runtime flow are documented in
[ARCHITECTURE.md](./ARCHITECTURE.md).

## License

MIT
