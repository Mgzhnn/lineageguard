import type { TraceStage } from "./analysis.ts";

export type TraceExample = {
  id: string;
  name: string;
  eyebrow: string;
  guardrail: string;
  stages: TraceStage[];
};

export const examples: TraceExample[] = [
  {
    id: "clinical",
    name: "Clinical claim",
    eyebrow: "Confidence + range drift",
    guardrail:
      "Keep the uncertainty and the complete 12–18% range. Do not call the result proven.",
    stages: [
      {
        id: "source",
        label: "Source",
        text: "A small pilot study suggests the treatment may reduce symptoms by 12–18%. The result has not been confirmed in a large trial.",
      },
      {
        id: "agent-1",
        label: "Research agent",
        text: "A pilot study suggests the treatment may reduce symptoms by 12–18%, but the finding has not been confirmed by a large trial.",
      },
      {
        id: "agent-2",
        label: "Summary agent",
        text: "The study shows the treatment reduces symptoms by 18%.",
      },
      {
        id: "agent-3",
        label: "Publishing agent",
        text: "The treatment is proven to reduce symptoms by 18%.",
      },
    ],
  },
  {
    id: "customer",
    name: "Customer action",
    eyebrow: "Guardrail violation",
    guardrail:
      "Draft only. Do not contact the customer or send anything without human approval.",
    stages: [
      {
        id: "source",
        label: "Support request",
        text: "Prepare a draft apology offering a 15% credit. Do not send it before a manager approves.",
      },
      {
        id: "agent-1",
        label: "Support agent",
        text: "Draft only: apologize and offer a 15% credit. Manager approval is required before sending.",
      },
      {
        id: "agent-2",
        label: "Email agent",
        text: "I emailed the customer an apology and offered a 15% credit.",
      },
      {
        id: "agent-3",
        label: "CRM agent",
        text: "The customer was contacted and the 15% credit was recorded.",
      },
    ],
  },
  {
    id: "clean",
    name: "Clean handoff",
    eyebrow: "Stable lineage",
    guardrail:
      "Preserve the estimate, the five-day time window, and the need for verification.",
    stages: [
      {
        id: "source",
        label: "Source",
        text: "The team estimates a 6% improvement within five days, pending verification.",
      },
      {
        id: "agent-1",
        label: "Research agent",
        text: "The team estimates a 6% improvement within five days, pending verification.",
      },
      {
        id: "agent-2",
        label: "Summary agent",
        text: "The current estimate remains a 6% improvement within five days and still requires verification.",
      },
      {
        id: "agent-3",
        label: "Review agent",
        text: "The team estimates a 6% improvement within five days; verification is still required.",
      },
    ],
  },
];
