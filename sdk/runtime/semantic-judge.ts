import type { CustomLineageRule } from "../../lib/analysis.ts";
import { validateSemanticFinding } from "./snapshot.ts";
import {
  SEMANTIC_JUDGE_RULE_ID,
  type AnalysisMode,
  type SemanticJudge,
  type SemanticJudgeContext,
  type SemanticJudgeFinding,
} from "./types.ts";

export type SemanticJudgeRun = {
  judge: SemanticJudge;
  timeoutMs: number;
  failureMode: "block" | "warn";
  analysisMode: AnalysisMode;
  context: Omit<SemanticJudgeContext, "signal">;
};

export type SemanticJudgeOutcome = {
  /** Validated findings to store for the transition; empty means clean. */
  findings: SemanticJudgeFinding[];
  /** The failure message when the judge threw, rejected or timed out. */
  failure: string | null;
};

/**
 * Runs the judge under its timeout. A failure never propagates: it becomes a
 * finding whose severity follows `failureMode`, so the deterministic gate
 * decides whether the handoff blocks or warns.
 */
export async function runSemanticJudge(
  run: SemanticJudgeRun,
): Promise<SemanticJudgeOutcome> {
  try {
    const findings = await raceSemanticJudge(
      run.judge,
      run.context,
      run.timeoutMs,
    );
    return {
      findings: (findings ?? []).map(validateSemanticFinding),
      failure: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown judge failure.";
    return {
      findings: [
        semanticJudgeFailureFinding(message, run.failureMode, run.analysisMode),
      ],
      failure: message,
    };
  }
}

/**
 * Races the judge against `timeoutMs`. A timeout aborts the signal handed to
 * the judge and rejects, so the caller treats it as an ordinary judge
 * failure.
 */
async function raceSemanticJudge(
  judge: SemanticJudge,
  context: Omit<SemanticJudgeContext, "signal">,
  timeoutMs: number,
): Promise<SemanticJudgeFinding[] | null> {
  const controller = new AbortController();
  const judged = judge(Object.freeze({ ...context, signal: controller.signal }));
  if (
    judged === null ||
    typeof judged !== "object" ||
    typeof (judged as Promise<unknown>).then !== "function"
  ) {
    return judged as SemanticJudgeFinding[] | null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `The semantic judge timed out after ${timeoutMs} ms.`,
      );
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    // Promise.race subscribes to the judge promise, so a rejection that
    // arrives after the timeout is observed rather than unhandled.
    return await Promise.race([judged, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function semanticJudgeFailureFinding(
  message: string,
  failureMode: "block" | "warn",
  analysisMode: AnalysisMode,
): SemanticJudgeFinding {
  const failClosed = failureMode === "block";
  return {
    severity: failClosed ? "high" : "low",
    title: "Semantic judge unavailable",
    explanation: failClosed
      ? `The configured semantic judge failed (${message}). Failing closed: this handoff needs human review before downstream agents run.`
      : analysisMode === "semantic"
        ? `The configured semantic judge failed (${message}). Semantic-only mode has no lexical fallback, so this low-severity failure signal is the only review evidence for the handoff.`
        : `The configured semantic judge failed (${message}). The deterministic rule families still apply, but semantic drift was not reviewed for this handoff.`,
  };
}

/**
 * Replays accepted judge findings into every subsequent pipeline run through
 * a reserved built-in rule, so reports stay reproducible.
 */
export function semanticReplayRule(
  semanticFindings: ReadonlyMap<number, SemanticJudgeFinding[]>,
): CustomLineageRule {
  return {
    id: SEMANTIC_JUDGE_RULE_ID,
    family: "meaning",
    evaluate: ({ transitionIndex }) => {
      const findings = semanticFindings.get(transitionIndex);
      if (!findings?.length) return null;
      return findings.map((finding, index) => ({
        id: `${transitionIndex}-${index + 1}`,
        severity: finding.severity,
        title: finding.title,
        explanation: finding.explanation,
      }));
    },
  };
}
