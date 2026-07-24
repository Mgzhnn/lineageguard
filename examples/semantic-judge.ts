import {
  LineageGuardSession,
  type GuardedAgent,
  type SemanticJudgeContext,
  type SemanticJudgeFinding,
} from "../sdk/index.ts";

// The optional semantic judge closes the gap the deterministic families
// document honestly: a paraphrase that flips meaning without touching a
// number, hedge word, negation, or protected action.
//
// In production this function is an LLM call. For example, with the Claude
// API:
//
//   const response = await anthropic.messages.create({
//     model: "claude-sonnet-5",
//     max_tokens: 512,
//     messages: [{
//       role: "user",
//       content:
//         `Source claim:\n${context.from.text}\n\n` +
//         `Proposed handoff:\n${context.proposedOutput}\n\n` +
//         "Does the handoff change what the source actually claims " +
//         "(completion status, responsibility, outcome)? Reply with JSON: " +
//         '{"changed": boolean, "severity": "low"|"medium"|"high", "reason": string}',
//     }],
//   });
//
// The demo below uses a deterministic stand-in so it runs with no API key:
// the source says a review is still in progress, and the judge refuses any
// handoff that presents that review as finished.
async function demoJudge(
  context: Readonly<SemanticJudgeContext>,
): Promise<SemanticJudgeFinding[] | null> {
  const sourceSaysUnderReview = /under review|still reviewing/i.test(
    context.from.text,
  );
  const outputSaysFinished = /finished|completed|concluded/i.test(
    context.proposedOutput,
  );
  if (sourceSaysUnderReview && outputSaysFinished) {
    return [
      {
        severity: "high",
        title: "Paraphrase changed the claim's status",
        explanation:
          "The source describes a review that is still in progress, but the proposed handoff presents it as finished. No number, hedge word, or negation changed, so only a semantic reviewer can catch this.",
      },
    ];
  }
  return null;
}

const guard = new LineageGuardSession({
  runName: "Semantic judge demo",
  guardrail: "Preserve the review status of the trial data.",
  blockAtOrAbove: "medium",
  semanticJudge: demoJudge,
  onEvent: (event) => {
    console.log(`[${event.type}] ${event.message}`);
  },
}).recordSource(
  "Safety board update",
  "The trial data is still under review by the safety board.",
);

const agents: GuardedAgent<undefined>[] = [
  {
    id: "summary-agent",
    name: "Summary agent",
    execute: () =>
      "The safety board finished its review of the trial data.",
  },
];

const result = await guard.runSequence(agents, undefined);
console.log(`Run status: ${result.status}`);
const semanticIssue = result.report.analysis.issues.find(
  (issue) => issue.type === "custom",
);
console.log(
  `Semantic finding: ${semanticIssue ? semanticIssue.title : "none"}`,
);
