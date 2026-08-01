import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      ...init,
      headers: {
        accept: "text/html",
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
  const { StaticFileCache } = await import(cacheModuleUrl.href);
  const clientDir = new URL("../dist/client/", import.meta.url);
  const assetNames = await readdir(new URL("assets/", clientDir));
  const cssName = assetNames.find((name) => name.endsWith(".css"));
  assert.ok(cssName, "expected a built CSS asset in dist/client/assets");

  const cache = await StaticFileCache.create(
    decodeURIComponent(clientDir.pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  );
  const entry = cache.lookup(`/assets/${cssName}`);
  assert.ok(
    entry,
    `static cache must resolve /assets/${cssName} via URL-style lookup`,
  );
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
  assert.equal(payload.version, "0.6.0");
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
