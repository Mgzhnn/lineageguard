import type { TraceStage } from "../../lib/analysis.ts";
import type { ReliabilityPipelineRun } from "../../lib/pipeline.ts";

/** Prevent a receipt from associating a previous verdict with an edited trace. */
export function requireCurrentReport(
  report: ReliabilityPipelineRun,
  stages: readonly TraceStage[],
  guardrail: string,
) {
  if (guardrail !== report.recovery.protectedInstruction ||
      stages.length !== report.graph.nodes.length ||
      stages.some((stage, index) => {
        const analyzed = report.graph.nodes[index];
        return stage.id !== analyzed.id || stage.label !== analyzed.label || stage.text !== analyzed.text;
      })) {
    throw new Error("Run the reliability pipeline again before copying or exporting this report.");
  }
}
