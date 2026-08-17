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
pnpm run audit:security
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

## 4. Configure trusted publishing once

On npmjs.com, configure the `lineageguard` package's trusted publisher with:

- provider: GitHub Actions;
- repository: `Mgzhnn/lineageguard`;
- workflow filename: `publish.yml`;
- environment: `npm`;
- allowed action: `npm publish`.

Create the matching GitHub `npm` environment and require maintainer approval.
Protect release tags so only reviewed commits can trigger a release. The
workflow uses short-lived OIDC credentials and does not require an npm token.

## 5. Publish intentionally

Verify that the Git worktree is clean and that the release commit and tag are
on the default branch. Push the matching version tag:

```bash
git tag v0.7.0
git push origin v0.7.0
```

The `publish.yml` workflow verifies the tag, package versions, security audit,
application, SDK tarball, and examples before invoking `npm publish`. npm
trusted publishing automatically records provenance for a public package from
a public repository. Do not publish 0.7.0 until the 0.7.0 release commit is on
the default branch; a registry version can never be reused.

## 6. Deploy the optional site

The SDK works without the website. Site deployment is a separate release
using the existing `.openai/hosting.json` project. Configure hosted
authentication values through the deployment platform, never in committed
environment files.
