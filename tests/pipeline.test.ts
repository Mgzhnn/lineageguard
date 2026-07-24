import assert from "node:assert/strict";
import test from "node:test";
import { runReliabilityPipeline } from "../lib/pipeline.ts";

const brokenStages = [
  {
    id: "source",
    label: "Source",
    text: "A pilot suggests the result may improve by 12–18%. It is not confirmed.",
  },
  {
    id: "research",
    label: "Research agent",
    text: "The pilot suggests the result may improve by 12–18%. It is not confirmed.",
  },
  {
    id: "writer",
    label: "Writing agent",
    text: "The pilot proves the result improves by 18%.",
  },
];

test("runs the complete reliability pipeline around one first break", () => {
  const run = runReliabilityPipeline(
    brokenStages,
    "Do not publish without human approval.",
  );

  assert.match(run.id, /^RUN-[A-F0-9]{8}$/);
  assert.equal(run.version, "0.3");
  assert.equal(run.graph.nodes.length, 3);
  assert.equal(run.graph.edges.length, 2);
  assert.equal(run.graph.nodes[2].state, "first-break");
  assert.equal(run.analysis.firstMutationIndex, 1);
  assert.ok(
    run.modules.some(
      (module) =>
        module.id === "evidence-sentinel" && module.status === "flagged",
    ),
  );
  assert.ok(
    run.modules.some(
      (module) =>
        module.id === "meaning-sentinel" && module.status === "flagged",
    ),
  );
  assert.equal(run.recovery.status, "review-required");
  assert.equal(run.recovery.restartStageLabel, "Writing agent");
  assert.ok(run.recovery.actions.some((action) => action.id === "freeze"));
  assert.ok(
    run.recovery.actions.some((action) => action.id === "reattach-policy"),
  );
});

test("returns a stable graph and no rollback for a clean run", () => {
  const stages = [
    {
      id: "source",
      label: "Source",
      text: "The estimate is 6% within 5 days, pending verification.",
    },
    {
      id: "agent",
      label: "Agent",
      text: "The estimate is 6% within 5 days, pending verification.",
    },
  ];
  const run = runReliabilityPipeline(stages);

  assert.equal(run.analysis.firstMutationIndex, null);
  assert.equal(run.recovery.status, "not-required");
  assert.equal(run.ruleFamilyAgreement.active, 0);
  assert.ok(run.graph.nodes.every((node) => node.state === "clean"));
});
