# Completion plan (closed list)

This is the fixed definition of done for LineageGuard. When every box below is
checked, the project is complete: the three entry surfaces (SDK, `/api/evaluate`,
the workspace) accept the same inputs, enforcement cannot be bypassed, a single
caller cannot exhaust the service, releases cannot ship unreviewed, and the
documentation matches the code. Nothing gets added to this list. Work that is
not on it is out of scope (see the last section), and the list was frozen on
2026-10-05 from the four-reviewer audit recorded in `CHANGELOG.md` under
"Unreleased".

Each item has an acceptance check. An item is done only when its check passes
and `pnpm verify` is green.

## 0. Land what is already fixed

- [ ] **0.1** Merge `fix/audit-2026-10-05` into `main` through a pull request
      with CI green.
      *Check:* `git log --oneline origin/main -1` shows the merge commit.

## 1. Release safety (GitHub settings, not code)

- [ ] **1.1** Add a required reviewer to the GitHub `npm` environment and
      restrict its deployment branches/tags to `v*.*.*`.
      *Check:* the next `v*` workflow run shows a "Waiting for review" state
      before the publish job starts.
- [ ] **1.2** Protect `main`: require the CI check and one approving review
      before merge, no force-pushes.
      *Check:* a direct push to `main` is rejected.

## 2. Dependencies (the two blockers behind every failed Dependabot PR)

- [ ] **2.1** Bump `vinext` to 1.0.1 by hand, regenerate `patches/vinext.patch`
      with `pnpm patch vinext@1.0.1`, key the patch as `vinext@1.0.1`.
      *Check:* `pnpm install --frozen-lockfile` succeeds; `pnpm verify` is green.
- [ ] **2.2** Make the patch-guard test fail when the patch is lost on Linux:
      in `tests/rendered-html.test.mjs`, assert the module source contains
      `.split(path.sep).join("/")`.
      *Check:* temporarily removing the patch makes the test fail on Linux.
- [ ] **2.3** Open an upstream vinext PR with the one-line fix so the patch can
      eventually be deleted. The upstream merge is not required for completion;
      opening the PR is.
      *Check:* link to the upstream PR recorded in `CHANGELOG.md`.
- [ ] **2.4** Bump `react`, `react-dom`, `@types/react`, `@types/react-dom`
      together to 19.3.
      *Check:* `pnpm verify` is green.

## 3. SDK runtime (`sdk/runtime.ts`)

- [ ] **3.1** Semantic judge timeout: add `semanticJudgeTimeoutMs` (default
      30 000), race the judge against it, pass an `AbortSignal` in
      `SemanticJudgeContext`, and treat a timeout as a judge failure under
      `semanticJudgeFailureMode`.
      *Check:* a never-resolving judge produces a blocked (or warned) decision
      within the timeout, and `toSnapshot()` works afterwards.
- [ ] **3.2** Enforce `TRACE_LIMITS` inside the session: `makeStage` and
      `commitHandoff` reject ids, labels, stage text, total text and stage count
      beyond the limits with a blocked decision (not a crash).
      *Check:* a 51st handoff and a 500 001-character output are both blocked;
      every snapshot the session produces round-trips through
      `parseTracePayload`.
- [ ] **3.3** Export `TracePayloadError`, `TRACE_LIMITS`,
      `PersistedToolExecution` and `PersistedHandoffRequest` from
      `sdk/index.ts`.
      *Check:* `tests/sdk-package.test.mjs` asserts the four names exist on the
      built package.
- [ ] **3.4** Event-sink ordering: compute the decision, emit, then commit, so a
      sink that throws under `eventSinkFailureMode: "throw"` cannot leave the
      session frozen while the caller sees only the sink error. Give the sync
      `inspectHandoff` the same `handoffInProgress` guard as the async path.
      *Check:* with a throwing sink, `runSequence` returns `{status:"blocked"}`
      and `isFrozen()` matches the decision; re-entering `resetToLastVerified`
      from `onEvent` throws "in progress".
- [ ] **3.5** Idempotency on failure: delete the execution record when the tool
      implementation throws, so a retry under the same key re-invokes the tool.
      Document the behaviour in `sdk/README.md`.
      *Check:* a tool that throws once and then succeeds runs twice under one
      key and returns the second result.
- [ ] **3.6** OTLP text extraction (`sdk/otel.ts`): skip parts whose `type` is
      not `text`/`output_text`, and keep a JSON-shaped string as raw text
      unless it parses to a message/parts shape.
      *Check:* a span whose only output is a `tool_call` part produces no
      lineage node text from the call arguments; an assistant message
      `{"approved": true, "name": "Bob"}` keeps `name` in the node text.
- [ ] **3.7** Split `sdk/runtime.ts` into `sdk/runtime/types.ts`,
      `sdk/runtime/snapshot.ts`, `sdk/runtime/tool-gate.ts` and
      `sdk/runtime/session.ts`, re-exported from `sdk/index.ts` with no public
      API change.
      *Check:* `tests/runtime.test.ts` and `tests/sdk-package.test.mjs` pass
      unchanged; no file in `sdk/` exceeds 700 lines.
- [ ] **3.8** Tests for the documented but untested entry points:
      `registerTool`, `getToolClient`, `authorizeToolAsync`,
      `LineageGuardRun.setGuardrail`, `LineageGuardGraphRun.fromPayload`,
      `buildPlainTextReport`, and the `includeBuiltInRules`, `onEventError`,
      `eventSinkFailureMode` option branches.
      *Check:* each name appears in at least one `test(` body in `tests/`.

## 4. Detection engine (`lib/analysis.ts`)

- [ ] **4.1** Authority rule precision: a completed-action verb only counts as
      a violation when the clause has an agentive subject (`I`, `we`, `the
      agent`, the stage label) or its object overlaps the guardrail's important
      words. "The customer sent us a complaint" and "the draft was shared with
      the reviewer for approval" are clean; "I sent the email" stays high.
      *Check:* those three cases are in `tests/analysis.test.ts` and
      `evals/cases.ts`.
- [ ] **4.2** Coverage for Latin-script non-English text: lower
      `MIN_LETTERS_FOR_COVERAGE_CHECK` to 8 and add an English function-word
      ratio test, so German or Spanish stages produce a low-severity coverage
      issue instead of "clean".
      *Check:* `"Das Ergebnis ist nicht bestätigt worden."` as a stage yields a
      `coverage` issue; every existing English eval case stays unchanged.
- [ ] **4.3** Independent eval signal: add 20 cases that are not unit-test
      fixtures, at least 10 of them with three or more stages and multi-sentence
      text, and let `evals/run.ts` honour a `knownFailure: true` tag so the
      0.9 minimums become the binding gate rather than "any single miss fails".
      *Check:* `pnpm eval:check` prints at least 74 cases and the README eval
      table matches its output.

## 5. API (`app/api`, `lib/api-security.ts`)

- [ ] **5.1** State the rate limit honestly: rename the health capability to
      `per-isolate-rate-limit`, and say in README "Connect another language"
      that the limit is a per-worker safety valve, not a quota.
      *Check:* `GET /api/health` no longer advertises `per-tenant-rate-limit`.
- [ ] **5.2** Send `cache-control: no-store` and `x-content-type-options:
      nosniff` on `/api/health` using the same helper as `/api/evaluate`.
      *Check:* `tests/api-security.test.ts` or `tests/rendered-html.test.mjs`
      asserts both headers.

## 6. Workspace (`app/`)

- [ ] **6.1** Paste-JSON import: a textarea plus "Import pasted JSON" button
      that reuses the same parsing branch as the file picker, including the
      2 MB check.
      *Check:* pasting the README quickstart payload loads it as stages.
- [ ] **6.2** Schema 1.1 payloads: the import path detects `schemaVersion:
      "1.1"` and shows "Graph traces are evaluated by the API and SDK; the
      workspace renders chains" instead of a schemaVersion error. (Rendering
      graphs in the workspace is out of scope.)
      *Check:* importing a 1.1 payload shows that message.
- [ ] **6.3** Accessibility and state hygiene: move `aria-live` to a one-line
      status element; add `aria-pressed` to example buttons; disable the
      Confirm/False-positive buttons when the report is stale; derive
      `isFresh` from the current stages instead of a flag; map JSON
      `SyntaxError` to "File is not valid JSON."; remove the unused
      `setGuardrail`, `setIsFresh`, `setSelectedExample` from the hook's return.
      *Check:* `tests/rendered-html.test.mjs` asserts the live region is the
      status line only, and `pnpm lint` reports no unused exports.

## 7. Release plumbing and documentation

- [ ] **7.1** `scripts/verify-release-tag.mjs` requires a `## <version>`
      heading in `CHANGELOG.md`.
      *Check:* running it with a version absent from the changelog exits 1.
- [ ] **7.2** `tests/sdk-tarball.test.mjs` reads the version from
      `sdk/package.json` instead of the literal `"0.8.0"`.
      *Check:* bumping the version does not require editing the test.
- [ ] **7.3** Documentation sync: `CHANGELOG.md` says `fast-uri` 3.1.8;
      README says `pnpm verify` is the core of the gate and names the extra CI
      steps (`audit:security`, Node 20 smoke, `verify-release-tag`);
      `ARCHITECTURE.md` boundaries section states that the lexicons are
      English and other Latin-script languages only produce a coverage issue.
      *Check:* `grep -n "3.1.6" CHANGELOG.md` is empty; the three statements
      are present.

## 8. Ship

- [ ] **8.1** Move the "Unreleased" changelog section to `## 0.9.0`, bump
      `package.json`, `sdk/package.json` and `lib/version.ts` together, tag
      `v0.9.0`, and let the reviewed workflow publish.
      *Check:* `npm view lineageguard version` prints `0.9.0` with provenance,
      and the workflow run shows the environment approval.
- [ ] **8.2** Deploy the site through Codex and confirm the hero badge and
      `/api/health` report 0.9.0.
      *Check:* `curl -s https://lineageguard.ugrp44group.chatgpt.site/api/health`
      contains `"0.9.0"`.

## Explicitly out of scope

These are deliberate non-goals. They do not block completion and will not be
added to this list:

- Rendering graph (1.1) traces in the workspace; the API and SDK own graphs.
- A distributed quota (Durable Object or KV) for the API; the per-isolate
  limit plus workspace identity is the accepted design for this deployment.
- Lexicons for languages other than English; non-English text is flagged as
  uncovered, never silently passed.
- Framework adapters (LangGraph, OpenAI Agents, Vercel AI SDK); the
  `inspectHandoffAsync` + `GuardedToolClient` primitives and
  `docs/framework-integrations.md` are the integration surface.
- Issuing or managing API keys for third parties.
- A statistical confidence score; agreement stays rule-family counting.
- Any detector change not covered by 4.1 to 4.3; new false positives found
  later are filed as issues against the next version, not added here.
