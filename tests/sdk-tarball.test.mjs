import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sdkRoot = path.join(repositoryRoot, "sdk");

function runPnpm(args, cwd) {
  const pnpmEntrypoint = process.env.npm_execpath;
  const command = pnpmEntrypoint ? process.execPath : "pnpm";
  const commandArgs = pnpmEntrypoint
    ? [pnpmEntrypoint, ...args]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  return result;
}

test("packs and installs the real SDK tarball in an isolated consumer", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "lineageguard-package-"),
  );
  const artifacts = path.join(temporaryRoot, "artifacts");
  const consumer = path.join(temporaryRoot, "consumer");
  const store = path.join(temporaryRoot, "pnpm-store");

  try {
    await writeFile(
      path.join(temporaryRoot, "placeholder"),
      "temporary release verification",
    );
    await Promise.all([
      mkdir(artifacts, { recursive: true }),
      mkdir(consumer, { recursive: true }),
    ]);

    runPnpm(["pack", "--pack-destination", artifacts], sdkRoot);
    const tarballs = (await readdir(artifacts)).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.equal(tarballs.length, 1, "Expected exactly one SDK tarball.");
    const tarball = path.join(artifacts, tarballs[0]);

    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify(
        {
          name: "lineageguard-consumer-smoke",
          private: true,
          type: "module",
          dependencies: {
            lineageguard: `file:${tarball.replaceAll("\\", "/")}`,
          },
        },
        null,
        2,
      ),
    );
    runPnpm(
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--store-dir",
        store,
      ],
      consumer,
    );

    const smokeTest = `
      import assert from "node:assert/strict";
      import {
        LineageGuardRun,
        PRODUCT_VERSION,
      } from "lineageguard";
      import { LineageGuardSession } from "lineageguard/runtime";
      import { LineageGuardGraphRun } from "lineageguard/graph";
      import { parseOtlpTracePayload } from "lineageguard/otel";
      import { analyzeLineage } from "lineageguard/analysis";
      import { runReliabilityPipeline } from "lineageguard/pipeline";

      assert.equal(PRODUCT_VERSION, "0.6.0");
      assert.equal(typeof LineageGuardRun, "function");
      assert.equal(typeof LineageGuardSession, "function");
      assert.equal(typeof LineageGuardGraphRun, "function");
      assert.equal(typeof parseOtlpTracePayload, "function");
      assert.equal(typeof analyzeLineage, "function");
      assert.equal(typeof runReliabilityPipeline, "function");
    `;
    const smokePath = path.join(consumer, "smoke.mjs");
    await writeFile(smokePath, smokeTest);
    const smoke = spawnSync(process.execPath, [smokePath], {
      cwd: consumer,
      encoding: "utf8",
    });
    assert.equal(
      smoke.status,
      0,
      [smoke.stdout, smoke.stderr].filter(Boolean).join("\n"),
    );

    await access(
      path.join(
        consumer,
        "node_modules",
        "lineageguard",
        "dist",
        "sdk",
        "index.js",
      ),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
