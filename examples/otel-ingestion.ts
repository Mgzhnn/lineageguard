import { runOtlpReliabilityPipeline } from "../sdk/index.ts";

const traceId = "a".repeat(32);
const sourceSpanId = "1".repeat(16);
const writerSpanId = "2".repeat(16);
const attribute = (key: string, stringValue: string) => ({
  key,
  value: { stringValue },
});

const otlpTrace = {
  resourceSpans: [
    {
      resource: {
        attributes: [attribute("service.name", "support-agents")],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId,
              spanId: sourceSpanId,
              parentSpanId: "",
              name: "research-agent",
              startTimeUnixNano: "100",
              attributes: [
                attribute(
                  "gen_ai.input.messages",
                  JSON.stringify([
                    {
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          content:
                            "A pilot suggests some users may improve by 12–18%.",
                        },
                      ],
                    },
                  ]),
                ),
                attribute(
                  "gen_ai.output.messages",
                  JSON.stringify([
                    {
                      role: "assistant",
                      parts: [
                        {
                          type: "text",
                          content:
                            "A pilot suggests some users may improve by 12–18%.",
                        },
                      ],
                    },
                  ]),
                ),
              ],
            },
            {
              traceId,
              spanId: writerSpanId,
              parentSpanId: sourceSpanId,
              name: "writer-agent",
              startTimeUnixNano: "200",
              attributes: [
                attribute(
                  "gen_ai.output.messages",
                  JSON.stringify([
                    {
                      role: "assistant",
                      parts: [
                        {
                          type: "text",
                          content:
                            "The pilot proves all users improve by 18%.",
                        },
                      ],
                    },
                  ]),
                ),
              ],
            },
          ],
        },
      ],
    },
  ],
};

const report = runOtlpReliabilityPipeline(otlpTrace, {
  guardrail: "Preserve uncertainty and the complete range.",
});

console.log(`Decision: ${report.firstBlockingEdgeId ? "BLOCK" : "ALLOW"}`);
console.log(`First blocking edge: ${report.firstBlockingEdgeId ?? "none"}`);
console.log(`Retry node: ${report.recovery.retryNodeLabel ?? "none"}`);
