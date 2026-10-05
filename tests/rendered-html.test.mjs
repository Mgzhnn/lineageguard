import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const packageVersion = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;

// Production route fixtures authenticate explicitly; loopback Host is not identity.
process.env.LINEAGEGUARD_API_KEYS_JSON = '{"render-fixture":"synthetic-render-secret"}';

// vinext >= 1.0 imports `cloudflare:workers` from the built Worker for its
// Workers tracing integration. Node cannot resolve that scheme, so reuse the
// resolve hook vinext itself registers before importing the bundle in Node.
const { registerPrerenderCloudflareLoader } = await import(
  new URL(
    "../node_modules/vinext/dist/build/prerender-cloudflare-loader.js",
    import.meta.url,
  ).href
);
registerPrerenderCloudflareLoader();

async function render(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      ...init,
      headers: {
        accept: "text/html",
        authorization: "Bearer synthetic-render-secret",
        "x-lineageguard-tenant": "render-fixture",
        ...init.headers,
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("production static cache resolves hashed assets by URL path", async () => {
  // Regression: on Windows, vinext 0.0.50 keyed the static cache with
  // path.relative() backslashes ("/assets\\x.css"), so every built asset
  // 404ed from `vinext start` and pages rendered unstyled. The committed
  // patch normalizes keys to URL separators; this test fails if that patch
  // is ever lost (e.g. a vinext upgrade without the fix).
  const cacheModuleUrl = new URL(
    "../node_modules/vinext/dist/server/static-file-cache.js",
    import.meta.url,
  );
  // The lookup below cannot fail on POSIX (path.sep is already "/"), so also
  // assert the patched line is present in the installed module source. This
  // is what makes the guard fail on Linux CI when the patch is lost.
  const cacheModuleSource = await readFile(cacheModuleUrl, "utf8");
  assert.ok(
    cacheModuleSource.includes('.split(path.sep).join("/")'),
    `${path.basename(cacheModuleUrl.pathname)} must contain the patched ` +
      '`.split(path.sep).join("/")` cache-key normalization (patches/vinext.patch)',
  );
  const { StaticFileCache } = await import(cacheModuleUrl.href);
  const clientDir = new URL("../dist/client/", import.meta.url);
  const cssDir = "_next/static/css/";
  const assetNames = await readdir(new URL(cssDir, clientDir));
  const cssName = assetNames.find((name) => name.endsWith(".css"));
  assert.ok(cssName, `expected a built CSS asset in dist/client/${cssDir}`);

  const cache = await StaticFileCache.create(
    decodeURIComponent(clientDir.pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  );
  const entry = cache.lookup(`/${cssDir}${cssName}`);
  assert.ok(
    entry,
    `static cache must resolve /${cssDir}${cssName} via URL-style lookup`,
  );
});

test("metadata ignores untrusted forwarded origin headers", async () => {
  const response = await render("/", { headers: {
    "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "https",
  } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /https:\/\/attacker\.invalid/);
  assert.match(html, /https:\/\/lineageguard\.ugrp44group\.chatgpt\.site\/og\.png/);
});

test("production API rejects inherited tenant properties", async () => {
  const response = await render("/api/evaluate", { method: "POST", headers: {
    "content-type": "application/json", authorization: "Bearer [object Object]", "x-lineageguard-tenant": "__proto__",
  }, body: JSON.stringify({ stages: [{ label: "Source", text: "Claim." }, { label: "Child", text: "Claim." }] }) });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("server-renders the LineageGuard workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>LineageGuard/);
  assert.match(html, /Catch the first/);
  assert.match(html, /bad handoff/);
  assert.match(html, /Run reliability pipeline/);
  assert.match(html, /Local only/);
  assert.match(html, /Seven accountable modules/);
  assert.match(html, /Truth-decay replay/);
  assert.match(html, /This AI chain mutated/);
  assert.match(html, /RECOVERY ORCHESTRATOR/);
  assert.match(html, /Put the guard inside the agent loop/);
  assert.match(html, /Pre-tool gate/);
  assert.match(html, /HUMAN VERDICT/);
  assert.match(html, /A smoke detector, not a truth machine/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /\/og\.png/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|sk-proj/i);
});

test("exposes a deployment health contract", async () => {
  const response = await render("/api/health");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.product, "LineageGuard");
  assert.equal(payload.version, packageVersion);
  assert.equal(payload.paidApiRequired, false);
  assert.ok(payload.capabilities.includes("recovery-packet"));
  assert.ok(payload.capabilities.includes("pre-tool-gate"));
});

test("blocks an unsafe handoff through the framework-neutral API", async () => {
  const response = await render("/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runName: "External runtime",
      blockAtOrAbove: "medium",
      stages: [
        {
          id: "source",
          label: "Source",
          text: "Some users may save 5%. The estimate is not confirmed.",
        },
        {
          id: "writer",
          label: "Writer",
          text: "All users will save 10%. The result is proven.",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.decision, "block");
  assert.equal(payload.blockingTransitionIndex, 0);
  assert.equal(payload.recovery.restartStageLabel, "Writer");
});

test("does not create a recovery packet for an allowed warning", async () => {
  const response = await render("/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      blockAtOrAbove: "high",
      stages: [
        {
          id: "source",
          label: "Source",
          text: "Some users may save 5%.",
        },
        {
          id: "writer",
          label: "Writer",
          text: "Most users may save 5%.",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.decision, "allow");
  assert.equal(payload.recovery.status, "not-required");
});

test("rejects invalid API configuration and media types", async () => {
  const invalidThreshold = await render("/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      blockAtOrAbove: "critical",
      stages: [
        { label: "Source", text: "Source text." },
        { label: "Agent", text: "Agent text." },
      ],
    }),
  });
  assert.equal(invalidThreshold.status, 400);

  const wrongMediaType = await render("/api/evaluate", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongMediaType.status, 415);
});

test("enforces the API payload limit in bytes", async () => {
  const response = await render("/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stages: [
        { label: "Source", text: "😀".repeat(510_000) },
        { label: "Agent", text: "Agent text." },
      ],
    }),
  });

  assert.equal(response.status, 413);
});

test("evaluates a branch-and-merge graph through the HTTP contract", async () => {
  const response = await render("/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: "1.1",
      blockAtOrAbove: "medium",
      nodes: [
        {
          id: "source",
          label: "Source",
          text: "Some users may save 5%.",
          parentIds: [],
        },
        {
          id: "policy",
          label: "Policy",
          text: "Human approval is required.",
          parentIds: [],
        },
        {
          id: "merge",
          label: "Merge",
          text: "All users will save 10%. Human approval is required.",
          parentIds: ["source", "policy"],
          inheritedClaims: {
            source: "All users will save 10%.",
            policy: "Human approval is required.",
          },
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.topology, "graph");
  assert.equal(payload.decision, "block");
  assert.equal(payload.blockingEdgeId, "source->merge");
  assert.deepEqual(payload.recovery.contaminatedNodeIds, ["merge"]);
});

test("health advertises the per-isolate limit with no-store and nosniff", async () => {
  const response = await render("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const payload = await response.json();
  assert.ok(payload.capabilities.includes("per-isolate-rate-limit"));
  assert.ok(!payload.capabilities.includes("per-tenant-rate-limit"));
});

test("the workspace live region is the one-line status only", async () => {
  const response = await render();
  const html = await response.text();
  const liveRegions = html.match(/aria-live="[^"]*"/g) ?? [];
  assert.equal(liveRegions.length, 1);
  assert.match(html, /<div class="verdict-topline" aria-live="polite">/);
  assert.doesNotMatch(html, /<aside class="report-panel" aria-live=/);
});

test("the workspace offers a paste-JSON import beside the file picker", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /<label for="paste-trace">Paste trace JSON<\/label>/);
  assert.match(html, /<textarea id="paste-trace"/);
  assert.match(html, /Import pasted JSON/);
  assert.match(html, /Import trace JSON/);
});

test("example buttons expose their selection with aria-pressed", async () => {
  const response = await render();
  const html = await response.text();
  const exampleButtons = html.match(/<button aria-pressed="(true|false)" class="(selected)?"/g) ?? [];
  assert.ok(exampleButtons.length >= 2, "expected example buttons with aria-pressed");
  assert.equal(
    exampleButtons.filter((button) => button.includes('aria-pressed="true"')).length,
    1,
  );
});
