import { PRODUCT_VERSION } from "@/lib/version";

export async function GET() {
  return Response.json({
    status: "ok",
    product: "LineageGuard",
    version: PRODUCT_VERSION,
    analysis: "local-deterministic",
    paidApiRequired: false,
    capabilities: [
      "claim-lineage",
      "dag-lineage",
      "merge-claim-projection",
      "numeric-drift",
      "meaning-drift",
      "authority-firewall",
      "blast-radius",
      "recovery-packet",
      "runtime-supervisor",
      "pre-tool-gate",
      "registered-tool-client",
      "scoped-one-time-approvals",
      "resumable-session-snapshots",
      "idempotent-handoffs-and-tools",
      "custom-rule-extensions",
      "sha256-run-fingerprint",
      "handoff-gate",
      "stateless-evaluate-api",
      "tenant-authenticated-api",
      "per-tenant-rate-limit",
    ],
  });
}
