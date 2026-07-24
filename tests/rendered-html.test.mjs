import assert from "node:assert/strict";
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
  assert.equal(payload.version, "0.3.0");
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
