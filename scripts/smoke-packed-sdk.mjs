// Installs an already-packed SDK tarball into a throwaway consumer and imports
// every published entrypoint. This runs on the SDK's advertised Node.js floor,
// where pnpm is unavailable (pnpm 11 requires Node.js 22.13 and imports
// node:sqlite), so packing happens earlier on the build Node.js and this script
// deliberately uses only npm and the standard library.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const packDirectory = process.argv[2];
assert.ok(
  packDirectory,
  "Usage: node scripts/smoke-packed-sdk.mjs <pack-directory>",
);

const sdkPackage = JSON.parse(await readFile("sdk/package.json", "utf8"));
const expectedVersion = sdkPackage.version;

const tarballs = (await readdir(packDirectory)).filter((name) =>
  name.endsWith(".tgz"),
);
assert.equal(tarballs.length, 1, "Expected exactly one SDK tarball.");
const tarball = path.resolve(packDirectory, tarballs[0]);

const consumer = await mkdtemp(
  path.join(os.tmpdir(), "lineageguard-node-floor-"),
);
try {
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify(
      { name: "lineageguard-floor-smoke", private: true, type: "module" },
      null,
      2,
    ),
  );

  const install = spawnSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball],
    {
      cwd: consumer,
      encoding: "utf8",
      // Windows resolves npm through npm.cmd, which Node refuses to spawn
      // without a shell. CI runs on Linux and takes the direct path.
      shell: process.platform === "win32",
    },
  );
  assert.equal(
    install.status,
    0,
    [install.stdout, install.stderr].filter(Boolean).join("\n"),
  );

  const smokePath = path.join(consumer, "smoke.mjs");
  await writeFile(
    smokePath,
    `
      import assert from "node:assert/strict";
      import { LineageGuardRun, PRODUCT_VERSION } from "lineageguard";
      import { LineageGuardSession } from "lineageguard/runtime";
      import { LineageGuardGraphRun } from "lineageguard/graph";
      import { parseOtlpTracePayload } from "lineageguard/otel";
      import { analyzeLineage } from "lineageguard/analysis";
      import { runReliabilityPipeline } from "lineageguard/pipeline";

      assert.equal(PRODUCT_VERSION, ${JSON.stringify(expectedVersion)});
      assert.equal(typeof LineageGuardRun, "function");
      assert.equal(typeof LineageGuardSession, "function");
      assert.equal(typeof LineageGuardGraphRun, "function");
      assert.equal(typeof parseOtlpTracePayload, "function");
      assert.equal(typeof analyzeLineage, "function");
      assert.equal(typeof runReliabilityPipeline, "function");
    `,
  );
  const smoke = spawnSync(process.execPath, [smokePath], {
    cwd: consumer,
    encoding: "utf8",
  });
  assert.equal(
    smoke.status,
    0,
    [smoke.stdout, smoke.stderr].filter(Boolean).join("\n"),
  );

  console.log(
    `Packed SDK ${expectedVersion} imports cleanly on Node.js ${process.versions.node}.`,
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
