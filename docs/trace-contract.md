# LineageGuard Trace Contract

The trace contract lets any agent framework send a completed run to
LineageGuard without depending on its TypeScript SDK.

## Event format

```json
{
  "schemaVersion": "1.0",
  "runName": "Optional human-readable name",
  "guardrail": "Optional inherited restriction",
  "events": [
    {
      "sequence": 0,
      "type": "source",
      "agentId": "source",
      "agentName": "Source evidence",
      "content": "The authoritative source text.",
      "timestamp": "2026-07-24T09:00:00.000Z"
    },
    {
      "sequence": 1,
      "type": "handoff",
      "agentId": "agent-1",
      "agentName": "Research agent",
      "content": "The agent output."
    }
  ]
}
```

### Event fields

| Field | Required | Rule |
| --- | --- | --- |
| `sequence` | yes | unique non-negative integer |
| `type` | yes | `source` or `handoff` |
| `agentId` | yes | non-empty string |
| `agentName` | yes | non-empty string |
| `content` | yes | non-empty string |
| `timestamp` | no | string; ISO 8601 is recommended |

Events are sorted by `sequence`. The first event must have type `source`.
No later event may have type `source`. When the same `agentId` occurs more than
once, LineageGuard creates unique stage-instance IDs such as `reviewer-2`.

## Direct stages format

A consumer that already has an ordered trace can use:

```json
{
  "runName": "Direct trace",
  "guardrail": "Optional restriction",
  "stages": [
    {
      "id": "source",
      "label": "Source",
      "text": "Authoritative source text."
    },
    {
      "id": "agent-1",
      "label": "Agent 1",
      "text": "Agent output."
    }
  ]
}
```

`id` is optional in imported stages and receives a generated value when
missing. Explicit IDs must be unique. `label` and `text` are required non-empty
strings.

## Validation limits

- A trace must contain one source and at least one handoff.
- A trace can contain at most 50 stages.
- Payloads are limited to 2,000,000 bytes.
- IDs are limited to 128 characters and labels/run names to 200 characters.
- A guardrail is limited to 20,000 characters, each stage text to 500,000
  characters, and total trace text to 1,500,000 characters.
- Duplicate event sequence numbers are rejected.
- If supplied, `schemaVersion` must be `"1.0"`.
- Exactly one of `stages` or `events` must be supplied.
- Unknown top-level fields are ignored for forward compatibility.

## Normalized result

Both formats become:

```ts
type NormalizedTracePayload = {
  runName: string;
  guardrail: string;
  stages: TraceStage[];
};
```

Call `parseTracePayload(payload)` to validate and normalize a value before
passing it to the reliability pipeline.

## Branch and merge graph format

Schema `1.1` represents a DAG:

```json
{
  "schemaVersion": "1.1",
  "runName": "Research and policy merge",
  "nodes": [
    {
      "id": "facts",
      "label": "Facts",
      "text": "Some users may save 5%.",
      "parentIds": []
    },
    {
      "id": "policy",
      "label": "Policy",
      "text": "Human approval is required.",
      "parentIds": []
    },
    {
      "id": "merge",
      "label": "Merge agent",
      "text": "Some users may save 5%. Human approval is required.",
      "parentIds": ["facts", "policy"],
      "inheritedClaims": {
        "facts": "Some users may save 5%.",
        "policy": "Human approval is required."
      }
    }
  ]
}
```

Graph node IDs must be unique. Parents must exist, self-parenting and cycles are
rejected, and at least one root and one edge are required. `inheritedClaims` is
optional for a single-parent rewrite. It is strongly recommended for merge
nodes because it identifies the portion of the output inherited from each
parent.

Call `parseTraceGraphPayload(payload)` and
`runReliabilityGraphPipeline(nodes, guardrail, options)`. The graph report
returns topological order, edge-specific issues, branch-aware contamination,
verified merge parents, and the exact retry node.
