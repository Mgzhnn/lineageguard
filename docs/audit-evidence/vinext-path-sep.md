# vinext: normalize static-file cache keys to URL separators

`vinext-path-sep.patch` is the upstream-ready diff for COMPLETION.md item 2.3,
taken verbatim from `patches/vinext.patch` (a plain `git diff` against the
unpatched `vinext@1.0.1` npm package, produced by `pnpm patch`).

Description for the upstream PR (three lines):

1. `walkFilesWithStats` in `dist/server/static-file-cache.js` (line 246 in
   1.0.1) keys the static cache with `path.relative()`, which uses `\` on Windows.
2. Lookups are by URL path (`/assets/x.css`), so on Windows every built asset
   404s from `vinext start` and pages render unstyled.
3. Fix: `.split(path.sep).join("/")` on the relative path so cache keys are
   always URL-style; a no-op on POSIX.

To open the PR, apply the same one-line change to the TypeScript source of
`walkFilesWithStats` (`src/server/static-file-cache.ts` in the vinext repo),
since the diff here targets the compiled `dist/` file shipped on npm.
