# LineageGuard audit, 2026-09-05

## Evidence and scope

Baseline: server `sail-gpu`, `/home/magzhan/projects/lineageguard`, branch `main`,
commit `1882d72`. The existing README has encoding damage **and** a real wording
edit from “model-independent” to “model-optional”. It must not be reset wholesale.
The SDK manifest is version 0.7.0 and has no runtime dependencies; publication
status was not inferred from that manifest. Production configuration and live
traffic were not inspected. Tests use synthetic local fixtures, never real tokens.

The review covers the API, schema adapters, graph and chain engines, runtime,
package/build/release scripts, existing tests/evals, and frontend state handling.
This is a source and executable regression audit, not a penetration test of the
public service or a claim of exhaustive language understanding. The old audit
prompt is retained as context, not treated as verified fact.

The shareable raw evidence is committed under
[`docs/audit-evidence/2026-09-05/`](./docs/audit-evidence/2026-09-05/README.md).
Additional installation/retry logs and the original README backup are retained
in the local review `../evidence/` directory and
`/home/magzhan/projects/lineageguard-review-2026-09-05/evidence/` on the server.
`baseline-install.log`: locked installation passed on Node 22.23.2 / pnpm 11.9.0.
`baseline-verify.log`: full verification exited 0. Curated eval: 33 cases, precision,
recall, specificity, and expected issue coverage all 1.0, no failures.
`baseline-audit.log`: security audit exited 1, six high advisories including two
existing ignored image-size advisories and four unignored fast-uri advisories.
`regressions-before.log`: 27 added tests, 26 failed and one control passed.

## Findings before implementation

Line references below refer to baseline `1882d72`. Each acceptance requirement
appears in `IMPLEMENTATION_PROMPT.md`. All findings below have been addressed; see the final status table and validation limits.

| ID | Severity | Evidence / concrete failure | Required change |
| --- | --- | --- | --- |
| AUD-01 | High | `lib/api-security.ts:133`: with any tenant configured, `__proto__` + bearer `[object Object]` authenticates through inherited property lookup. Regression 1 fails. | Own string-valued credentials only; bounded parsing. |
| AUD-02 | High | `lib/fingerprint.ts:114`: undefined, NaN, Date, bytes, bigint serialize identically to attacker-shaped records; sparse `[hole]` equals `[null]`. Regressions 2–7 fail. Fingerprints scope approvals/idempotency. | Collision-safe encoding, validated arrays, deterministic key ordering. |
| AUD-03 | High | `sdk/runtime.ts:1072,1308`: mutate `{amount:5}` to 5000 during verifier wait; implementation sees 5000 despite fingerprinting 5. Regression 8 fails. | Detached validated input and approval metadata. |
| AUD-04 | High | `sdk/runtime.ts:1258,1358`: pending approval or even a same-tick read-only authorization executes after a numeric handoff freezes the run. Regressions 9–10 fail. | Revision and freeze checks at invocation. |
| AUD-05 | High | `sdk/runtime.ts:859,1594`: two async inspections share a transition index and both commit. Regression 11 fails; judge findings are indexed before await. | Enforce documented serial session semantics. |
| AUD-06 | High | `sdk/runtime.ts:1422`: snapshot while verifier is pending omits the pending token reservation; restoring can approve it independently. Regression 12 fails. | Snapshot only at a settled boundary. |
| AUD-07 | High | `sdk/runtime.ts:1544`: modifying returned recovery index changes the session's actual recovery; reset then throws. Regression 13 fails. Other report/decision aliases share this risk. | Defensive copies across result/snapshot boundaries. |
| AUD-08 | High | `lib/analysis.ts:408,441,486`: -5% to 5%, Unicode minus, full-width digit changes, and changes beyond 12 significant digits pass; equivalent metric ranges disagree. Regressions 14–18 fail. | Signed exact decimal/range normalization and paired evals. |
| AUD-09 | High | `lib/graph.ts:375`: root→a and root→b both mutate; only a is contaminated, b and its child are marked verified. Regression 20 fails. | Union of descendants of all blocking edges. |
| AUD-10 | Medium | `lib/graph.ts:259`: reverse the same node array and first-break/fingerprint change. Regression 21 fails. No chronological order exists between independent branches. | Deterministic ID tie-break for nodes/parents. |
| AUD-11 | Medium | `lib/graph.ts:134,330`, `lib/trace-schema.ts:201`: disconnected roots accepted without edges; `__proto__` parent with empty projection map crashes; lone-surrogate ID survives import and later URI encoding throws. Regressions 22–24 fail. | Early consistent shape, size, Unicode and own-property validation. |
| AUD-12 | Medium | `sdk/otel.ts:149,422`: cyclic AnyValue overflows the stack; parser returns self-parented graph; duplicate nested content keys silently overwrite. Regressions 25–27 fail. | Bounded traversal and graph validation at parser return. |
| AUD-13 | High advisory | `pnpm-workspace.yaml:14` pins fast-uri 3.1.5; security audit exits 1. Runtime exploitation in this app is not established. | Patch override and lockfile to 3.1.6. |
| AUD-14 | Medium | `app/lineageguard/useLineageGuardWorkspace.ts:251,303`: result is cached but copy/export reads edited `stages` and `guardrail`; remove a stage after analysis and text-report indexing can throw. All copy/export buttons remain active. | Snapshot-consistent report display/export and stale guards; import race handling. |
| AUD-15 | Low | `app/LineageGuard.tsx:370–392`: `role=tablist/tab` lacks panel relationships, roving focus, or arrow-key behavior. Native buttons still work via Tab/Enter. | Use button group or implement complete tab interaction. |
| AUD-16 | Medium | `ARCHITECTURE.md` recovery item 6 says human approval is required before downstream execution, but `resetToLastVerified()` clears frozen state without authentication; `sdk/README.md` quickstart references undefined host functions. | Clarify host recovery responsibility and provide an executable introductory example. |
| AUD-17 | Medium | `app/layout.tsx:6`: the compiled baseline reflects untrusted `x-forwarded-host` into social metadata. The added production test fails on attacker.invalid. | Use the canonical configured site origin. |

AUD-14 has a pure-function regression for stale export integrity. AUD-15 is
verified by source/production rendering, and AUD-16 by documentation review plus
executed tarball quickstarts. Browser interaction testing remains unperformed;
none of the production rendering tests is presented as a browser interaction test.
No critical severity is asserted: impact is scoped to each demonstrated boundary.

## Findings rejected or deliberately not inferred

- Percent vs percentage points already differs (regression 19 passes).
- The original 33 eval cases pass and `eval:check` uses explicit expected outcomes,
  not comparison against its own predictions. The problem is missing cases.
- The SDK graph builder calls the shared graph engine; it is not a second graph
  implementation. A duplication-driven rewrite is unsupported.
- API responses already use no-store/nosniff and stream-limit input to 2 MB.
  Workspace identity is only trusted when explicitly enabled. Dispatcher stripping
  and global quotas remain deployment responsibilities, not verified properties.
- The graph contract caps nodes at 50. A benchmark on thousands of graph nodes
  would measure rejected inputs, not supported large-graph performance.
- The Vinext patch normalizes Windows path separators in the static cache. The
  installed version still needs this patch; existing static-cache testing is run
  on Linux here, not a Windows reproduction.
- Arbitrary paraphrases, Latin-script non-English prose, and claim-to-entity
  reassignment remain limitations of a lexical set-based detector. Do not present
  speculative regex additions as established improvements.

## Advisory sources

The [fast-uri maintainer advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-5jgf-p345-68v8)
identifies 3.1.6 as patched. The registry audit also identifies GHSA-f65p-4m7j-42xc,
GHSA-fph4-wmhf-6fwf and GHSA-jqff-g426-hqxp. These are dependency findings; no
claim is made that the demo exposes all affected URI operations.

The existing [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and
[JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) image-size exceptions
still list no patched version when checked in this session. The repository has
no image upload flow. Installed Vinext imports image-size in its build plugin and metadata-route build
data, both reading repository files. No image-size import string was found in the
built Worker entrypoint. That supports the existing build-tool exception, but is
not a proof against every possible bundler configuration. The vulnerable packages
remain disclosed and no additional advisories were suppressed.

## Breaking changes and compatibility

The public export map and package/snapshot versions remain unchanged. Corrected
analysis results and stricter malformed-input rejection are observable changes.
Ranges now expose both endpoint units (`12%-18%`), and canonical graph ordering
may change the first blocking edge and report fingerprint. Independent blocking
branches all contaminate their descendants.

Reports and cached decisions are detached copies. Callers must await serial
agent/handoff operations and finish pending tools/approvals before snapshotting.
Tool inputs are cloned before approval. Custom built-in subclasses (including
Node Buffer) must be converted to supported plain values such as a private, non-shared Uint8Array.
Tag-shaped objects, sparse arrays, locale-sensitive key ordering and case-distinct
tool names may yield different fingerprints; incompatible persisted operations
fail closed. Reissue affected approvals rather than rewriting stored hashes.
Loopback anonymous API access now requires development mode.

Three existing test expectations changed for documented behavior: range tokens
include both units; the graph's ID tie-break chooses `policy->writer` (the test
also asserts `research->writer` remains high severity); cached semantic decisions
are deeply equal but not the same object. No tests or evaluation cases were deleted
or disabled. `CHANGELOG.md` records these changes under Unreleased.

## Final implementation status

| Finding | Status | Verification |
| --- | --- | --- |
| AUD-01 | FIXED | Own-property authentication tests, production HTTP 401 regression, development-only loopback control. |
| AUD-02 | FIXED | Special-value/tag and sparse-array regressions; accessor and built-in property/subclass rejection. |
| AUD-03 | FIXED | Mutating the caller's input cannot change the value the tool executes. |
| AUD-04 | FIXED | Same-tick freeze and an actually pending verifier across freeze/recovery execute zero callbacks. |
| AUD-05 | FIXED | Overlapping handoffs/agents reject before a second callback; normal sequential and semantic tests pass. |
| AUD-06 | FIXED | In-flight snapshots reject; settled restore/resume and one-time-token tests pass. |
| AUD-07 | FIXED | Mutated returned report/decision/snapshot cannot alter live recovery or cached verdict. |
| AUD-08 | FIXED | Numeric adversarial tests and paired equivalence/mutation evals pass. |
| AUD-09 | FIXED | Both independent broken branches and their descendants are contaminated. |
| AUD-10 | FIXED | Node and parent permutations preserve fingerprint and primary blocking edge. |
| AUD-11 | FIXED | Edgeless, bad-type, malformed-Unicode, ambiguous-container, and prototype-parent regressions pass. |
| AUD-12 | FIXED | Circular, ambiguous AnyValue, duplicate-key and invalid-topology tests return validation errors. |
| AUD-13 | FIXED (patchable advisories) | Security gate exits 0 after fast-uri 3.1.6; two pre-existing image-size exceptions remain. |
| AUD-14 | FIXED | Export guard tests pass; snapshot-based display, stale button disabling, import versioning and clipboard errors inspected. Browser interaction remains unverified. |
| AUD-15 | FIXED | Replay uses native toggle buttons in a named group, with selected state and first-break text; no incomplete tab role remains. Browser/screen-reader interaction remains unverified. |
| AUD-16 | FIXED | Recovery and coverage claims corrected; both README JS quickstarts executed against the tarball. |
| AUD-17 | FIXED | Compiled page ignores hostile forwarded origin headers in the production render test. |

These changes are delivered together on `codex/lineageguard-audit-2026-09-05`.
The verified source revision is
[`c4202894e00258ae8fa98b5e3a2f825d8e123ece`](https://github.com/Mgzhnn/lineageguard/commit/c4202894e00258ae8fa98b5e3a2f825d8e123ece).
The subsequent evidence commit contains this report and the raw logs, with a
SHA-256 manifest for the evidence files. There is no npm release or website deployment.

## Final verification results

The final `pnpm verify` exited **0** on sail-gpu / Node **22.23.2** / pnpm **11.9.0**.
The complete output is [final-verify.log](./docs/audit-evidence/2026-09-05/final-verify.log).
It includes lint, TypeScript checks, the production Worker build, examples and:

- Engine: **120 passed, 0 failed** (82 original tests plus 38 new regressions).
- Compiled package: **2 passed, 0 failed**.
- Production render / HTTP: **10 passed, 0 failed**.
- Packed tarball / isolated consumer / actual README quickstarts: **1 passed, 0 failed**.
- Curated evaluation: **45 cases**, no expected-outcome or expected-signal failures.
- `pnpm audit:security`: **exit 0**, **2 high (2 ignored)**, exactly the previously
  documented image-size exceptions; see [final-audit.log](./docs/audit-evidence/2026-09-05/final-audit.log).
- Packed SDK imported all six public entrypoints on **Node 20.20.0**, then exercised
  a blocked signed-number mutation and a detached byte-array tool input;
  see [node20-smoke.log](./docs/audit-evidence/2026-09-05/node20-smoke.log).
- `git diff --check` passed for source and documentation. Raw tool logs retain
  the tools' trailing whitespace. Hosting configuration and package versions are unchanged.

The expanded set was also run against baseline `1882d72`, so the comparison uses
identical cases rather than comparing two different datasets:

| Metric at medium blocking threshold | Baseline on 45 cases | Patched on 45 cases |
| --- | --- | --- |
| Precision | 0.9048 | 1.0000 |
| Recall | 0.8636 | 1.0000 |
| Specificity | 0.9130 | 1.0000 |
| Expected signal coverage | 0.8800 | 1.0000 |

See [before](./docs/audit-evidence/2026-09-05/expanded-evals-before.json) and
[after](./docs/audit-evidence/2026-09-05/expanded-evals-after.json). This deliberately
curated set proves these regressions improved; it does not estimate real-world
accuracy. No external benchmark, scientific novelty or competitive superiority
is claimed.

## Performance and justified follow-ups

`scripts/benchmark-audit.ts` exercises a supported 50-stage repeated-date chain,
a 50-node / 49-edge wide graph, and prompt rejection of 1,000 nodes. Single-run
local Node 22.23.2 measurements were 216.83 ms / 142.24 ms before and 169.30 ms /
135.32 ms after for chain / graph. These are smoke measurements with startup noise,
not a performance guarantee or statistically established speedup. A measured
large-scale redesign is deferred; the current graph contract caps nodes at 50.

The useful additions in this patch are the adversarial fixtures, exact decimal
handling, complete branch contamination, protected local runtime transitions,
and executable quickstarts. A wholesale module split, new model/provider,
distributed quota service or additional dashboard does not follow from the
reproductions and was not added.

Remaining boundaries are explicit:

- Source truth and caller-supplied claim projections are trusted inputs. A supplied
  projection is not semantically proven to match a substring of the merge output.
- Lexical matching can miss paraphrases, polarity changes that retain negation,
  entity/value reassignment and languages outside the lexicons. Coverage is a
  script heuristic, not a language detector. More rules need independently labeled
  positive and negative cases before being promoted as improvements.
- Hosts own tool interception, authentic human approval, durable storage and
  distributed locking. A tool already invoked cannot be undone by a later freeze.
- Public deployed configuration, external framework/model integrations, Windows,
  browser interactions, mobile layout and screen-reader behavior were not tested
  in this session. No model/API credentials were needed or used.
- Two image-size high advisories remain accepted build-tool exceptions. Keep
  monitoring their fixed versions; this audit does not call the dependency tree
  vulnerability-free.

Before releasing or deploying, manually exercise file import/edit/rerun/export,
clipboard permission denial and replay keyboard use. Validate the deployment's
identity-header stripping and global quota policy, and use the host's real
reviewer service to exercise approval, recovery and durable restart.

## Two-minute outcome

Seventeen evidence-backed findings were addressed: ten high (including the
patchable dependency-advisory group), six medium and one low. The original suite
passed while targeted tests reproduced missed security/correctness cases. The
patched source passes the complete verification gate, the expanded curated evals,
and the Node 20 package smoke test. Documentation now distinguishes local SDK
execution, host-owned approval responsibilities, unreleased source changes and
remaining limitations. The user authorized a GitHub branch push after verification;
no public site deployment or npm release is included. This is a tested repair set,
not a claim that the product is bug-free or an independent third-party security audit.
