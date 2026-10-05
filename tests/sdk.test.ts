import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlainTextReport,
  LineageGuardRun,
  runReliabilityPipeline,
  type CustomLineageRule,
  type TraceStage,
} from "../sdk/index.ts";

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

test("setGuardrail replaces the run guardrail before finalize", () => {
  const run = new LineageGuardRun({ runName: "Guardrail swap" })
    .recordSource("Support request", "Prepare a draft offering a 15% credit.")
    .recordHandoff(
      "email-agent",
      "Email agent",
      "I emailed the customer and offered a 15% credit.",
    );
  assert.equal(run.toTrace().guardrail, "");

  run.setGuardrail(
    "  Draft only. Do not contact the customer without approval.  ",
  );
  assert.equal(
    run.toTrace().guardrail,
    "Draft only. Do not contact the customer without approval.",
  );
  assert.ok(
    run.finalize().modules.some(
      (module) =>
        module.id === "authority-firewall" && module.status === "flagged",
    ),
  );
});

const mutationStages: TraceStage[] = [
  { id: "source", label: "Source", text: "Some users may see 5%." },
  { id: "agent", label: "Agent", text: "All users will see 5%." },
];

test("buildPlainTextReport renders the analysis as plain text", () => {
  const report = runReliabilityPipeline(mutationStages, "");
  const text = buildPlainTextReport(report.analysis, mutationStages);

  assert.match(text, /^LINEAGEGUARD REPORT\n/);
  assert.match(text, /First mutation: Source → Agent/);
  assert.ok(
    text.includes(`[${report.analysis.issues[0].severity.toUpperCase()}]`),
  );

  const cleanStages: TraceStage[] = [
    mutationStages[0],
    { ...mutationStages[0], id: "copy", label: "Copy" },
  ];
  const cleanText = buildPlainTextReport(
    runReliabilityPipeline(cleanStages, "").analysis,
    cleanStages,
  );
  assert.match(cleanText, /First mutation: No mutation detected/);
  assert.match(cleanText, /No structured claim mutations were detected/);
});

test("includeBuiltInRules: false evaluates custom rules without the built-in families", () => {
  const marker: CustomLineageRule = {
    id: "custom-marker",
    family: "meaning",
    evaluate: () => ({
      severity: "low",
      title: "Custom marker",
      explanation: "Always fires.",
    }),
  };

  const withBuiltIns = runReliabilityPipeline(mutationStages, "", {
    rules: [marker],
  });
  assert.ok(
    withBuiltIns.analysis.issues.some((issue) => issue.type !== "custom"),
  );
  assert.ok(
    withBuiltIns.analysis.issues.some((issue) => issue.type === "custom"),
  );

  const customOnly = runReliabilityPipeline(mutationStages, "", {
    rules: [marker],
    includeBuiltInRules: false,
  });
  assert.deepEqual(
    customOnly.analysis.issues.map((issue) => issue.type),
    ["custom"],
  );
});
