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
  type AnalysisResult,
  type IssueType,
  type TraceStage,
} from "@/lib/analysis";
import { examples } from "@/lib/examples";
import { runReliabilityPipeline } from "@/lib/pipeline";
import {
  createSampleTracePayload,
  parseTracePayload,
} from "@/lib/trace-schema";

const issueLabels: Record<IssueType, string> = {
  number: "NUMBER DRIFT",
  certainty: "CONFIDENCE",
  quantifier: "SCOPE",
  negation: "NEGATION",
  guardrail: "GUARDRAIL",
};

type ReviewVerdict = "confirmed" | "dismissed";

function cloneStages(stages: TraceStage[]) {
  return stages.map((stage) => ({ ...stage }));
}

function makeReportId(stages: TraceStage[], result: AnalysisResult) {
  const input = `${stages.map((stage) => stage.text).join("|")}|${result.issues
    .map((issue) => issue.type)
    .join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `LG-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export default function LineageGuard() {
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
  const reportId = useMemo(() => makeReportId(stages, result), [stages, result]);
  const primaryIssue = result.issues[0];
  const reviewedCount = Object.keys(reviews).length;
  const confirmedCount = Object.values(reviews).filter(
    (verdict) => verdict === "confirmed",
  ).length;
  const dismissedCount = Object.values(reviews).filter(
    (verdict) => verdict === "dismissed",
  ).length;

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
    }, 1100);
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
    if (file.size > 2_000_000) {
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
    const blob = new Blob(
      [JSON.stringify(createSampleTracePayload(), null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lineageguard-trace.sample.json";
    anchor.click();
    URL.revokeObjectURL(url);
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
    window.setTimeout(() => setCopyState("idle"), 1600);
  }

  async function copySharePost() {
    const issueNames = [...new Set(result.issues.map((issue) => issueLabels[issue.type]))]
      .join(" + ")
      .toLowerCase();
    const text =
      result.firstMutationIndex === null
        ? `I replayed a ${stages.length}-stage AI chain through LineageGuard. No structured mutation was detected. Everything ran locally. ${reportId} #LineageGuard #AIAgents`
        : `I put a ${stages.length}-stage AI chain through a black-box replay. The first mutation appeared at ${firstTransitionLabel}: ${issueNames}. Blast radius: ${result.contaminatedOutputs} output${result.contaminatedOutputs === 1 ? "" : "s"}. ${reportId} #LineageGuard #AISafety`;
    await navigator.clipboard.writeText(text);
    setShareState("copied");
    window.setTimeout(() => setShareState("idle"), 1600);
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
    window.setTimeout(() => setRecoveryCopyState("idle"), 1600);
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      engine: "LineageGuard reliability pipeline v0.2",
      guardrail,
      stages,
      result,
      pipeline: pipelineRun,
      humanReview: reviews,
      reportId,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lineageguard-report.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const firstTransitionLabel = firstMutation
    ? `${firstMutation.from} → ${firstMutation.to}`
    : "No mutation detected";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="LineageGuard home">
          <span className="brand-mark" aria-hidden="true">
            LG
          </span>
          <span>LineageGuard</span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#integrate">Integrate</a>
          <a href="#limits">Limits</a>
          <span className="free-badge">
            <span className="privacy-dot" aria-hidden="true" />
            Local only · $0
          </span>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">
          <span>FORENSICS FOR AGENT HANDOFFS</span>
          <span className="eyebrow-line" />
          <span>HEURISTIC MVP · V0.1</span>
        </div>
        <h1>
          Catch the first
          <br />
          <span>bad handoff.</span>
        </h1>
        <p>
          A model-independent reliability control plane for agent systems.
          Capture every handoff, preserve inherited authority, stop the first
          corrupted transition, and restart from the last verified checkpoint.
        </p>
        <div className="hero-proof">
          <span>No API key</span>
          <span>No text upload</span>
          <span>Runs in your browser</span>
        </div>
        <div className="hero-blackbox" aria-label="Example AI mutation flow">
          <div>
            <span>
              <i aria-hidden="true" />
              LIVE MUTATION TAPE
            </span>
            <small>00:00:03.412</small>
          </div>
          <ol>
            <li>
              <span>SOURCE</span>
              <p>
                “Study <em>suggests</em> a <em>12–18%</em> improvement.”
              </p>
            </li>
            <li className="tape-break">
              <span>AGENT 02</span>
              <p>
                “Study <em>shows</em> an <em>18%</em> improvement.”
              </p>
            </li>
            <li className="tape-contaminated">
              <span>AGENT 03</span>
              <p>
                “Trials <em>proved</em> an <em>18%</em> improvement.”
              </p>
            </li>
          </ol>
          <strong>⚠ MEANING CHANGED AT AGENT 01 → 02</strong>
        </div>
      </section>

      <section className="demo-shell" aria-label="Lineage analysis workspace">
        <div className="example-bar">
          <div>
            <span className="section-kicker">PLANTED EXAMPLES</span>
            <p>Load a trace, then change any sentence.</p>
          </div>
          <div className="example-buttons">
            {examples.map((example) => (
              <button
                className={selectedExample === example.id ? "selected" : ""}
                key={example.id}
                onClick={() => loadExample(example.id)}
                type="button"
              >
                <span>{example.name}</span>
                <small>{example.eyebrow}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="workspace-grid">
          <section className="input-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">01 · TRACE INPUT</span>
                <h2>Build the chain</h2>
              </div>
              <span className="stage-count">{stages.length} stages</span>
            </div>

            <div className="ingestion-strip">
              <div>
                <span>TRACE INGESTION</span>
                <p>Paste manually or load the generic event contract.</p>
              </div>
              <div>
                <label>
                  Import trace JSON
                  <input
                    accept="application/json,.json"
                    onChange={importTrace}
                    type="file"
                  />
                </label>
                <button onClick={downloadSampleTrace} type="button">
                  Sample schema
                </button>
              </div>
              {importMessage && (
                <p
                  className={
                    importMessage.startsWith("Import failed")
                      ? "import-error"
                      : "import-success"
                  }
                  role="status"
                >
                  {importMessage}
                </p>
              )}
            </div>

            <div className="guardrail-field">
              <label htmlFor="guardrail">Protected instruction</label>
              <p>Optional rule that every handoff should preserve.</p>
              <textarea
                id="guardrail"
                onChange={(event) => {
                  setGuardrail(event.target.value);
                  setIsFresh(false);
                  setSelectedExample("");
                }}
                rows={3}
                value={guardrail}
              />
            </div>

            <div className="stage-stack">
              {stages.map((stage, index) => (
                <article className="stage-editor" key={stage.id}>
                  <div className="stage-rail" aria-hidden="true">
                    <span className={index === 0 ? "source-node" : ""}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {index < stages.length - 1 && <i />}
                  </div>
                  <div className="stage-body">
                    <div className="stage-title-row">
                      <label htmlFor={`stage-${stage.id}`}>
                        {index === 0 ? "SOURCE OF TRUTH" : `HANDOFF ${index}`}
                      </label>
                      {index > 0 && stages.length > 2 && (
                        <button
                          className="remove-button"
                          onClick={() => removeStage(index)}
                          type="button"
                          aria-label={`Remove ${stage.label}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      aria-label={`Name for stage ${index + 1}`}
                      className="stage-name"
                      onChange={(event) =>
                        updateStage(index, "label", event.target.value)
                      }
                      value={stage.label}
                    />
                    <textarea
                      id={`stage-${stage.id}`}
                      onChange={(event) =>
                        updateStage(index, "text", event.target.value)
                      }
                      rows={index === 0 ? 4 : 3}
                      value={stage.text}
                    />
                    <span className="character-count">
                      {stage.text.length} characters
                    </span>
                  </div>
                </article>
              ))}
            </div>

            <div className="input-actions">
              <button
                className="secondary-button"
                disabled={stages.length >= 7}
                onClick={addStage}
                type="button"
              >
                + Add handoff
              </button>
              <button className="analyze-button" onClick={runAnalysis} type="button">
                <span>Run reliability pipeline</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>

          <aside className="report-panel" aria-live="polite">
            <div className="panel-heading report-heading">
              <div>
                <span className="section-kicker">02 · FORENSIC REPORT</span>
                <h2>First-break signal</h2>
              </div>
              {!isFresh && <span className="stale-badge">Needs rerun</span>}
            </div>

            <section className="pipeline-console" aria-label="Reliability pipeline">
              <div className="pipeline-console-header">
                <div>
                  <span>RELIABILITY CONTROL PLANE / {pipelineRun.id}</span>
                  <h3>Seven accountable modules. One decision path.</h3>
                </div>
                <span className={pipelineRunning ? "running" : "complete"}>
                  {pipelineRunning ? "EXECUTING" : "COMPLETE"}
                </span>
              </div>
              <div className="pipeline-agreement">
                <strong>
                  {pipelineRun.ruleFamilyAgreement.active}/
                  {pipelineRun.ruleFamilyAgreement.total}
                </strong>
                <div>
                  <span>RULE-FAMILY AGREEMENT</span>
                  <p>{pipelineRun.ruleFamilyAgreement.summary}</p>
                </div>
              </div>
              <div className="pipeline-modules">
                {pipelineRun.modules.map((module, index) => {
                  const isActive = pipelineRunning && index === pipelineCursor;
                  const isQueued = pipelineRunning && index > pipelineCursor;
                  const isFlagged = !isQueued && module.status === "flagged";
                  return (
                    <article
                      className={`${isActive ? "active" : ""} ${
                        isQueued ? "queued" : ""
                      } ${isFlagged ? "flagged" : ""}`}
                      key={module.id}
                    >
                      <div>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <i aria-hidden="true">
                          {isQueued ? "○" : isActive ? "…" : isFlagged ? "!" : "✓"}
                        </i>
                      </div>
                      <strong>{module.name}</strong>
                      <small>{isQueued ? "Waiting for prior module" : module.summary}</small>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className={`verdict-card ${result.overallSeverity}`}>
              <div className="verdict-topline">
                <span className="signal-icon" aria-hidden="true">
                  {result.firstMutationIndex === null ? "✓" : "!"}
                </span>
                <span>
                  {result.firstMutationIndex === null
                    ? "TRACE STABLE"
                    : `${result.overallSeverity.toUpperCase()} RISK`}
                </span>
              </div>
              <h3>{firstTransitionLabel}</h3>
              <p>
                {result.firstMutationIndex === null
                  ? "No structured claim change was found in this chain."
                  : `${result.issues.length} warning${
                      result.issues.length === 1 ? "" : "s"
                    } found. ${result.contaminatedOutputs} output${
                      result.contaminatedOutputs === 1 ? "" : "s"
                    } sit at or after the first break.`}
              </p>
            </div>

            <section className="replay-console" aria-label="AI mutation replay">
              <div className="replay-header">
                <div>
                  <span className="replay-live">
                    <i aria-hidden="true" />
                    AI BLACK BOX
                  </span>
                  <h3>Truth-decay replay</h3>
                </div>
                <button
                  aria-pressed={isPlaying}
                  onClick={() => {
                    if (replayIndex >= stages.length - 1) setReplayIndex(0);
                    setIsPlaying((current) => !current);
                  }}
                  type="button"
                >
                  <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
                  {isPlaying ? "Pause" : "Replay chain"}
                </button>
              </div>

              <div className="replay-rail" role="tablist" aria-label="Replay stage">
                {stages.map((stage, index) => {
                  const isBroken =
                    result.firstMutationIndex !== null &&
                    index === result.firstMutationIndex + 1;
                  const isPastBreak =
                    result.firstMutationIndex !== null &&
                    index > result.firstMutationIndex + 1;
                  return (
                    <button
                      aria-label={`Show ${stage.label}`}
                      aria-selected={replayIndex === index}
                      className={`${replayIndex === index ? "active" : ""} ${
                        isBroken ? "break" : ""
                      } ${isPastBreak ? "after-break" : ""}`}
                      key={`replay-${stage.id}`}
                      onClick={() => {
                        setReplayIndex(index);
                        setIsPlaying(false);
                      }}
                      role="tab"
                      type="button"
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <small>{stage.label || `Stage ${index + 1}`}</small>
                    </button>
                  );
                })}
              </div>

              <div
                className={`replay-frame ${
                  replayIssues.length ? "mutation-frame" : ""
                }`}
                key={`frame-${replayIndex}`}
              >
                <div className="frame-topline">
                  <span>
                    FRAME {String(replayIndex + 1).padStart(2, "0")} /{" "}
                    {String(stages.length).padStart(2, "0")}
                  </span>
                  <span>
                    {replayIndex === 0
                      ? "SOURCE BASELINE"
                      : replayIssues.length
                        ? `${replayIssues.length} MUTATION SIGNAL${
                            replayIssues.length === 1 ? "" : "S"
                          }`
                        : "SIGNALS PRESERVED"}
                  </span>
                </div>
                <blockquote>
                  “{stages[replayIndex]?.text || "No text in this handoff."}”
                </blockquote>
                <div className="signal-rack">
                  <div
                    className={
                      replayIssues.some((issue) => issue.type === "number")
                        ? "changed"
                        : ""
                    }
                  >
                    <span>NUMERIC DNA</span>
                    <strong>
                      {replaySnapshot.numbers.join(" · ") || "No number"}
                    </strong>
                  </div>
                  <div
                    className={
                      replayIssues.some((issue) => issue.type === "certainty")
                        ? "changed"
                        : ""
                    }
                  >
                    <span>CONFIDENCE</span>
                    <strong>{replaySnapshot.certainty || "Neutral"}</strong>
                  </div>
                  <div
                    className={
                      replayIssues.some((issue) => issue.type === "quantifier")
                        ? "changed"
                        : ""
                    }
                  >
                    <span>SCOPE</span>
                    <strong>{replaySnapshot.scope || "Unstated"}</strong>
                  </div>
                  <div
                    className={
                      replayIssues.some(
                        (issue) =>
                          issue.type === "negation" ||
                          issue.type === "guardrail",
                      )
                        ? "changed"
                        : ""
                    }
                  >
                    <span>INTENT LOCK</span>
                    <strong>
                      {replaySnapshot.completedActions.length
                        ? `Action: ${replaySnapshot.completedActions.join(", ")}`
                        : replaySnapshot.negations.length
                          ? replaySnapshot.negations.join(" · ")
                          : "No explicit lock"}
                    </strong>
                  </div>
                </div>
                <div
                  className={`frame-event ${
                    replayIssues.length ? "breach" : ""
                  }`}
                >
                  <span aria-hidden="true">
                    {replayIndex === 0 ? "◆" : replayIssues.length ? "!" : "✓"}
                  </span>
                  <div>
                    <strong>
                      {replayIndex === 0
                        ? "Original claim fingerprint captured"
                        : replayIssues.length
                          ? "Meaning changed at this exact handoff"
                          : "No structured mutation entered here"}
                    </strong>
                    <small>
                      {replayIndex === 0
                        ? "Every later frame is compared with the handoff before it."
                        : replayIssues.length
                          ? replayIssues.map((issue) => issue.title).join(" · ")
                          : `${stages[replayIndex - 1]?.label} → ${
                              stages[replayIndex]?.label
                            } stayed structurally stable.`}
                    </small>
                  </div>
                </div>
              </div>
            </section>

            <div className="lineage-map">
              <div className="report-subheading">
                <span>LINEAGE MAP</span>
                <span>FIRST BREAK MARKED</span>
              </div>
              <div className="timeline">
                {stages.map((stage, index) => {
                  const isFirstBroken =
                    result.firstMutationIndex !== null &&
                    index === result.firstMutationIndex + 1;
                  const isDownstream =
                    result.firstMutationIndex !== null &&
                    index > result.firstMutationIndex + 1;
                  const incoming =
                    index > 0 ? result.transitions[index - 1] : null;
                  return (
                    <div
                      className={`timeline-step ${
                        isFirstBroken ? "first-broken" : ""
                      } ${isDownstream ? "downstream" : ""}`}
                      key={`timeline-${stage.id}`}
                    >
                      <div className="timeline-node">
                        <span>{index + 1}</span>
                      </div>
                      <div className="timeline-copy">
                        <strong>{stage.label || `Stage ${index + 1}`}</strong>
                        <small>
                          {index === 0
                            ? "Baseline"
                            : incoming?.issueCount
                              ? `${incoming.issueCount} change${
                                  incoming.issueCount === 1 ? "" : "s"
                                }`
                              : "Preserved"}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="issues-section">
              <div className="report-subheading">
                <span>EVIDENCE</span>
                <span>{result.issues.length} FLAGS</span>
              </div>
              {result.issues.length ? (
                <div className="issue-list">
                  {result.issues.map((issue) => (
                    <article className="issue-card" key={issue.id}>
                      <div className="issue-meta">
                        <span className={`severity-pill ${issue.severity}`}>
                          {issue.severity}
                        </span>
                        <span>{issueLabels[issue.type]}</span>
                        <span>
                          {issue.fromLabel} → {issue.toLabel}
                        </span>
                      </div>
                      <h3>{issue.title}</h3>
                      <p>{issue.explanation}</p>
                      <div className="evidence-pair">
                        <div>
                          <span>BEFORE</span>
                          <p>{issue.before}</p>
                        </div>
                        <div>
                          <span>AFTER</span>
                          <p>{issue.after}</p>
                        </div>
                      </div>
                      <div className="issue-review">
                        <span>HUMAN VERDICT</span>
                        <div>
                          <button
                            className={
                              reviews[issue.id] === "confirmed" ? "active" : ""
                            }
                            onClick={() =>
                              setReviews((current) => ({
                                ...current,
                                [issue.id]: "confirmed",
                              }))
                            }
                            type="button"
                          >
                            Confirm signal
                          </button>
                          <button
                            className={
                              reviews[issue.id] === "dismissed" ? "active" : ""
                            }
                            onClick={() =>
                              setReviews((current) => ({
                                ...current,
                                [issue.id]: "dismissed",
                              }))
                            }
                            type="button"
                          >
                            False positive
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="clean-state">
                  <span aria-hidden="true">✓</span>
                  <h3>Structured claims stayed stable</h3>
                  <p>
                    Numbers, confidence, scope, negation, and the protected
                    instruction survived every handoff.
                  </p>
                </div>
              )}
            </div>

            <article
              className={`mutation-receipt ${
                result.firstMutationIndex === null ? "receipt-clean" : ""
              }`}
            >
              <div className="receipt-header">
                <div>
                  <span>LINEAGEGUARD / MUTATION RECEIPT</span>
                  <strong>{reportId}</strong>
                </div>
                <span className="receipt-status">
                  {result.firstMutationIndex === null ? "STABLE" : "BREACH"}
                </span>
              </div>
              <div className="receipt-title">
                <span aria-hidden="true">
                  {result.firstMutationIndex === null ? "✓" : "!"}
                </span>
                <div>
                  <small>FORENSIC VERDICT</small>
                  <h3>
                    {result.firstMutationIndex === null
                      ? "No structured mutation entered."
                      : "This AI chain mutated."}
                  </h3>
                </div>
              </div>
              <div className="receipt-facts">
                <div>
                  <span>FIRST BREAK</span>
                  <strong>{firstTransitionLabel}</strong>
                </div>
                <div>
                  <span>BLAST RADIUS</span>
                  <strong>{result.contaminatedOutputs} outputs</strong>
                </div>
                <div>
                  <span>SIGNAL DNA</span>
                  <strong>
                    {result.issues.length
                      ? [...new Set(result.issues.map((issue) => issueLabels[issue.type]))]
                          .join(" / ")
                      : "UNCHANGED"}
                  </strong>
                </div>
                <div>
                  <span>HUMAN REVIEW</span>
                  <strong>
                    {reviewedCount}/{result.issues.length} reviewed
                  </strong>
                </div>
              </div>
              {primaryIssue && (
                <div className="receipt-evidence">
                  <span>{primaryIssue.before}</span>
                  <i aria-hidden="true">→</i>
                  <span>{primaryIssue.after}</span>
                </div>
              )}
              <div className="review-meter">
                <div>
                  <span
                    style={{
                      width: `${
                        result.issues.length
                          ? (reviewedCount / result.issues.length) * 100
                          : 100
                      }%`,
                    }}
                  />
                </div>
                <p>
                  {result.issues.length === 0
                    ? "No warnings require review."
                    : reviewedCount === result.issues.length
                      ? `${confirmedCount} confirmed · ${dismissedCount} dismissed`
                      : "Machine warning pending human judgment"}
                </p>
              </div>
              <div className="receipt-barcode" aria-hidden="true" />
            </article>

            <section
              aria-label="Recovery plan"
              className={`recovery-console ${
                pipelineRun.recovery.status === "not-required"
                  ? "recovery-clean"
                  : ""
              }`}
            >
              <div className="recovery-header">
                <div>
                  <span>RECOVERY ORCHESTRATOR</span>
                  <h3>
                    {pipelineRun.recovery.status === "not-required"
                      ? "No rollback required"
                      : "Smallest safe rollback prepared"}
                  </h3>
                </div>
                <button onClick={copyRecoveryPacket} type="button">
                  {recoveryCopyState === "copied"
                    ? "Packet copied"
                    : "Copy recovery packet"}
                </button>
              </div>
              {pipelineRun.recovery.status === "not-required" ? (
                <p className="recovery-clean-copy">
                  The final handoff remains the latest verified checkpoint.
                </p>
              ) : (
                <>
                  <div className="recovery-checkpoints">
                    <div>
                      <span>LAST VERIFIED</span>
                      <strong>{pipelineRun.recovery.lastVerifiedLabel}</strong>
                    </div>
                    <i aria-hidden="true">→</i>
                    <div>
                      <span>RESTART ONLY HERE</span>
                      <strong>{pipelineRun.recovery.restartStageLabel}</strong>
                    </div>
                  </div>
                  <ol className="recovery-actions">
                    {pipelineRun.recovery.actions.map((action) => (
                      <li key={action.id}>
                        <span
                          aria-hidden="true"
                          className={action.blocking ? "blocking" : "retry"}
                        >
                          {action.blocking ? "BLOCK" : "RETRY"}
                        </span>
                        <div>
                          <strong>{action.title}</strong>
                          <p>{action.instruction}</p>
                          <small>OWNER · {action.owner}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>

            <div className="report-actions">
              <button onClick={copyReport} type="button">
                {copyState === "copied" ? "Copied" : "Copy report"}
              </button>
              <button onClick={copySharePost} type="button">
                {shareState === "copied" ? "Post copied" : "Copy share post"}
              </button>
              <button onClick={exportJson} type="button">
                Export JSON
              </button>
            </div>
          </aside>
        </div>
      </section>

      <section className="integration-section" id="integrate">
        <div className="integration-copy">
          <span className="section-kicker">
            ONE RUNTIME · THREE INTERCEPTION POINTS
          </span>
          <h2>Put the guard inside the agent loop.</h2>
          <p>
            The website is the debugger. The runtime supervisor is the product:
            it checks every proposed handoff, gates tools before execution, and
            freezes the chain at the last verified checkpoint.
          </p>
          <div className="integration-capabilities">
            <article>
              <span>01</span>
              <strong>Handoff gate</strong>
              <p>Stop unsafe output before the next agent receives it.</p>
            </article>
            <article>
              <span>02</span>
              <strong>Pre-tool gate</strong>
              <p>Never invoke a side-effecting tool without permission.</p>
            </article>
            <article>
              <span>03</span>
              <strong>Recovery controller</strong>
              <p>Retry only the failed agent from a verified checkpoint.</p>
            </article>
          </div>
        </div>
        <div className="sdk-console">
          <div>
            <span>sdk / live runtime supervisor</span>
            <span>typescript</span>
          </div>
          <pre>
            <code>{`const guard = new LineageGuardSession({
  guardrail: "Do not contact the customer",
  blockAtOrAbove: "medium"
}).recordSource("Request", sourceText);

const result = await guard.runSequence(
  agents,
  applicationContext
);

if (result.status === "blocked") {
  queueReview(result.report.recovery);
  guard.resetToLastVerified();
}`}</code>
          </pre>
          <div className="sdk-contract">
            <span>RUNTIME CONTRACT</span>
            <strong>SDK + POST /api/evaluate</strong>
            <small>In-process · model-independent · framework-neutral</small>
          </div>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-intro">
          <span className="section-kicker">HOW IT WORKS</span>
          <h2>Replay the second truth bends.</h2>
          <p>
            LineageGuard records the claim fingerprint at every handoff, then
            lets a human replay the exact frame where evidence or authority
            changed.
          </p>
        </div>
        <div className="rule-grid">
          <article>
            <span className="rule-number">01</span>
            <h3>Lock evidence</h3>
            <p>
              Ranges, percentages, money, dates, and quantities are compared
              between each step.
            </p>
            <code>12–18% ≠ 18%</code>
          </article>
          <article>
            <span className="rule-number">02</span>
            <h3>Measure language</h3>
            <p>
              Confidence and scope words are ranked so quiet inflation becomes
              visible.
            </p>
            <code>may → shows → proven</code>
          </article>
          <article>
            <span className="rule-number">03</span>
            <h3>Protect intent</h3>
            <p>
              Negative conditions and explicit restrictions are checked
              against later claims and actions.
            </p>
            <code>draft only ≠ emailed</code>
          </article>
          <article>
            <span className="rule-number">04</span>
            <h3>Close the loop</h3>
            <p>
              A human confirms or dismisses each warning, making false
              positives visible and evaluation exportable.
            </p>
            <code>machine signal → human verdict</code>
          </article>
        </div>
      </section>

      <section className="limits-section" id="limits">
        <div>
          <span className="section-kicker">HONEST LIMITS</span>
          <h2>A smoke detector, not a truth machine.</h2>
        </div>
        <div className="limit-copy">
          <p>
            The free engine catches structured mutations well. It can still
            miss subtle paraphrases, domain-specific meaning, sarcasm, or a
            false claim that never changes across the chain.
          </p>
          <p>
            Use it to decide <em>where a human should look</em>—not to replace
            source verification, safety review, or compliance approval.
          </p>
          <p>
            That is why LineageGuard reports the matching rule instead of
            inventing an “AI accuracy score,” and every warning remains
            reviewable.
          </p>
        </div>
      </section>

      <footer>
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            LG
          </span>
          <span>LineageGuard</span>
        </a>
        <p>Open-source prototype · zero paid APIs · data stays in your browser</p>
      </footer>
    </main>
  );
}
