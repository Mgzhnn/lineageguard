# Changelog

All notable changes to LineageGuard are documented here.

## 0.6.0

- Added `inspectHandoffAsync()` so existing framework loops can apply the
  optional semantic judge before the deterministic handoff gate.
- Added asynchronous approval verification for production services backed by
  databases, policy engines, or remote identity systems.
- Reserved one-time approval tokens while asynchronous verification is in
  progress, preventing concurrent executions from racing the same token.
- Added regression coverage for async semantic inspection, async approval
  execution, token reservation, and idempotent semantic review.

## 0.5.1

- Published the local-first forensic workspace as a free interactive demo.
- Added concise OpenAI Agents SDK and LangGraph integration examples.
- Kept the hosted evaluation endpoint fail-closed unless a deployer explicitly
  configures trusted workspace identity or tenant API keys.

## 0.5.0

- Added equivalence-aware canonicalization so formatting rewrites of the same
  value ($5k vs $5,000, 500mg vs 0.5g, 2026-07-24 vs July 24 2026, 5만원 vs
  ₩50,000) no longer freeze a run, while true value changes behind those
  rewrites are still detected.
- Added written-out number detection next to measurable nouns ("three
  customers" vs "five customers").
- Added Korean lexicons for the certainty, quantifier, negation, completed
  action, and guardrail signals, including Korean magnitude and unit
  canonicalization and Korean date parsing.
- Added a low-severity coverage signal: a trace written mostly in a script the
  meaning and authority families cannot read is never reported as clean.
- Added the optional asynchronous `semanticJudge` session hook with fail-closed
  defaults, snapshot persistence, a reserved replay rule id, and an executable
  `demo:semantic` example for catching paraphrase drift with an LLM reviewer.
- Extended the curated regression set to 38 cases (`curated-regression-v2`)
  covering equivalence negatives, Korean positives, and word-number cases.

## 0.4.0

- Added fail-closed runtime supervision, scoped one-time approvals, registered
  tools, idempotency, durable snapshots, and targeted recovery.
- Added chain and branch/merge DAG analysis with per-parent claim projection.
- Added tenant-authenticated HTTP evaluation and per-isolate rate limiting.
- Added canonical SHA-256 fingerprints and inspectable custom rules.
- Added dependency-free OTLP/JSON GenAI trace ingestion.
- Added a reproducible curated evaluation gate and false-positive regressions.
- Added the publishable dependency-free `lineageguard` package with verified
  tarball installation.
- Added frozen-lockfile CI, strict peer checks, explicit native-build policy,
  security guidance, and release documentation.
