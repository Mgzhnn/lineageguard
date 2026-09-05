# Audit evidence, 2026-09-05

Baseline source: `1882d729e47384713295d750ca8f528ccf6c5745`.
Verified source: `c4202894e00258ae8fa98b5e3a2f825d8e123ece`.
Synthetic fixtures only. No deployment secrets,
approval tokens from a real service, or user trace content were used.

- `baseline-verify.log`: original full gate passed.
- `baseline-audit.log`: original audit failed on four unignored high advisories.
- `regressions-before.log`: 26 failures / 27 tests against original source.
- `production-regressions-before.log`: authentication and forwarded metadata tests
  failed against the original compiled Worker.
- `expanded-evals-before.json`, `expanded-evals-after.json`: identical 45-case set.
- `final-verify.log`, `final-audit.log`: complete final gate output.
- `node20-smoke.log`: packed SDK floor-runtime verification.
- `benchmark-before.jsonl`, `benchmark-after.jsonl`: local single-run smoke timings.
- `SHA256SUMS`: SHA-256 digests of the raw logs and measurements in this directory.

Read [AUDIT.md](../../../AUDIT.md) for implications and validation boundaries and
[IMPLEMENTATION_PROMPT.md](../../../IMPLEMENTATION_PROMPT.md) for the requested fixes.
