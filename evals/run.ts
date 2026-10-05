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
// Cases tagged knownFailure document a real detector limitation. They count
// toward every metric, so the 0.9 minimums are the binding gate, but a miss on
// them is listed here instead of failing the check.
const knownFailures: string[] = [];

for (const evaluationCase of evaluationCases) {
  const report = runReliabilityPipeline(
    evaluationCase.stages,
    evaluationCase.guardrail ?? "",
  );
  const predictedBlocked =
    severityRank[report.analysis.overallSeverity] >= severityRank[threshold];
  const record = (message: string) => {
    (evaluationCase.knownFailure ? knownFailures : failures).push(message);
  };

  if (evaluationCase.expectedBlocked && predictedBlocked) truePositives += 1;
  if (!evaluationCase.expectedBlocked && !predictedBlocked) trueNegatives += 1;
  if (!evaluationCase.expectedBlocked && predictedBlocked) {
    falsePositives += 1;
    record(`${evaluationCase.id}: unexpected block`);
  }
  if (evaluationCase.expectedBlocked && !predictedBlocked) {
    falseNegatives += 1;
    record(`${evaluationCase.id}: expected a block`);
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
      record(`${evaluationCase.id}: missing expected ${expectedType} signal`);
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
      dataset: "curated-regression-v2",
      threshold,
      metrics,
      minimums,
      failures,
      knownFailures,
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
