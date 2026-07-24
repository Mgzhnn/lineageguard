# @lineageguard/sdk

Framework-neutral claim-lineage analysis and runtime enforcement for AI agent
handoffs.

```ts
import { LineageGuardSession } from "@lineageguard/sdk";

const guard = new LineageGuardSession({
  guardrail: "Preserve uncertainty. Approval is required before publishing.",
  approvalVerifier: verifyApproval,
}).recordSource("Source", sourceText);
```

The package exports the serial runtime supervisor, DAG analyzer, trace parsers,
custom rule contract, snapshot-store contract, and deterministic pipeline. It
does not call a model or require a network service.

Side-effecting tools fail closed unless host policy explicitly allows them or a
configured verifier accepts a scoped approval token. Keep tool implementations
and approval issuance outside agent-controlled code.
