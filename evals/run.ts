import { runReliabilityPipeline } from "../lib/pipeline.ts";
import { evaluationCases } from "./cases.ts";

const severityRank = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
} as const;

const threshold = "medium" as const;
let truePositives = 0;
let trueNegatives = 0;
let falsePositives = 0;
let falseNegatives = 0;
let expectedIssueCount = 0;
let matchedIssueCount = 0;
const failures: string[] = [];

for (const evaluationCase of evaluationCases) {
  const report = runReliabilityPipeline(
    evaluationCase.stages,
    evaluationCase.guardrail ?? "",
  );
  const predictedBlocked =
    severityRank[report.analysis.overallSeverity] >= severityRank[threshold];

  if (evaluationCase.expectedBlocked && predictedBlocked) truePositives += 1;
  if (!evaluationCase.expectedBlocked && !predictedBlocked) trueNegatives += 1;
  if (!evaluationCase.expectedBlocked && predictedBlocked) {
    falsePositives += 1;
    failures.push(`${evaluationCase.id}: unexpected block`);
  }
  if (evaluationCase.expectedBlocked && !predictedBlocked) {
    falseNegatives += 1;
    failures.push(`${evaluationCase.id}: expected a block`);
  }

  const actualTypes = new Set(
    report.analysis.issues
      .filter(
        (issue) =>
          severityRank[issue.severity] >= severityRank[threshold],
      )
      .map((issue) => issue.type),
  );
  for (const expectedType of evaluationCase.expectedIssueTypes ?? []) {
    expectedIssueCount += 1;
    if (actualTypes.has(expectedType)) {
      matchedIssueCount += 1;
    } else {
      failures.push(
        `${evaluationCase.id}: missing expected ${expectedType} signal`,
      );
    }
  }
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

const metrics = {
  cases: evaluationCases.length,
  blockedCases: truePositives + falseNegatives,
  allowedCases: trueNegatives + falsePositives,
  precision: ratio(truePositives, truePositives + falsePositives),
  recall: ratio(truePositives, truePositives + falseNegatives),
  specificity: ratio(trueNegatives, trueNegatives + falsePositives),
  falsePositiveRate: ratio(
    falsePositives,
    falsePositives + trueNegatives,
  ),
  expectedIssueCoverage: ratio(matchedIssueCount, expectedIssueCount),
};

const minimums = {
  precision: 0.9,
  recall: 0.9,
  specificity: 0.9,
  expectedIssueCoverage: 0.9,
};

console.log(
  JSON.stringify(
    {
      dataset: "curated-regression-v1",
      threshold,
      metrics,
      minimums,
      failures,
    },
    null,
    2,
  ),
);

const belowMinimum =
  metrics.precision < minimums.precision ||
  metrics.recall < minimums.recall ||
  metrics.specificity < minimums.specificity ||
  metrics.expectedIssueCoverage < minimums.expectedIssueCoverage;

if (process.argv.includes("--check") && (belowMinimum || failures.length)) {
  process.exitCode = 1;
}
