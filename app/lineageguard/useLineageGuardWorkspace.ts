"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import {
  buildPlainTextReport,
  getTraceSignalSnapshot,
  type IssueType,
  type TraceStage,
} from "@/lib/analysis";
import { examples } from "@/lib/examples";
import { runReliabilityPipeline } from "@/lib/pipeline";
import {
  createSampleTracePayload,
  parseTracePayload,
  TRACE_LIMITS,
} from "@/lib/trace-schema";
import { PIPELINE_VERSION } from "@/lib/version";

export const issueLabels: Record<IssueType, string> = {
  number: "NUMBER DRIFT",
  certainty: "CONFIDENCE",
  quantifier: "SCOPE",
  negation: "NEGATION",
  guardrail: "GUARDRAIL",
  custom: "CUSTOM RULE",
};

type ReviewVerdict = "confirmed" | "dismissed";

function cloneStages(stages: TraceStage[]) {
  return stages.map((stage) => ({ ...stage }));
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useLineageGuardWorkspace() {
  const initialExample = examples[0];
  const [selectedExample, setSelectedExample] = useState(initialExample.id);
  const [stages, setStages] = useState<TraceStage[]>(
    cloneStages(initialExample.stages),
  );
  const [guardrail, setGuardrail] = useState(initialExample.guardrail);
  const [pipelineRun, setPipelineRun] = useState(() =>
    runReliabilityPipeline(initialExample.stages, initialExample.guardrail),
  );
  const result = pipelineRun.analysis;
  const [isFresh, setIsFresh] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [replayIndex, setReplayIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [reviews, setReviews] = useState<Record<string, ReviewVerdict>>({});
  const [pipelineCursor, setPipelineCursor] = useState(
    pipelineRun.modules.length,
  );
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [recoveryCopyState, setRecoveryCopyState] = useState<
    "idle" | "copied"
  >("idle");

  const firstMutation = useMemo(() => {
    if (result.firstMutationIndex === null) return null;
    return {
      from: stages[result.firstMutationIndex]?.label ?? "Previous step",
      to: stages[result.firstMutationIndex + 1]?.label ?? "Next step",
    };
  }, [result.firstMutationIndex, stages]);
  const signalSnapshots = useMemo(
    () => stages.map((stage) => getTraceSignalSnapshot(stage.text)),
    [stages],
  );
  const replaySnapshot =
    signalSnapshots[replayIndex] ?? getTraceSignalSnapshot("");
  const replayIssues = result.issues.filter(
    (issue) => issue.transitionIndex === replayIndex - 1,
  );
  const reportId = pipelineRun.id;
  const primaryIssue = result.issues[0];
  const reviewedCount = Object.keys(reviews).length;
  const confirmedCount = Object.values(reviews).filter(
    (verdict) => verdict === "confirmed",
  ).length;
  const dismissedCount = Object.values(reviews).filter(
    (verdict) => verdict === "dismissed",
  ).length;
  const firstTransitionLabel = firstMutation
    ? `${firstMutation.from} → ${firstMutation.to}`
    : "No mutation detected";

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setReplayIndex((current) => {
        if (current >= stages.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1_100);
    return () => window.clearInterval(timer);
  }, [isPlaying, stages.length]);

  useEffect(() => {
    if (!pipelineRunning) return;
    const timer = window.setInterval(() => {
      setPipelineCursor((current) => {
        if (current >= pipelineRun.modules.length - 1) {
          setPipelineRunning(false);
          return pipelineRun.modules.length;
        }
        return current + 1;
      });
    }, 360);
    return () => window.clearInterval(timer);
  }, [pipelineRun.modules.length, pipelineRunning]);

  function loadExample(exampleId: string) {
    const example = examples.find((item) => item.id === exampleId) ?? examples[0];
    const nextStages = cloneStages(example.stages);
    setSelectedExample(example.id);
    setStages(nextStages);
    setGuardrail(example.guardrail);
    const nextPipeline = runReliabilityPipeline(
      nextStages,
      example.guardrail,
    );
    setPipelineRun(nextPipeline);
    setPipelineCursor(nextPipeline.modules.length);
    setPipelineRunning(false);
    setReplayIndex(0);
    setIsPlaying(false);
    setReviews({});
    setImportMessage("");
    setIsFresh(true);
  }

  function updateStage(index: number, field: "label" | "text", value: string) {
    setStages((current) =>
      current.map((stage, stageIndex) =>
        stageIndex === index ? { ...stage, [field]: value } : stage,
      ),
    );
    setIsFresh(false);
    setIsPlaying(false);
    setSelectedExample("");
  }

  function addStage() {
    if (stages.length >= 7) return;
    setStages((current) => [
      ...current,
      {
        id: `agent-${Date.now()}`,
        label: `Agent ${current.length}`,
        text: "",
      },
    ]);
    setIsFresh(false);
    setIsPlaying(false);
    setSelectedExample("");
  }

  function removeStage(index: number) {
    if (index === 0 || stages.length <= 2) return;
    setStages((current) =>
      current.filter((_, stageIndex) => stageIndex !== index),
    );
    setIsFresh(false);
    setIsPlaying(false);
    setSelectedExample("");
  }

  function runAnalysis() {
    const nextPipeline = runReliabilityPipeline(stages, guardrail);
    const nextResult = nextPipeline.analysis;
    setPipelineRun(nextPipeline);
    setPipelineCursor(0);
    setPipelineRunning(true);
    setReplayIndex(
      nextResult.firstMutationIndex === null
        ? 0
        : nextResult.firstMutationIndex + 1,
    );
    setIsPlaying(false);
    setReviews({});
    setIsFresh(true);
  }

  async function importTrace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > TRACE_LIMITS.payloadBytes) {
      setImportMessage("Import failed: JSON file must be smaller than 2 MB.");
      return;
    }
    try {
      const parsed = parseTracePayload(JSON.parse(await file.text()));
      const nextStages = cloneStages(parsed.stages);
      const nextPipeline = runReliabilityPipeline(
        nextStages,
        parsed.guardrail,
      );
      setStages(nextStages);
      setGuardrail(parsed.guardrail);
      setPipelineRun(nextPipeline);
      setPipelineCursor(nextPipeline.modules.length);
      setPipelineRunning(false);
      setReplayIndex(0);
      setIsPlaying(false);
      setReviews({});
      setSelectedExample("");
      setImportMessage(
        `Imported “${parsed.runName}” · ${nextStages.length} stages`,
      );
      setIsFresh(true);
    } catch (error) {
      setImportMessage(
        `Import failed: ${
          error instanceof Error ? error.message : "invalid trace file"
        }`,
      );
    }
  }

  function downloadSampleTrace() {
    downloadJson(
      "lineageguard-trace.sample.json",
      createSampleTracePayload(),
    );
  }

  async function copyReport() {
    const reviewSummary =
      reviewedCount > 0
        ? `\nHuman review: ${confirmedCount} confirmed, ${dismissedCount} dismissed`
        : "\nHuman review: pending";
    await navigator.clipboard.writeText(
      `${buildPlainTextReport(result, stages)}${reviewSummary}`,
    );
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1_600);
  }

  async function copySharePost() {
    const issueNames = [
      ...new Set(
        result.issues.map((issue) => issueLabels[issue.type]),
      ),
    ]
      .join(" + ")
      .toLowerCase();
    const text =
      result.firstMutationIndex === null
        ? `I replayed a ${stages.length}-stage AI chain through LineageGuard. No structured mutation was detected. Everything ran locally. ${reportId} #LineageGuard #AIAgents`
        : `I put a ${stages.length}-stage AI chain through a black-box replay. The first mutation appeared at ${firstTransitionLabel}: ${issueNames}. Blast radius: ${result.contaminatedOutputs} output${result.contaminatedOutputs === 1 ? "" : "s"}. ${reportId} #LineageGuard #AISafety`;
    await navigator.clipboard.writeText(text);
    setShareState("copied");
    window.setTimeout(() => setShareState("idle"), 1_600);
  }

  async function copyRecoveryPacket() {
    const recovery = pipelineRun.recovery;
    const text =
      recovery.status === "not-required"
        ? "LINEAGEGUARD RECOVERY PACKET\nNo rollback is required."
        : [
            "LINEAGEGUARD RECOVERY PACKET",
            `Run: ${pipelineRun.id}`,
            `Last verified: ${recovery.lastVerifiedLabel}`,
            `Restart at: ${recovery.restartStageLabel}`,
            "",
            ...recovery.actions.map(
              (action, index) =>
                `${index + 1}. ${action.title} [${action.owner}]\n   ${
                  action.instruction
                }`,
            ),
          ].join("\n");
    await navigator.clipboard.writeText(text);
    setRecoveryCopyState("copied");
    window.setTimeout(() => setRecoveryCopyState("idle"), 1_600);
  }

  function exportJson() {
    downloadJson("lineageguard-report.json", {
      exportedAt: new Date().toISOString(),
      engine: `LineageGuard reliability pipeline v${PIPELINE_VERSION}`,
      guardrail,
      stages,
      result,
      pipeline: pipelineRun,
      humanReview: reviews,
      reportId,
    });
  }

  return {
    selectedExample,
    stages,
    guardrail,
    pipelineRun,
    result,
    isFresh,
    copyState,
    shareState,
    replayIndex,
    isPlaying,
    reviews,
    pipelineCursor,
    pipelineRunning,
    importMessage,
    recoveryCopyState,
    replaySnapshot,
    replayIssues,
    reportId,
    primaryIssue,
    reviewedCount,
    confirmedCount,
    dismissedCount,
    firstTransitionLabel,
    setGuardrail,
    setIsFresh,
    setSelectedExample,
    setReplayIndex,
    setIsPlaying,
    setReviews,
    loadExample,
    updateStage,
    addStage,
    removeStage,
    runAnalysis,
    importTrace,
    downloadSampleTrace,
    copyReport,
    copySharePost,
    copyRecoveryPacket,
    exportJson,
  };
}
