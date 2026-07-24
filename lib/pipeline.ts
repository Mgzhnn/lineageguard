import {
  analyzeLineage,
  getTraceSignalSnapshot,
  type AnalysisResult,
  type IssueType,
  type Severity,
  type TraceSignalSnapshot,
  type TraceStage,
} from "./analysis.ts";
import { PIPELINE_VERSION } from "./version.ts";

export type PipelineModuleId =
  | "trace-collector"
  | "claim-lineage"
  | "evidence-sentinel"
  | "meaning-sentinel"
  | "authority-firewall"
  | "contamination-tracer"
  | "recovery-orchestrator";

export type PipelineModuleStatus = "complete" | "flagged" | "ready";

export type PipelineModuleResult = {
  id: PipelineModuleId;
  name: string;
  mandate: string;
  status: PipelineModuleStatus;
  findingCount: number;
  summary: string;
  issueTypes: IssueType[];
};

export type ClaimGraphNode = {
  id: string;
  stageIndex: number;
  label: string;
  text: string;
  signals: TraceSignalSnapshot;
  state: "verified" | "first-break" | "downstream" | "clean";
};

export type ClaimGraphEdge = {
  id: string;
  from: string;
  to: string;
  severity: Severity | "clean";
  issueTypes: IssueType[];
  issueCount: number;
};

export type RecoveryAction = {
  id: string;
  owner: string;
  title: string;
  instruction: string;
  blocking: boolean;
};

export type RecoveryPacket = {
  status: "not-required" | "review-required";
  restartStageIndex: number | null;
  restartStageLabel: string | null;
  lastVerifiedLabel: string | null;
  lastVerifiedText: string | null;
  rejectedText: string | null;
  protectedInstruction: string;
  actions: RecoveryAction[];
};

export type ReliabilityPipelineRun = {
  id: string;
  version: typeof PIPELINE_VERSION;
  analysis: AnalysisResult;
  graph: {
    nodes: ClaimGraphNode[];
    edges: ClaimGraphEdge[];
  };
  modules: PipelineModuleResult[];
  ruleFamilyAgreement: {
    active: number;
    total: 3;
    transitionIndex: number | null;
    summary: string;
  };
  recovery: RecoveryPacket;
};

export type ReliabilityPipelineOptions = {
  recoveryTransitionIndex?: number | null;
};

const issueFamily: Record<IssueType, "evidence" | "meaning" | "authority"> = {
  number: "evidence",
  certainty: "meaning",
  quantifier: "meaning",
  negation: "meaning",
  guardrail: "authority",
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function moduleResult(
  id: PipelineModuleId,
  name: string,
  mandate: string,
  issueTypes: IssueType[],
  findingCount: number,
  summary: string,
  status?: PipelineModuleStatus,
): PipelineModuleResult {
  return {
    id,
    name,
    mandate,
    status: status ?? (findingCount ? "flagged" : "complete"),
    findingCount,
    summary,
    issueTypes,
  };
}

function buildRecoveryPacket(
  stages: TraceStage[],
  guardrail: string,
  analysis: AnalysisResult,
  recoveryTransitionIndex?: number | null,
): RecoveryPacket {
  const failedTransition =
    recoveryTransitionIndex === undefined
      ? analysis.firstMutationIndex
      : recoveryTransitionIndex;
  if (failedTransition === null) {
    return {
      status: "not-required",
      restartStageIndex: null,
      restartStageLabel: null,
      lastVerifiedLabel: stages.at(-1)?.label ?? null,
      lastVerifiedText: stages.at(-1)?.text ?? null,
      rejectedText: null,
      protectedInstruction: guardrail,
      actions: [],
    };
  }

  const verifiedIndex = failedTransition;
  const restartIndex = verifiedIndex + 1;
  const verified = stages[verifiedIndex];
  const rejected = stages[restartIndex];
  const actions: RecoveryAction[] = [
    {
      id: "freeze",
      owner: "Runtime",
      title: "Freeze contaminated descendants",
      instruction: `Do not release outputs from ${rejected.label} or any later stage until review is complete.`,
      blocking: true,
    },
    {
      id: "restore",
      owner: "Lineage controller",
      title: "Restore the last verified checkpoint",
      instruction: `Use “${verified.text}” as the authoritative claim for the retry.`,
      blocking: true,
    },
    ...(guardrail.trim()
      ? [
          {
            id: "reattach-policy",
            owner: "Authority firewall",
            title: "Reattach inherited restrictions",
            instruction: `Carry this protected instruction into the retry: “${guardrail.trim()}”`,
            blocking: true,
          },
        ]
      : []),
    {
      id: "retry",
      owner: rejected.label,
      title: "Retry only from the failed handoff",
      instruction: `Restart at ${rejected.label}; earlier verified stages do not need to run again.`,
      blocking: false,
    },
    {
      id: "approve",
      owner: "Human reviewer",
      title: "Approve before downstream execution",
      instruction:
        "Compare the repaired output with the source evidence and explicitly approve the chain before external action.",
      blocking: true,
    },
  ];

  return {
    status: "review-required",
    restartStageIndex: restartIndex,
    restartStageLabel: rejected.label,
    lastVerifiedLabel: verified.label,
    lastVerifiedText: verified.text,
    rejectedText: rejected.text,
    protectedInstruction: guardrail,
    actions,
  };
}

export function runReliabilityPipeline(
  stages: TraceStage[],
  guardrail = "",
  options: ReliabilityPipelineOptions = {},
): ReliabilityPipelineRun {
  const analysis = analyzeLineage(stages, guardrail);
  const firstBreakDestination =
    analysis.firstMutationIndex === null
      ? null
      : analysis.firstMutationIndex + 1;
  const graphNodes: ClaimGraphNode[] = stages.map((stage, stageIndex) => {
    let state: ClaimGraphNode["state"] = "clean";
    if (firstBreakDestination !== null) {
      if (stageIndex < firstBreakDestination) state = "verified";
      if (stageIndex === firstBreakDestination) state = "first-break";
      if (stageIndex > firstBreakDestination) state = "downstream";
    }
    return {
      id: stage.id,
      stageIndex,
      label: stage.label,
      text: stage.text,
      signals: getTraceSignalSnapshot(stage.text),
      state,
    };
  });
  const graphEdges: ClaimGraphEdge[] = analysis.transitions.map(
    (transition, transitionIndex) => {
      const edgeIssues = analysis.issues.filter(
        (issue) => issue.transitionIndex === transitionIndex,
      );
      return {
        id: `${stages[transitionIndex].id}-${stages[transitionIndex + 1].id}`,
        from: stages[transitionIndex].id,
        to: stages[transitionIndex + 1].id,
        severity: transition.severity,
        issueTypes: unique(edgeIssues.map((issue) => issue.type)),
        issueCount: edgeIssues.length,
      };
    },
  );

  const numberIssues = analysis.issues.filter(
    (issue) => issue.type === "number",
  );
  const meaningIssues = analysis.issues.filter((issue) =>
    ["certainty", "quantifier", "negation"].includes(issue.type),
  );
  const authorityIssues = analysis.issues.filter(
    (issue) => issue.type === "guardrail",
  );
  const activeFamilies = unique(
    analysis.issues
      .filter(
        (issue) =>
          analysis.firstMutationIndex === null ||
          issue.transitionIndex === analysis.firstMutationIndex,
      )
      .map((issue) => issueFamily[issue.type]),
  );
  const firstBreakName =
    analysis.firstMutationIndex === null
      ? "no failed transition"
      : `${stages[analysis.firstMutationIndex].label} → ${
          stages[analysis.firstMutationIndex + 1].label
        }`;
  const recovery = buildRecoveryPacket(
    stages,
    guardrail,
    analysis,
    options.recoveryTransitionIndex,
  );

  const modules: PipelineModuleResult[] = [
    moduleResult(
      "trace-collector",
      "Trace Collector",
      "Validate and order every source and handoff.",
      [],
      0,
      `${stages.length} stages and ${Math.max(
        0,
        stages.length - 1,
      )} handoffs accepted.`,
      "complete",
    ),
    moduleResult(
      "claim-lineage",
      "Claim Lineage Mapper",
      "Build the claim graph and preserve ancestry.",
      [],
      0,
      `${graphNodes.length} claim nodes linked by ${graphEdges.length} directed edges.`,
      "complete",
    ),
    moduleResult(
      "evidence-sentinel",
      "Evidence Sentinel",
      "Protect numeric evidence, ranges, quantities, and units.",
      ["number"],
      numberIssues.length,
      numberIssues.length
        ? `${numberIssues.length} evidence mutation${
            numberIssues.length === 1 ? "" : "s"
          } found.`
        : "Numeric evidence stayed stable.",
    ),
    moduleResult(
      "meaning-sentinel",
      "Meaning Sentinel",
      "Detect confidence, scope, and negation changes.",
      ["certainty", "quantifier", "negation"],
      meaningIssues.length,
      meaningIssues.length
        ? `${meaningIssues.length} meaning boundary signal${
            meaningIssues.length === 1 ? "" : "s"
          } found.`
        : "Confidence, scope, and polarity stayed stable.",
    ),
    moduleResult(
      "authority-firewall",
      "Authority Firewall",
      "Enforce inherited restrictions and human approvals.",
      ["guardrail"],
      authorityIssues.length,
      authorityIssues.length
        ? `${authorityIssues.length} authority violation${
            authorityIssues.length === 1 ? "" : "s"
          } found.`
        : guardrail.trim()
          ? "Protected instruction remained intact."
          : "No protected instruction was supplied.",
    ),
    moduleResult(
      "contamination-tracer",
      "Contamination Tracer",
      "Calculate which descendants inherit the first failure.",
      [],
      0,
      analysis.firstMutationIndex === null
        ? "No contaminated descendants."
        : `${analysis.contaminatedOutputs} output${
            analysis.contaminatedOutputs === 1 ? "" : "s"
          } at or after ${firstBreakName}.`,
      "complete",
    ),
    moduleResult(
      "recovery-orchestrator",
      "Recovery Orchestrator",
      "Create the smallest safe rollback and retry plan.",
      [],
      recovery.actions.length,
      recovery.status === "not-required"
        ? "No rollback required."
        : `${recovery.actions.length} recovery actions prepared; restart at ${recovery.restartStageLabel}.`,
      "ready",
    ),
  ];

  const identity = stableHash(
    `${guardrail}|${stages
      .map((stage) => `${stage.label}:${stage.text}`)
      .join("|")}`,
  );

  return {
    id: `RUN-${identity}`,
    version: PIPELINE_VERSION,
    analysis,
    graph: {
      nodes: graphNodes,
      edges: graphEdges,
    },
    modules,
    ruleFamilyAgreement: {
      active: activeFamilies.length,
      total: 3,
      transitionIndex: analysis.firstMutationIndex,
      summary:
        analysis.firstMutationIndex === null
          ? "All three rule families report a stable chain."
          : `${activeFamilies.length}/3 rule families flagged ${firstBreakName}. This is rule agreement, not a probability score.`,
    },
    recovery,
  };
}
