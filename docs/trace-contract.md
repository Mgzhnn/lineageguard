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
missing. `label` and `text` are required non-empty strings.

## Validation limits

- A trace must contain one source and at least one handoff.
- A trace can contain at most 50 stages.
- The browser importer rejects files larger than 2 MB.
- Duplicate event sequence numbers are rejected.
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
