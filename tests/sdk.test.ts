import assert from "node:assert/strict";
import test from "node:test";
import { LineageGuardRun } from "../sdk/index.ts";

test("instruments an agent run through the reusable SDK", () => {
  const run = new LineageGuardRun({
    runName: "Customer support workflow",
    guardrail: "Draft only. Do not contact the customer without approval.",
  })
    .recordSource(
      "Support request",
      "Prepare a draft offering a 15% credit.",
    )
    .recordHandoff(
      "draft-agent",
      "Draft agent",
      "Draft only: offer a 15% credit after approval.",
    )
    .recordHandoff(
      "email-agent",
      "Email agent",
      "I emailed the customer and offered a 15% credit.",
    );

  const report = run.finalize();
  assert.equal(report.analysis.firstMutationIndex, 1);
  assert.equal(report.recovery.restartStageLabel, "Email agent");
  assert.ok(
    report.modules.some(
      (module) =>
        module.id === "authority-firewall" && module.status === "flagged",
    ),
  );
});

test("builds an SDK run from the generic JSON contract", () => {
  const run = LineageGuardRun.fromPayload({
    runName: "Imported",
    stages: [
      { id: "source", label: "Source", text: "Some users may see 5%." },
      { id: "agent", label: "Agent", text: "All users will see 5%." },
    ],
  });

  assert.equal(run.toTrace().runName, "Imported");
  assert.equal(run.finalize().analysis.firstMutationIndex, 0);
});
