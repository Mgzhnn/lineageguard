# Contributing

## Development setup

Use Node.js 22.13 or newer and the pnpm version pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

The repository intentionally disables implicit peer installation and
allowlists native build scripts. If a dependency change introduces a missing
peer or a new install script, review and declare it explicitly.

## Changes

- Add focused tests for every bug fix.
- Add anonymized cases to `evals/cases.ts` when a detector behavior changes.
- Keep the detector deterministic and explainable.
- Preserve fail-closed behavior at tool, approval, snapshot, API, and OTLP
  boundaries.
- Do not claim production accuracy from the curated regression set.
- Keep the public SDK free of runtime dependencies unless a reviewed design
  requires otherwise.

Run `pnpm run verify` before opening a pull request. CI also proves that the real npm
tarball installs and that all package export paths resolve.
