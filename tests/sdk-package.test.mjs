import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const packageRoot = new URL("../sdk/", import.meta.url);

test("builds an importable dependency-free SDK package", async () => {
  const sdk = await import(new URL("dist/sdk/index.js", packageRoot));
  const run = new sdk.LineageGuardRun()
    .recordSource("Source", "Some users may save 5%.")
    .recordHandoff("writer", "Writer", "All users will save 5%.")
    .finalize();

  assert.equal(run.analysis.firstMutationIndex, 0);
  assert.match(run.fingerprint, /^SHA256-/);
});

test("package export targets exist after compilation", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", packageRoot), "utf8"),
  );
  const sdk = await import(new URL("dist/sdk/index.js", packageRoot));
  assert.equal(packageJson.version, sdk.PRODUCT_VERSION);
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", packageRoot), "utf8"),
  );
  assert.equal(rootPackage.version, sdk.PRODUCT_VERSION);
  const targets = Object.values(packageJson.exports).flatMap((entry) =>
    Object.values(entry),
  );

  await Promise.all(
    targets.map((target) => access(new URL(target.replace("./", ""), packageRoot))),
  );
});
