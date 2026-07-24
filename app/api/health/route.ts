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
      "numeric-drift",
      "meaning-drift",
      "authority-firewall",
      "blast-radius",
      "recovery-packet",
      "runtime-supervisor",
      "pre-tool-gate",
      "handoff-gate",
      "stateless-evaluate-api",
    ],
  });
}
