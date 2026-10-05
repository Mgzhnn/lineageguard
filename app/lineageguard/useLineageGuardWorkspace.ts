"use client";

import {
  useEffect,
  useMemo,
  useRef,
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
import { requireCurrentReport } from "./report-state";

export const issueLabels: Record<IssueType, string> = {
  number: "NUMBER DRIFT",
  certainty: "CONFIDENCE",
  quantifier: "SCOPE",
  negation: "NEGATION",
  guardrail: "GUARDRAIL",
  coverage: "COVERAGE",
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
  const analyzedStages = pipelineRun.graph.nodes;
  const importRevision = useRef(0);
  const [actionMessage, setActionMessage] = useState("");
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
      from: analyzedStages[result.firstMutationIndex]?.label ?? "Previous step",
      to: analyzedStages[result.firstMutationIndex + 1]?.label ?? "Next step",
    };
  }, [result.firstMutationIndex, analyzedStages]);
  const signalSnapshots = useMemo(
    () => analyzedStages.map((stage) => getTraceSignalSnapshot(stage.text)),
    [analyzedStages],
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
        if (current >= analyzedStages.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1_100);
    return () => window.clearInterval(timer);
  }, [isPlaying, analyzedStages.length]);

  useEffect(() => () => { importRevision.current += 1; }, []);

  function markEdited() {
    importRevision.current += 1;
    setIsFresh(false);
    setIsPlaying(false);
    setPipelineRunning(false);
    setSelectedExample("");
    setReviews({});
    setActionMessage("");
  }

  function updateGuardrail(value: string) {
    markEdited();
    setGuardrail(value);
  }

  function reportIsCurrent() {
    try {
      requireCurrentReport(pipelineRun, stages, guardrail);
      setActionMessage("");
      return true;
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Run the pipeline again.");
      return false;
    }
  }

  async function writeClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      setActionMessage("Clipboard access failed. Allow clipboard access or export the JSON report.");
      return false;
    }
  }

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
    importRevision.current += 1;
    setActionMessage("");
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
    markEdited();
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
    if (stages.length >= TRACE_LIMITS.stages) return;
    markEdited();
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
    markEdited();
    setStages((current) =>
      current.filter((_, stageIndex) => stageIndex !== index),
    );
    setIsFresh(false);
    setIsPlaying(false);
    setSelectedExample("");
  }

  function runAnalysis() {
    importRevision.current += 1;
    setActionMessage("");
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
    const revision = ++importRevision.current;
    if (file.size > TRACE_LIMITS.payloadBytes) {
      setImportMessage("Import failed: JSON file must be smaller than 2 MB.");
      return;
    }
    try {
      const text = await file.text();
      if (revision !== importRevision.current) return;
      const parsed = parseTracePayload(JSON.parse(text));
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
      if (revision !== importRevision.current) return;
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
    if (!reportIsCurrent()) return;
    const reviewSummary =
      reviewedCount > 0
        ? `\nHuman review: ${confirmedCount} confirmed, ${dismissedCount} dismissed`
        : "\nHuman review: pending";
    if (!await writeClipboard(
      `${buildPlainTextReport(result, stages)}${reviewSummary}`,
    )) return;
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1_600);
  }

  async function copySharePost() {
    if (!reportIsCurrent()) return;
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
    if (!await writeClipboard(text)) return;
    setShareState("copied");
    window.setTimeout(() => setShareState("idle"), 1_600);
  }

  async function copyRecoveryPacket() {
    if (!reportIsCurrent()) return;
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
    if (!await writeClipboard(text)) return;
    setRecoveryCopyState("copied");
    window.setTimeout(() => setRecoveryCopyState("idle"), 1_600);
  }

  function exportJson() {
    if (!reportIsCurrent()) return;
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
    analyzedStages,
    actionMessage,
    updateGuardrail,
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
