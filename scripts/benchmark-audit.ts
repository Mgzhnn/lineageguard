import { performance } from "node:perf_hooks";
import { runReliabilityPipeline } from "../lib/pipeline.ts";
import { runReliabilityGraphPipeline } from "../lib/graph.ts";

function measure(name: string, operation: () => unknown) {
  const start = performance.now();
  operation();
  console.log(JSON.stringify({ name, milliseconds: Math.round((performance.now() - start) * 100) / 100 }));
}

const text = "The deadline is July 24, 2026. ".repeat(300);
const stages = Array.from({ length: 50 }, (_, index) => ({ id: `s${String(index).padStart(2, "0")}`, label: `Stage ${index}`, text }));
measure("50-stage chain, repeated complete dates, 450000 text characters", () => runReliabilityPipeline(stages));
measure("50-node wide DAG, 49 edges", () => runReliabilityGraphPipeline(stages.map((stage, index) => ({ ...stage, parentIds: index ? [stages[0].id] : [] }))));
measure("1000-node graph rejects at the documented limit", () => {
  try { runReliabilityGraphPipeline(Array.from({ length: 1000 }, (_, index) => ({ id: String(index), label: "Node", text: "Claim.", parentIds: index ? ["0"] : [] }))); }
  catch (error) { if (!(error instanceof Error) || !/at most 50/.test(error.message)) throw error; return; }
  throw new Error("Oversized graph unexpectedly accepted.");
});
