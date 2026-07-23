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
