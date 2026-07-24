# Releasing LineageGuard

This checklist is for repository maintainers. Consumers only need
`pnpm add lineageguard`.

## 1. Prepare the version

Keep these versions identical:

- root `package.json`;
- `sdk/package.json`;
- `PRODUCT_VERSION` in `lib/version.ts`.

Update `CHANGELOG.md`, then refresh dependency metadata with the repository's
pinned pnpm:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
```

Do not enable automatic peer installation or remove the native-build
allowlist to make an install pass. Declare missing peers directly and review
every new package that requests a build script.

## 2. Run the release gate

```bash
pnpm run verify
```

This includes the production site build, runtime and API tests, curated
evaluation threshold, compiled-package checks, executable examples, and a
fresh install of the generated tarball in an isolated consumer.

The `prepublishOnly` lifecycle runs the same gate. The `prepack` lifecycle
always rebuilds JavaScript and declarations, so a clean clone cannot produce
an empty package.

## 3. Review the package

```bash
pnpm --dir sdk pack --pack-destination ../artifacts
```

Confirm the tarball contains `dist/sdk`, `dist/lib`, declaration files,
source maps, `README.md`, `LICENSE`, and `package.json`. It must not contain
the website, tests, environment files, or repository tooling.

## 4. Publish intentionally

Verify that the Git worktree is clean and that the release commit and tag are
on GitHub. From an npm-authenticated maintainer environment:

```bash
pnpm --dir sdk publish --access public --provenance
```

Publishing requires maintainer credentials or an npm trusted-publishing
configuration. Those external permissions cannot be encoded safely in this
repository.

## 5. Deploy the optional site

The SDK works without the website. Site deployment is a separate release
using the existing `.openai/hosting.json` project. Configure hosted
authentication values through the deployment platform, never in committed
environment files.
