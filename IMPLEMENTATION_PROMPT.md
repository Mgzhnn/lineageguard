# LineageGuard: evidence-backed implementation prompt

Prepared 2026-09-05 against commit `1882d72` on `sail-gpu`, at
`/home/magzhan/projects/lineageguard`. Read `AUDIT.md` for evidence and updated
implementation status. This file is an execution specification, not a claim
that every task below has already been completed.

## Objective and boundaries

Repair reproduced violations of authentication, approval scope, serial runtime
execution, deterministic detection, graph contamination, import validation, and
report integrity. Preserve the dependency-free SDK, public export paths, existing
features, and `.openai/hosting.json`. Work on `codex/lineageguard-audit-2026-09-05`.
Do not discard the server README's real “model-optional” edit. Repair its encoding
with that wording retained and keep the original in the evidence directory.
The user subsequently authorized pushing to `Mgzhnn/lineageguard` after all
verification and explicitly requested README updates. Push the verified audit
branch. Do not publish npm versions or deploy the public site as part of that push.

The previous audit prompt is background material. Its environment and assertions
are not evidence. In this session Node 22.23.2 was already installed; pnpm 11.9.0
was available through Corepack. No new Node installation was needed to start
the review; Node 20 was later installed to verify the SDK's supported runtime floor.

## Implementation order and acceptance criteria

1. **AUD-01, high: API authentication.** Only an own, string-valued tenant entry
   may authenticate. With one configured tenant, `__proto__` and bearer
   `[object Object]` must return 401. Cover other prototype names, real credentials,
   invalid JSON, empty keys, untrusted workspace headers, and bounded configuration.
   Keep fixed-work digest comparison; do not claim JavaScript is formally constant-time.
2. **AUD-02, high: input fingerprints.** Disambiguate supported special values
   from ordinary records that look like serialization tags, and sparse arrays from
   null arrays. Use locale-independent key ordering. Reject unsupported accessors
   and exotic array properties without invoking them. Preserve ordinary JSON
   fingerprint compatibility where possible and document any changed hashes.
3. **AUD-03, high: approval input integrity.** Capture a validated defensive copy
   before an asynchronous verifier runs. The implementation must receive exactly
   the approved value even when the caller changes the original object. Copy
   approval metadata too. Do not serialize away types or silently ignore fields.
4. **AUD-04, high: stale authorization.** Track session revisions and recheck
   runnable state immediately before tool invocation, including read-only calls.
   A freeze, recovery, or handoff while a verifier is pending invalidates that
   authorization. Tests must count actual callback invocations, not just events.
5. **AUD-05, high: serial handoffs.** Reject overlapping agent/handoff operations
   clearly before a second callback/judge runs. Keep the lock across the whole
   asynchronous proposal/inspection/commit interval and release it on failure.
   Tools invoked by the active agent must continue to work. Prevent semantic
   findings from being associated with another transition.
6. **AUD-06, high: snapshot safety.** Refuse snapshots while approvals, tools, or
   agent/handoff operations are pending so a restored instance cannot lose an
   in-flight one-time reservation. Continue supporting settled snapshots and
   persisted execution records. Explain the host's remaining distributed-lock duty.
7. **AUD-07, high: mutable runtime results.** Return defensive copies of reports,
   decisions, recovery packets, and snapshot decisions. Copy restored records.
   Editing a returned object must not alter recovery, cached decisions, or state.
8. **AUD-08, high: numeric detection.** Detect ASCII/Unicode sign changes,
   full-width digit mutations, and precision changes beyond 12 significant digits.
   Canonicalize decimal powers of ten without floating-point rounding. Propagate
   shared range units so `500–1000mg` equals `0.5–1g`. Keep percent distinct from
   percentage points. Add positive and negative regression/eval pairs. Do not
   infer ambiguous decimal-comma locales or claim general multilingual semantics.
9. **AUD-09, high: DAG contamination.** Include descendants of every blocking
   edge, not only the first one. No independently broken branch may be “verified”.
   Preserve one deterministic primary retry target and document that other
   independent breaks also require repair before the graph is clear.
10. **AUD-10, medium: graph determinism.** Canonically order ready nodes and
    incoming edges by IDs without locale dependence. The same node/parent set in
    another array order must yield the same fingerprint and first blocking edge.
    Update order-specific expectations only where the new documented behavior
    requires it; retain every behavioral assertion.
11. **AUD-11, medium: chain/graph validation.** Reject edgeless graphs, malformed
    Unicode IDs, oversized arrays before walking them, ambiguous trace containers,
    duplicate normalized projection keys, and invalid raw graph fields cleanly.
    Prototype-like parent IDs must not read inherited object properties as claims.
    Include guardrails in total graph text limits. Keep legitimate literal
    `__proto__` IDs possible with own-property lookup.
12. **AUD-12, medium: OTLP validation.** Bound input traversal, nesting, and text
    size; reject cyclic AnyValue structures and duplicate nested keys. Validate
    the final graph within `parseOtlpTracePayload`, not only the run helper. Reject
    ambiguous AnyValue alternatives. Do not silently truncate deep evidence.
13. **AUD-13, high dependency advisory / unproven runtime exploitability:**
    update the `fast-uri` override from 3.1.5 to patched 3.1.6 and regenerate the
    lockfile with pinned pnpm. Preserve package policies. Rerun security audit.
    Inspect the two existing image-size exceptions; do not hide new advisories.
14. **AUD-14, medium: stale demo reports.** After edits/removal, results must refer
    to the analyzed snapshot, not current draft labels/text. Copy/export/recovery
    actions must reject stale state or export an explicitly coherent analyzed
    snapshot. Handle clipboard denial visibly. Prevent an older async import
    from overwriting a newer edit/import. Keep review decisions tied to the report.
15. **AUD-15, low: replay accessibility.** Either implement tab semantics with
    arrow/Home/End navigation and panel associations or use honest button-group
    semantics. Keep a keyboard-operable selected state and textual first-break
    indication, without a visual redesign.
16. **AUD-16, medium: documentation contract.** Clarify that recovery packet
    approval instructions require host enforcement: `resetToLastVerified()` itself
    is an explicit host action and does not authenticate a human. State actual
    import limits, lexical coverage limits, and that rule agreement is not measured
    production accuracy. Supply a self-contained SDK quickstart and execute it
    from the packed package. Do not promise thousands of supported graph nodes
    while the graph contract caps them at 50.
17. **AUD-17, medium: metadata origin integrity.** The compiled baseline renders
    attacker-supplied `x-forwarded-host` into social metadata. Use the canonical
    configured public site origin and verify the compiled page ignores hostile
    forwarded origin headers. Preserve the existing social image.

## Verification and reporting

The session baseline is `pnpm verify` exit 0, 33 curated cases with all expected
outcomes, and `pnpm audit:security` exit 1 (four unignored high advisories).
`tests/audit-regressions.test.ts` initially produced 26 failures / 27 tests;
the passing percent/percentage-point case is a control, not a discovered defect.

Keep regressions in `test:engine`. Run focused tests after related changes,
then typecheck and the complete `pnpm verify` plus `pnpm audit:security`.
Retain exact before/after logs under the review evidence directory. Verify the
tarball on Node 20 as well as the build runtime. Validate the production Worker
route, response codes, and security headers. Explain any unrun browser or remote
deployment checks. No public production probing is needed to reproduce these bugs.

Write compatibility notes in `CHANGELOG.md` and `AUDIT.md`. Report actual failures,
fixed cases, unsupported assumptions, and remaining work separately. A passing
curated evaluation set is a regression result, not a production accuracy estimate.
Do not assert research novelty, superiority to competing tools, or “bug-free”.

## Evidence-supported additions and follow-ups

The useful additions are adversarial fixtures, exact decimal canonicalization,
complete branch contamination, atomic local execution boundaries, and a runnable
quickstart. Their benefits follow from reproduced failures. A broad refactor,
new model integration, global quota service, and a new feature dashboard do not
follow from these results and are outside this patch. More multilingual/semantic
detection needs independently labeled data and paired false-positive evaluation
before rules can be called improvements.
