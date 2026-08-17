import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLineage,
  getTraceSignalSnapshot,
} from "../lib/analysis.ts";

test("finds the first numeric and confidence mutation", () => {
  const stages = [
    {
      id: "source",
      label: "Source",
      text: "A pilot suggests the result may improve by 12–18%. It is not confirmed.",
    },
    {
      id: "a1",
      label: "Agent 1",
      text: "The pilot suggests the result may improve by 12–18%. It is not confirmed.",
    },
    {
      id: "a2",
      label: "Agent 2",
      text: "The pilot shows the result improves by 18%.",
    },
  ];

  const result = analyzeLineage(stages);
  assert.equal(result.firstMutationIndex, 1);
  assert.equal(result.contaminatedOutputs, 1);
  assert.ok(result.issues.some((issue) => issue.type === "number"));
  assert.ok(result.issues.some((issue) => issue.type === "certainty"));
  assert.ok(result.issues.some((issue) => issue.type === "negation"));
});

test("does not mark an equivalent clinical handoff as the first break", () => {
  const result = analyzeLineage(
    [
      {
        id: "source",
        label: "Source",
        text: "A small pilot study suggests the treatment may reduce symptoms by 12–18%. The result has not been confirmed in a large trial.",
      },
      {
        id: "research",
        label: "Research agent",
        text: "A pilot study suggests the treatment may reduce symptoms by 12–18%, but the finding has not been confirmed by a large trial.",
      },
      {
        id: "summary",
        label: "Summary agent",
        text: "The study shows the treatment reduces symptoms by 18%.",
      },
    ],
    "Keep the uncertainty and the complete 12–18% range. Do not call the result proven.",
  );

  assert.equal(result.firstMutationIndex, 1);
  assert.equal(
    result.issues.some(
      (issue) => issue.type === "guardrail" && issue.transitionIndex === 0,
    ),
    false,
  );
});

test("flags a blocked external action when an agent claims completion", () => {
  const stages = [
    {
      id: "source",
      label: "Request",
      text: "Prepare a draft apology with a 15% credit.",
    },
    {
      id: "a1",
      label: "Draft agent",
      text: "Draft only: apologize and offer a 15% credit after approval.",
    },
    {
      id: "a2",
      label: "Email agent",
      text: "I emailed the customer and offered a 15% credit.",
    },
  ];

  const result = analyzeLineage(
    stages,
    "Draft only. Do not email or contact the customer without human approval.",
  );
  const guardrailIssue = result.issues.find(
    (issue) => issue.type === "guardrail",
  );
  assert.ok(guardrailIssue);
  assert.equal(guardrailIssue.transitionIndex, 1);
  assert.equal(guardrailIssue.severity, "high");
});

test("returns a clean result when structured claims stay stable", () => {
  const stages = [
    {
      id: "source",
      label: "Source",
      text: "The estimate remains 6% within 5 days, pending verification.",
    },
    {
      id: "a1",
      label: "Agent 1",
      text: "The estimate remains 6% within 5 days, pending verification.",
    },
    {
      id: "a2",
      label: "Agent 2",
      text: "Pending verification, the estimate remains 6% within 5 days.",
    },
  ];

  const result = analyzeLineage(
    stages,
    "Keep the 6% estimate, the 5 day window, and verification.",
  );
  assert.equal(result.firstMutationIndex, null);
  assert.equal(result.overallSeverity, "clean");
  assert.equal(result.issues.length, 0);
});

test("detects scope inflation", () => {
  const stages = [
    {
      id: "source",
      label: "Source",
      text: "Some users reported the issue.",
    },
    {
      id: "a1",
      label: "Agent 1",
      text: "All users reported the issue.",
    },
  ];

  const result = analyzeLineage(stages);
  assert.equal(result.firstMutationIndex, 0);
  assert.ok(result.issues.some((issue) => issue.type === "quantifier"));
});

test("extracts the claim fingerprint used by mutation replay", () => {
  const snapshot = getTraceSignalSnapshot(
    "Some customers may improve by 12–18%, but it is not confirmed.",
  );

  assert.deepEqual(snapshot.numbers, ["12-18%"]);
  assert.equal(snapshot.certainty, "may");
  assert.equal(snapshot.scope, "some");
  assert.deepEqual(snapshot.negations, ["not"]);
});

test("normalizes equivalent numeric formatting before comparing claims", () => {
  const result = analyzeLineage([
    {
      id: "source",
      label: "Source",
      text: "The estimate is 12 to 18 percent within 5 days.",
    },
    {
      id: "agent",
      label: "Agent",
      text: "Within 5 day, the estimate is 12–18%.",
    },
  ]);

  assert.equal(
    result.issues.some((issue) => issue.type === "number"),
    false,
  );
});

test("flags strong certainty and universal scope introduced from nowhere", () => {
  const result = analyzeLineage([
    {
      id: "source",
      label: "Source",
      text: "Users reported an improvement.",
    },
    {
      id: "agent",
      label: "Agent",
      text: "The study proves all users improved.",
    },
  ]);

  assert.ok(result.issues.some((issue) => issue.type === "certainty"));
  assert.ok(result.issues.some((issue) => issue.type === "quantifier"));
});

test("does not treat an approval itself as a completed protected action", () => {
  const result = analyzeLineage(
    [
      {
        id: "source",
        label: "Source",
        text: "Prepare an article draft.",
      },
      {
        id: "agent",
        label: "Agent",
        text: "A human approved the article draft.",
      },
    ],
    "Human approval is required before publishing.",
  );

  assert.equal(
    result.issues.some(
      (issue) =>
        issue.type === "guardrail" &&
        issue.title === "Protected action appears completed",
    ),
    false,
  );
});

test("does not treat a negated action as completed", () => {
  const result = analyzeLineage(
    [
      {
        id: "source",
        label: "Request",
        text: "Prepare a customer email draft.",
      },
      {
        id: "draft",
        label: "Draft agent",
        text: "The customer email is ready but not sent.",
      },
    ],
    "Draft only. Do not send without approval.",
  );

  assert.equal(
    result.issues.some((issue) => issue.type === "guardrail"),
    false,
  );
});

test("keeps strong verbs scoped by an uncertainty qualifier", () => {
  const result = analyzeLineage([
    {
      id: "source",
      label: "Source",
      text: "The change is likely to help.",
    },
    {
      id: "agent",
      label: "Agent",
      text: "It is likely that the change will help.",
    },
    {
      id: "reviewer",
      label: "Reviewer",
      text: "The change will likely help.",
    },
  ]);

  assert.equal(
    result.issues.some((issue) => issue.type === "certainty"),
    false,
  );
});

test("does not let a hedge hide certainty after a contrast boundary", () => {
  const result = analyzeLineage([
    {
      id: "source",
      label: "Source",
      text: "The change is likely to help.",
    },
    {
      id: "agent",
      label: "Agent",
      text:
        "The change is likely to help, but it will definitely eliminate the problem.",
    },
  ]);

  assert.equal(
    result.issues.some((issue) => issue.type === "certainty"),
    true,
  );
});

test("supports inspectable domain rules without changing the core detector", () => {
  const result = analyzeLineage(
    [
      {
        id: "source",
        label: "Source",
        text: "The sample was stored at -80 degrees.",
      },
      {
        id: "agent",
        label: "Agent",
        text: "The sample was stored at room temperature.",
      },
    ],
    "",
    {
      rules: [
        {
          id: "cold-chain",
          family: "evidence",
          evaluate: ({ from, to }) =>
            from.text.includes("-80") &&
            /room temperature/i.test(to.text)
              ? {
                  severity: "high",
                  title: "Cold-chain requirement changed",
                  explanation:
                    "The domain rule detected a storage-temperature mutation.",
                  beforeTerms: ["-80"],
                  afterTerms: ["room temperature"],
                }
              : null,
        },
      ],
    },
  );

  const issue = result.issues.find((item) => item.type === "custom");
  assert.equal(issue?.family, "evidence");
  assert.match(issue?.id ?? "", /cold-chain/);
});

test("treats equivalent numeric rewrites as the same claim", () => {
  const equivalentPairs: Array<[string, string]> = [
    ["The budget is $5k for the quarter.", "The budget is $5,000 for the quarter."],
    ["Administer 500mg of the compound daily.", "Administer 0.5g of the compound daily."],
    ["The deadline is 2026-07-24.", "The deadline is July 24, 2026."],
    ["The distance is 5 kilometers.", "The distance is 5km."],
    ["The cost is $2 million.", "The cost is $2,000,000."],
  ];

  for (const [before, after] of equivalentPairs) {
    const result = analyzeLineage([
      { id: "source", label: "Source", text: before },
      { id: "agent", label: "Agent", text: after },
    ]);
    assert.equal(
      result.issues.some((issue) => issue.type === "number"),
      false,
      `expected no number issue for "${before}" -> "${after}"`,
    );
  }
});

test("still flags real numeric mutations after canonicalization", () => {
  const mutatedPairs: Array<[string, string]> = [
    ["The deadline is July 24, 2026.", "The deadline is July 27, 2026."],
    ["The budget is $5k.", "The budget is $50,000."],
    ["Administer 500mg daily.", "Administer 5g daily."],
  ];

  for (const [before, after] of mutatedPairs) {
    const result = analyzeLineage([
      { id: "source", label: "Source", text: before },
      { id: "agent", label: "Agent", text: after },
    ]);
    assert.equal(
      result.issues.some((issue) => issue.type === "number"),
      true,
      `expected a number issue for "${before}" -> "${after}"`,
    );
  }
});

test("detects written-out number mutations next to measurable nouns", () => {
  const mutated = analyzeLineage([
    { id: "source", label: "Source", text: "Three customers reported the issue." },
    { id: "agent", label: "Agent", text: "Five customers reported the issue." },
  ]);
  assert.equal(
    mutated.issues.some((issue) => issue.type === "number"),
    true,
  );

  const equivalent = analyzeLineage([
    { id: "source", label: "Source", text: "Three customers reported the issue." },
    { id: "agent", label: "Agent", text: "3 customers reported the issue." },
  ]);
  assert.equal(
    equivalent.issues.some((issue) => issue.type === "number"),
    false,
  );

  const idiom = analyzeLineage([
    {
      id: "source",
      label: "Source",
      text: "One of the reasons is response time for our customers.",
    },
    {
      id: "agent",
      label: "Agent",
      text: "Response time matters to our customers.",
    },
  ]);
  assert.equal(
    idiom.issues.some((issue) => issue.type === "number"),
    false,
  );
});

test("never reports an unreadable script as clean", () => {
  const result = analyzeLineage([
    {
      id: "source",
      label: "Source",
      text: "返金はまだ確定していません。現在確認中です。",
    },
    {
      id: "agent",
      label: "Agent",
      text: "返金は確定しました。お客様に案内しました。",
    },
  ]);

  const coverageIssue = result.issues.find(
    (issue) => issue.type === "coverage",
  );
  assert.ok(coverageIssue);
  assert.equal(coverageIssue.severity, "low");
  assert.notEqual(result.overallSeverity, "clean");

  const english = analyzeLineage([
    { id: "source", label: "Source", text: "The estimate may be 5% for some users this quarter." },
    { id: "agent", label: "Agent", text: "The estimate may be 5% for some users this quarter." },
  ]);
  assert.equal(
    english.issues.some((issue) => issue.type === "coverage"),
    false,
  );
});

test("fails closed when a stage is empty", () => {
  const result = analyzeLineage([
    {
      id: "source",
      label: "Source",
      text: "The estimate remains 12% pending verification.",
    },
    {
      id: "agent",
      label: "Agent",
      text: "   ",
    },
  ]);

  const coverageIssue = result.issues.find(
    (issue) => issue.title === "Stage content is missing",
  );
  assert.ok(coverageIssue);
  assert.equal(coverageIssue.severity, "high");
  assert.equal(result.firstMutationIndex, 0);
  assert.equal(result.overallSeverity, "high");
});

test("rejects duplicate custom rules and malformed findings", () => {
  const stages = [
    { id: "source", label: "Source", text: "The estimate may be 5%." },
    { id: "agent", label: "Agent", text: "The estimate may be 5%." },
  ];
  const validRule = {
    id: "domain-check",
    family: "evidence" as const,
    evaluate: () => null,
  };

  assert.throws(
    () =>
      analyzeLineage(stages, "", {
        rules: [validRule, validRule],
      }),
    /duplicated/i,
  );
  assert.throws(
    () =>
      analyzeLineage(stages, "", {
        rules: [
          {
            ...validRule,
            evaluate: () => ({
              severity: "critical",
              title: "Invalid severity",
              explanation: "This must fail closed.",
            }),
          } as never,
        ],
      }),
    /invalid finding/i,
  );
});
