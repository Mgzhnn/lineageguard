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
- its registered tool client authorizes a host-owned implementation before
  invocation;
- `LineageGuardGraphRun` and `runReliabilityGraphPipeline` analyze branches,
  merges, and multi-parent claims;
- `parseOtlpTracePayload` maps OTLP/JSON GenAI spans, parents, and links into
  the validated graph contract;
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

The v1.0 contract is an ordered chain. Event imports normalize repeated agent
executions into unique stage-instance IDs so the graph cannot contain ambiguous
nodes.

The v1.1 graph contract adds `parentIds` and optional `inheritedClaims`.
`inheritedClaims[parentId]` projects a merge output onto the claim inherited
from that parent, avoiding meaningless whole-document comparisons between
unrelated branches. Graphs are topologically sorted, missing parents and cycles
are rejected, and contamination follows descendants rather than array order.
OTLP conversion creates an explicit authoritative source node for each selected
root output, so the first model response is never silently promoted to source
evidence.

## Rule families

The detector uses three inspectable rule families:

| Family | Protects | Current signals |
| --- | --- | --- |
| Evidence | factual structure | numbers, ranges, money, dates, quantities, written-out numbers |
| Meaning | semantic boundaries | certainty, quantifiers, negation (English and Korean) |
| Authority | permissions | protected instructions and action verbs (English and Korean) |

Evidence signals canonicalize before comparison: currency magnitudes ($5k →
$5000), metric units (500mg → 0.5g), complete dates (July 24, 2026 →
2026-07-24), Korean magnitudes and units (5만원 → ₩50000), and written-out
numbers next to measurable nouns (three customers → 3customer). Equivalent
rewrites therefore compare equal, and a value change behind a formatting
rewrite still differs. Ambiguous forms (bare `m`, partial dates) stay literal
rather than guessing.

A stage written mostly in a script outside the covered lexicons produces a
low-severity coverage issue: it does not freeze the run, but the run can no
longer be reported as clean.

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

Read-only tools are allowed by default. Side-effecting tools fail closed unless
host policy explicitly allows them or `approvalVerifier` validates a scoped
token. The verifier receives the session, run, tool, action, authenticated
reviewer, and SHA-256 input fingerprint. Accepted tokens are consumed once.
The legacy `approvedBy` string is not authorization.

Hosts can register tool implementations and give agents the restricted
`GuardedToolClient`. The full session is not exposed to agent callbacks by
default. That keeps side-effect classification, registration, approval state,
and executable callbacks out of model-controlled data. Explicit deny rules
always win.

## Recovery semantics

When a break crosses the configured threshold, `LineageGuardSession` freezes
the run and creates a recovery packet. Lower-severity warnings remain visible
but do not create a rollback packet:

1. freezes the failed output and every descendant;
2. selects the last verified stage as the checkpoint;
3. restores its exact text as the retry input;
4. reattaches the protected instruction when one exists;
5. retries only the failed handoff;
6. requires human approval before downstream execution.

`resetToLastVerified()` applies the checkpoint inside the SDK. For another host
runtime, the packet remains plain data that its queue or retry controller can
apply. LineageGuard never silently approves external actions.

Sessions support idempotency keys for handoffs and tools. `toSnapshot()`,
`checkpoint(store)`, `restore()`, and `resume()` make state resumable through a
host-provided durable adapter. Snapshots retain consumed-approval fingerprints,
recovery state, event sequence, and execution idempotency records without
storing raw approval tokens. Restore also requires exact custom-rule ID parity,
preventing a resumed session from silently changing its detector policy.

## Trust boundaries

- Imported files and API bodies are capped at 2,000,000 bytes.
- API bodies are bounded while streaming instead of after full buffering.
- Payload shape, field lengths, schema version, and node identity are validated
  before the pipeline receives them.
- OTLP identifiers, trace selection, duplicate attributes, source provenance,
  and parent cycles are validated before graph construction.
- The in-process detector makes no network request and needs no secret.
- The optional server is stateless and does not persist trace contents.
- Evaluation responses declare `Cache-Control: no-store`.
- Public evaluation fails closed unless the request has authenticated workspace
  identity or a configured tenant bearer key.
- Evaluation requests are rate-limited per tenant inside each server isolate.
- Side-effecting tools require verifier-backed approval by default.
- Approval verifiers may be asynchronous; one-time tokens are reserved while
  verification is pending so concurrent calls cannot race within a session.
- Tools are blocked until an authoritative source has been recorded.
- Explicit deny rules override a supplied approval.
- Run receipts use a full SHA-256 content fingerprint; the display ID is a
  64-bit prefix and is not used as authorization.
- Human verdicts remain visible because deterministic rules can be wrong.

## Known production boundaries

- Detection is lexical and deterministic. It does not verify whether the
  source itself is true, align every paraphrase semantically, or understand
  every domain-specific unit and policy language. Custom rules can extend the
  three inspectable families but remain responsible for their own quality. An
  optional semantic judge can cover harder paraphrases through
  `inspectHandoffAsync`, `runAgent`, and `runSequence`, but its quality and cost
  belong to the host.
- The SDK assumes the host owns the actual tool boundary. Code that can bypass
  the wrapper can also bypass LineageGuard.
- A `LineageGuardSession` is a serial state machine. DAG analysis is supported,
  but a concurrent scheduler must still map branch execution and locks to the
  graph contract.
- Snapshot durability is only as strong as the supplied store. Distributed
  locking, transactional outboxes, and approval issuance remain host concerns.
- Built-in API quotas are per isolate. A high-scale multi-region deployment
  still needs a globally coordinated gateway limit and an explicit audit
  retention policy.

## Extension points

Additional rules implement `CustomLineageRule`, choose one of the evidence,
meaning, or authority families, and return findings for a specific edge. A
semantic or domain detector can therefore be optional without replacing the
free deterministic baseline or inventing a confidence score.

The runtime SDK also accepts an optional asynchronous `semanticJudge`. It runs
in `runAgent`/`runSequence` before the deterministic gate, and its accepted
findings are replayed into every report through the reserved
`lineageguard:semantic-judge` rule so reports stay reproducible, snapshots
persist them, and `resetToLastVerified()` prunes findings for rolled-back
transitions. A judge failure fails closed by default; the synchronous
`inspectHandoff` path remains deterministic-only.

The curated evaluation harness records precision, recall, specificity,
false-positive rate, and expected-signal coverage at the configured blocking
threshold. It is a regression gate for known cases, not an estimate of
production accuracy.

Agent frameworks can integrate through callbacks or submit the generic JSON
contract from any language. Recovery remains plain data so a host runtime can
map it to its own queues, approvals, and retry system.

## Deployment shape

The compiled `lineageguard` package runs in-process, has no runtime
dependencies, and does not require the website. Its package lifecycle builds
JavaScript and declarations before packing; CI installs the produced tarball
into an isolated consumer and imports every public subpath. The optional
stateless Vinext service exposes `GET /api/health` and `POST /api/evaluate` for
both chain and graph payloads. There is no database or object-storage binding.
Authentication secrets remain runtime configuration, and durable session
stores remain host adapters.
