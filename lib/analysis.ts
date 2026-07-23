export type IssueType =
  | "number"
  | "certainty"
  | "quantifier"
  | "negation"
  | "guardrail";

export type Severity = "high" | "medium" | "low";

export type TraceStage = {
  id: string;
  label: string;
  text: string;
};

export type LineageIssue = {
  id: string;
  type: IssueType;
  severity: Severity;
  transitionIndex: number;
  fromLabel: string;
  toLabel: string;
  title: string;
  explanation: string;
  before: string;
  after: string;
};

export type TransitionResult = {
  fromLabel: string;
  toLabel: string;
  issueCount: number;
  severity: Severity | "clean";
};

export type AnalysisResult = {
  issues: LineageIssue[];
  transitions: TransitionResult[];
  firstMutationIndex: number | null;
  contaminatedOutputs: number;
  overallSeverity: Severity | "clean";
};

export type TraceSignalSnapshot = {
  numbers: string[];
  certainty: string | null;
  certaintyRank: number | null;
  scope: string | null;
  scopeRank: number | null;
  negations: string[];
  completedActions: string[];
};

type RankedTerm = {
  term: string;
  rank: number;
};

const certaintyTerms: RankedTerm[] = [
  { term: "may", rank: 0 },
  { term: "might", rank: 0 },
  { term: "could", rank: 0 },
  { term: "possibly", rank: 0 },
  { term: "possible", rank: 0 },
  { term: "appears", rank: 0 },
  { term: "suggests", rank: 0 },
  { term: "estimated", rank: 0 },
  { term: "approximately", rank: 0 },
  { term: "likely", rank: 1 },
  { term: "indicates", rank: 1 },
  { term: "supports", rank: 1 },
  { term: "expected", rank: 1 },
  { term: "shows", rank: 2 },
  { term: "demonstrates", rank: 2 },
  { term: "will", rank: 2 },
  { term: "confirmed", rank: 3 },
  { term: "proves", rank: 3 },
  { term: "proven", rank: 3 },
  { term: "guarantees", rank: 3 },
  { term: "definitely", rank: 3 },
  { term: "certainly", rank: 3 },
];

const quantifierTerms: RankedTerm[] = [
  { term: "a few", rank: 0 },
  { term: "few", rank: 0 },
  { term: "some", rank: 0 },
  { term: "several", rank: 1 },
  { term: "many", rank: 2 },
  { term: "most", rank: 3 },
  { term: "all", rank: 4 },
  { term: "every", rank: 4 },
  { term: "always", rank: 4 },
  { term: "none", rank: 4 },
  { term: "never", rank: 4 },
];

const negationPattern =
  /\b(?:not|no|never|without|cannot|can't|won't|isn't|aren't|doesn't|don't|didn't|must not|do not)\b/gi;

const completedActionPattern =
  /\b(?:sent|emailed|contacted|published|posted|deleted|purchased|bought|booked|deployed|executed|transferred|submitted|approved|released|shared)\b/gi;

const guardedActionPattern =
  /\b(?:do not|don't|must not|never|draft only|human approval|approval required|before approval|no external action|without approval|do not send|do not contact|do not publish)\b/i;

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const severityWeight: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTerms(text: string, terms: RankedTerm[]) {
  const normalized = normalize(text);
  return terms.filter(({ term }) => {
    const match = new RegExp(`\\b${escapeRegex(term)}\\b`, "i").exec(normalized);
    if (!match) return false;
    const prefix = normalized.slice(Math.max(0, match.index - 18), match.index);
    return !/\b(?:not|no|never)\s+(?:been\s+)?$/i.test(prefix);
  });
}

function highestRankedTerm(text: string, terms: RankedTerm[]) {
  const found = findTerms(text, terms);
  if (!found.length) return null;
  return found.reduce((highest, candidate) =>
    candidate.rank > highest.rank ? candidate : highest,
  );
}

function extractNumberClaims(text: string) {
  const numberPattern =
    /(?:[$€£₩]\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:-|–|—|to)\s*(?:[$€£₩]\s*)?\d[\d,]*(?:\.\d+)?)?(?:\s*(?:%|percent|percentage points?|k|m|b|thousand|million|billion|seconds?|minutes?|hours?|days?|weeks?|months?|years?|people|users?|customers?|cases?|degrees?))?/gi;
  return unique(
    [...text.matchAll(numberPattern)]
      .map((match) => normalize(match[0]).replace(/,/g, ""))
      .filter(Boolean),
  );
}

function extractNegations(text: string) {
  return unique(
    [...text.matchAll(negationPattern)].map((match) => normalize(match[0])),
  );
}

export function getTraceSignalSnapshot(text: string): TraceSignalSnapshot {
  const certainty = highestRankedTerm(text, certaintyTerms);
  const scope = highestRankedTerm(text, quantifierTerms);
  const completedActions = unique(
    [...normalize(text).matchAll(completedActionPattern)].map(
      (match) => match[0],
    ),
  );

  return {
    numbers: extractNumberClaims(text),
    certainty: certainty?.term ?? null,
    certaintyRank: certainty?.rank ?? null,
    scope: scope?.term ?? null,
    scopeRank: scope?.rank ?? null,
    negations: extractNegations(text),
    completedActions,
  };
}

function importantGuardrailWords(text: string) {
  return unique(
    normalize(text)
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  );
}

function excerpt(text: string, terms: string[]) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "—";
  const lower = compact.toLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];

  if (index === undefined) {
    return compact.length > 150 ? `${compact.slice(0, 147)}…` : compact;
  }

  const start = Math.max(0, index - 54);
  const end = Math.min(compact.length, index + 96);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${
    end < compact.length ? "…" : ""
  }`;
}

function makeIssue(
  type: IssueType,
  severity: Severity,
  transitionIndex: number,
  from: TraceStage,
  to: TraceStage,
  title: string,
  explanation: string,
  beforeTerms: string[],
  afterTerms: string[],
): LineageIssue {
  return {
    id: `${transitionIndex}-${type}-${title}`,
    type,
    severity,
    transitionIndex,
    fromLabel: from.label,
    toLabel: to.label,
    title,
    explanation,
    before: excerpt(from.text, beforeTerms),
    after: excerpt(to.text, afterTerms),
  };
}

function analyzeTransition(
  from: TraceStage,
  to: TraceStage,
  transitionIndex: number,
): LineageIssue[] {
  const issues: LineageIssue[] = [];
  const beforeNumbers = extractNumberClaims(from.text);
  const afterNumbers = extractNumberClaims(to.text);
  const removedNumbers = beforeNumbers.filter(
    (value) => !afterNumbers.includes(value),
  );
  const addedNumbers = afterNumbers.filter(
    (value) => !beforeNumbers.includes(value),
  );

  if (removedNumbers.length || addedNumbers.length) {
    issues.push(
      makeIssue(
        "number",
        "high",
        transitionIndex,
        from,
        to,
        "Numeric claim changed",
        `The numeric evidence changed from ${
          beforeNumbers.join(", ") || "no number"
        } to ${afterNumbers.join(", ") || "no number"}. Check ranges, units, and rounding.`,
        removedNumbers.length ? removedNumbers : beforeNumbers,
        addedNumbers.length ? addedNumbers : afterNumbers,
      ),
    );
  }

  const beforeCertainty = highestRankedTerm(from.text, certaintyTerms);
  const afterCertainty = highestRankedTerm(to.text, certaintyTerms);
  if (
    beforeCertainty &&
    afterCertainty &&
    afterCertainty.rank > beforeCertainty.rank
  ) {
    issues.push(
      makeIssue(
        "certainty",
        afterCertainty.rank === 3 ? "high" : "medium",
        transitionIndex,
        from,
        to,
        "Confidence was inflated",
        `Language moved from “${beforeCertainty.term}” to “${afterCertainty.term}”, making the claim sound more certain than the previous handoff.`,
        [beforeCertainty.term],
        [afterCertainty.term],
      ),
    );
  }

  const beforeQuantifier = highestRankedTerm(from.text, quantifierTerms);
  const afterQuantifier = highestRankedTerm(to.text, quantifierTerms);
  if (
    beforeQuantifier &&
    afterQuantifier &&
    afterQuantifier.rank > beforeQuantifier.rank
  ) {
    issues.push(
      makeIssue(
        "quantifier",
        afterQuantifier.rank === 4 ? "high" : "medium",
        transitionIndex,
        from,
        to,
        "Scope became broader",
        `The population changed from “${beforeQuantifier.term}” to “${afterQuantifier.term}”. A limited claim may now read like a universal one.`,
        [beforeQuantifier.term],
        [afterQuantifier.term],
      ),
    );
  }

  const beforeNegations = extractNegations(from.text);
  const afterNegations = extractNegations(to.text);
  if (beforeNegations.length && !afterNegations.length) {
    issues.push(
      makeIssue(
        "negation",
        "high",
        transitionIndex,
        from,
        to,
        "A negative condition disappeared",
        `The earlier handoff contained ${beforeNegations
          .map((term) => `“${term}”`)
          .join(", ")}, but the next handoff contains no explicit negation.`,
        beforeNegations,
        [],
      ),
    );
  }

  return issues;
}

function analyzeGuardrail(
  guardrail: string,
  stages: TraceStage[],
): LineageIssue[] {
  const normalizedGuardrail = normalize(guardrail);
  if (!normalizedGuardrail || stages.length < 2) return [];

  const importantWords = importantGuardrailWords(guardrail);
  const expectsBlockedAction = guardedActionPattern.test(normalizedGuardrail);
  const issues: LineageIssue[] = [];

  for (let stageIndex = 1; stageIndex < stages.length; stageIndex += 1) {
    const current = stages[stageIndex];
    const previous = stages[stageIndex - 1];
    const currentNormalized = normalize(current.text);
    const previousNormalized = normalize(previous.text);
    const completedActions = unique(
      [...currentNormalized.matchAll(completedActionPattern)].map(
        (match) => match[0],
      ),
    );
    const retainedWords = importantWords.filter((word) =>
      new RegExp(`\\b${escapeRegex(word)}\\b`, "i").test(currentNormalized),
    );
    const retention =
      importantWords.length > 0 ? retainedWords.length / importantWords.length : 1;
    const previousRetainedWords = importantWords.filter((word) =>
      new RegExp(`\\b${escapeRegex(word)}\\b`, "i").test(previousNormalized),
    );
    const previousRetention =
      importantWords.length > 0
        ? previousRetainedWords.length / importantWords.length
        : 1;

    if (expectsBlockedAction && completedActions.length) {
      issues.push(
        makeIssue(
          "guardrail",
          "high",
          stageIndex - 1,
          previous,
          current,
          "Protected action appears completed",
          `The guardrail blocks or delays an external action, but this handoff says “${completedActions[0]}”. Human review is required.`,
          importantWords,
          completedActions,
        ),
      );
      break;
    }

    if (
      importantWords.length >= 2 &&
      previousRetention >= 0.3 &&
      retention < 0.3
    ) {
      issues.push(
        makeIssue(
          "guardrail",
          "medium",
          stageIndex - 1,
          previous,
          current,
          "Guardrail was not carried forward",
          `Only ${Math.round(
            retention * 100,
          )}% of the important restriction words survived this handoff.`,
          importantWords,
          retainedWords,
        ),
      );
      break;
    }
  }

  return issues;
}

function highestSeverity(
  issues: LineageIssue[],
): Severity | "clean" {
  return issues.reduce<Severity | "clean">(
    (highest, issue) =>
      severityWeight[issue.severity] > severityWeight[highest]
        ? issue.severity
        : highest,
    "clean",
  );
}

export function analyzeLineage(
  stages: TraceStage[],
  guardrail = "",
): AnalysisResult {
  const usableStages = stages.map((stage) => ({
    ...stage,
    text: stage.text.trim(),
  }));
  const issues: LineageIssue[] = [];

  for (let index = 0; index < usableStages.length - 1; index += 1) {
    const from = usableStages[index];
    const to = usableStages[index + 1];
    if (!from.text || !to.text) continue;
    issues.push(...analyzeTransition(from, to, index));
  }

  issues.push(...analyzeGuardrail(guardrail, usableStages));
  issues.sort(
    (a, b) =>
      a.transitionIndex - b.transitionIndex ||
      severityWeight[b.severity] - severityWeight[a.severity],
  );

  const firstMutationIndex = issues.length ? issues[0].transitionIndex : null;
  const transitions = usableStages.slice(0, -1).map((stage, index) => {
    const transitionIssues = issues.filter(
      (issue) => issue.transitionIndex === index,
    );
    return {
      fromLabel: stage.label,
      toLabel: usableStages[index + 1].label,
      issueCount: transitionIssues.length,
      severity: highestSeverity(transitionIssues),
    };
  });

  return {
    issues,
    transitions,
    firstMutationIndex,
    contaminatedOutputs:
      firstMutationIndex === null
        ? 0
        : Math.max(0, usableStages.length - firstMutationIndex - 1),
    overallSeverity: highestSeverity(issues),
  };
}

export function buildPlainTextReport(
  result: AnalysisResult,
  stages: TraceStage[],
) {
  const first =
    result.firstMutationIndex === null
      ? "No mutation detected"
      : `${stages[result.firstMutationIndex].label} → ${
          stages[result.firstMutationIndex + 1].label
        }`;
  const issueLines = result.issues.length
    ? result.issues.map(
        (issue, index) =>
          `${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title} — ${
            issue.fromLabel
          } → ${issue.toLabel}\n   ${issue.explanation}`,
      )
    : ["No structured claim mutations were detected."];

  return [
    "LINEAGEGUARD REPORT",
    `First mutation: ${first}`,
    `Outputs after first mutation: ${result.contaminatedOutputs}`,
    "",
    ...issueLines,
    "",
    "Note: heuristic warning only; verify important decisions with the source.",
  ].join("\n");
}
