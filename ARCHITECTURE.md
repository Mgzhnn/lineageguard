# LineageGuard Architecture

## Product boundary

LineageGuard has one job: detect the earliest unreliable handoff in an AI agent
run, stop contaminated descendants and unapproved tools, and prepare the
smallest safe retry.

It is an independent reliability layer around an existing runtime. It does not
replace the model or orchestration framework.

## Live runtime flow

```text
source + protected instruction
              |
              v
       agent produces output
              |
              v
   handoff gate inspects proposal
              |
       allow / freeze + recover
              |
              +-----------------------+
              |                       |
              v                       v
       next agent              human review
              |
              v
       pre-tool gate
              |
       allow / deny / approval
              |
              v
      external tool executes
```

All entry surfaces execute the same reliability engine:

- `LineageGuardSession` supervises a live agent loop;
- `executeTool` authorizes a tool before invoking its implementation;
- `POST /api/evaluate` serves non-TypeScript runtimes;
- the interactive workspace visualizes the resulting trace and recovery;
- the JSON adapter normalizes external events into stages.

They converge on `runReliabilityPipeline` in `lib/pipeline.ts`. There is no
separate demo-only engine.

## Core data model

A trace is an ordered list of stages:

```ts
type TraceStage = {
  id: string;
  label: string;
  text: string;
};
```

The first stage is the authoritative source. Each later stage is an agent
handoff. Adjacent stages become directed graph edges. Detected changes belong
to an edge, which lets the system identify the first failure instead of merely
judging the final answer.

## Rule families

The detector uses three inspectable rule families:

| Family | Protects | Current signals |
| --- | --- | --- |
| Evidence | factual structure | numbers, ranges, money, dates, quantities |
| Meaning | semantic boundaries | certainty, quantifiers, negation |
| Authority | permissions | protected instructions and action verbs |

Agreement means multiple deterministic rule families flagged the same
transition. It is never labeled as statistical confidence.

## Runtime enforcement

LineageGuard requires three interception points:

1. record the authoritative source before the first agent;
2. inspect each model output before it is passed to another agent;
3. authorize every tool before its implementation is invoked.

The third point is essential. If a framework keeps tools inside an opaque
executor, it must expose middleware or receive wrapped tool functions. Reading
“email sent” from the final response is too late to prevent the email.

Read-only tools are allowed by default. Side-effecting tools require a named
human approval by default. Explicit deny rules always win.

## Recovery semantics

When a blocking break exists, `LineageGuardSession` freezes the run and the
recovery packet:

1. freezes the failed output and every descendant;
2. selects the last verified stage as the checkpoint;
3. restores its exact text as the retry input;
4. reattaches the protected instruction when one exists;
5. retries only the failed handoff;
6. requires human approval before downstream execution.

`resetToLastVerified()` applies the checkpoint inside the SDK. For another host
runtime, the packet remains plain data that its queue or retry controller can
apply. LineageGuard never silently approves external actions.

## Trust boundaries

- Imported files and API bodies are capped at 2 MB.
- Payload shape is validated before the pipeline receives it.
- The in-process detector makes no network request and needs no secret.
- The optional server is stateless and does not persist trace contents.
- Side-effecting tools require approval by default in the runtime SDK.
- Explicit deny rules override a supplied approval.
- Human verdicts remain visible because deterministic rules can be wrong.

## Extension points

Additional rules should produce the existing issue shape and attach to a
specific transition. A future semantic detector can be optional, but it should
not remove the free deterministic baseline or invent a confidence score.

Agent frameworks can integrate through callbacks or submit the generic JSON
contract from any language. Recovery remains plain data so a host runtime can
map it to its own queues, approvals, and retry system.

## Deployment shape

The SDK runs in-process and does not require the website. The optional stateless
Vinext service exposes `GET /api/health` and `POST /api/evaluate`. There is no
database or object-storage binding. The same engine runs locally, in a worker,
or inside the host agent process.
