# Changelog

All notable changes to LineageGuard are documented here.

## Unreleased

- Detect a hedge, limiting quantifier or `n't` contraction that is silently
  dropped from a restated claim; stop reading contractions, the month May, an
  imperative "never", "the most important" and reporting-verb tense changes as
  drift; canonicalize `between X and Y`, currency words, hyphenated word
  numbers and bare decimals.
- Fingerprint approval tokens after trimming so a host verifier that trims
  cannot let one approval execute a side-effect tool repeatedly, and make
  `restore()` accept only its documented options so a resumed session cannot
  have its threshold, tool policy or analysis mode replaced.
- Bound graph evaluation by parent-link count and compared characters so a
  dense in-limit payload cannot monopolize the API worker; validate duplicate
  stage ids and the recovery index on the public pipeline entry; reject a
  malformed workspace identity header; route every 1.1 payload to the graph
  parser; allow the workspace to build up to 50 stages.
- Publish only tags that are on `main`, verify releases on the CI Node.js,
  run the Node.js 20 floor check before publishing, and publish prerelease
  tags under `next`. Group React packages in Dependabot and stop it from
  bumping the patched `vinext`.

## 0.8.0

- Reject inherited object properties as API tenant credentials and use a fixed
  site origin for public metadata instead of trusting forwarded headers.
- Distinguish special-value fingerprint tags from user objects and sparse arrays
  from null arrays. Reject ambiguous accessors/custom array properties and use
  locale-independent key ordering.
- Copy approved tool inputs, invalidate authorization after session changes,
  enforce serial agent/handoff operations, refuse in-flight snapshots, and detach
  public reports, decisions and snapshot records from internal state.
- Detect numeric signs, full-width digits and exact decimal differences; convert
  decimal powers of ten without rounding and propagate shared range units.
- Include every blocking graph branch in contamination, order ties by IDs, and
  reject invalid graph/OTLP shapes, Unicode IDs, nested duplicate keys and excessive
  JSON nesting or payload sizes before analysis.
- Keep demo results tied to their analyzed snapshot, prevent stale export/copy,
  handle clipboard failures and import races, and use accessible replay buttons.
- Add adversarial regressions and 12 paired numeric evaluation cases, document
  recovery responsibilities, and execute both README quickstarts from the tarball.
- Update fast-uri to patched 3.1.8; retain the two documented image-size exceptions.
- Add a documented audit exception for the unpatched `braces` denial-of-service
  advisory GHSA-vfj7-8cjw-p6xm, reachable only from development tooling.

### Compatibility notes

These fixes change some previously allowed verdicts and malformed-input behavior.
Numeric ranges now expose both endpoint units (for example `12%-18%`). Graph
first-break tie ordering and fingerprints may change. Reports and cached handoff
decisions retain value equality but no longer preserve object identity. Overlapping
agent/handoff calls reject; snapshots require settled operations. Tool input
identity is not preserved. Case-distinct tool names no longer share an idempotency
fingerprint. Custom built-in subclasses (including Node Buffer) must be converted
to supported plain values such as a private, non-shared Uint8Array. Special tag-shaped objects, sparse arrays, and locale-sensitive key
orderings can produce different fingerprints; existing incompatible operation
records fail closed and approvals may need reissuing. Public package export
paths and the snapshot schema version remain unchanged. Because verdicts and
input handling change, these fixes ship as a minor release rather than a patch.
Hosted `/api/evaluate` now returns 503 unless `LINEAGEGUARD_API_KEYS_JSON` or
`LINEAGEGUARD_TRUST_WORKSPACE_IDENTITY=true` is configured.

## 0.7.0

- Failed closed when either side of a handoff is blank instead of silently
  reporting an unverifiable transition as clean.
- Kept numeric claims out of lexical guardrail-retention scoring so an
  equivalent range rewrite cannot be mislabeled as the first bad handoff.
- Displayed the current product release in the website hero instead of the
  older internal pipeline schema version.
- Made the website's SDK example importable and linked visitors directly to
  the npm package and source repository.
- Updated the web and build dependency chain, added a high-severity audit gate,
  and documented the two reviewed, development-only Vinext parser exceptions.
- Added a trusted-publishing release workflow and a packed-SDK smoke test on
  the advertised Node.js 20 minimum.
- Added explicit `deterministic`, `hybrid`, and `semantic` runtime analysis
  modes. Semantic-only mode requires the asynchronous judge and disables the
  built-in lexical findings for handoff decisions.
- Prevented synchronous inspection from silently bypassing the semantic judge
  in hybrid or semantic mode.
- Removed the Korean-specific lexical, guardrail, date, magnitude, unit, test,
  and evaluation rules to keep the built-in deterministic surface English-only.
- Reduced the curated English regression set to 33 cases after removing the
  five Korean-specific cases.

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
