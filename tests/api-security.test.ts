import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  authorizeEvaluationRequest,
  resetEvaluationRateLimits,
} from "../lib/api-security.ts";

const originalKeys = process.env.LINEAGEGUARD_API_KEYS_JSON;
const originalLimit = process.env.LINEAGEGUARD_RATE_LIMIT_PER_MINUTE;
const originalWorkspaceTrust =
  process.env.LINEAGEGUARD_TRUST_WORKSPACE_IDENTITY;

afterEach(() => {
  if (originalKeys === undefined) {
    delete process.env.LINEAGEGUARD_API_KEYS_JSON;
  } else {
    process.env.LINEAGEGUARD_API_KEYS_JSON = originalKeys;
  }
  if (originalLimit === undefined) {
    delete process.env.LINEAGEGUARD_RATE_LIMIT_PER_MINUTE;
  } else {
    process.env.LINEAGEGUARD_RATE_LIMIT_PER_MINUTE = originalLimit;
  }
  if (originalWorkspaceTrust === undefined) {
    delete process.env.LINEAGEGUARD_TRUST_WORKSPACE_IDENTITY;
  } else {
    process.env.LINEAGEGUARD_TRUST_WORKSPACE_IDENTITY =
      originalWorkspaceTrust;
  }
  resetEvaluationRateLimits();
});

test("fails closed on an unconfigured public endpoint", () => {
  delete process.env.LINEAGEGUARD_API_KEYS_JSON;
  const access = authorizeEvaluationRequest(
    new Request("https://public.example/api/evaluate"),
  );

  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.status, 503);
});

test("accepts configured tenant credentials without storing raw keys", () => {
  process.env.LINEAGEGUARD_API_KEYS_JSON = JSON.stringify({
    "tenant-a": "strong-secret",
  });
  const access = authorizeEvaluationRequest(
    new Request("https://public.example/api/evaluate", {
      headers: {
        authorization: "Bearer strong-secret",
        "x-lineageguard-tenant": "tenant-a",
      },
    }),
  );

  assert.equal(access.ok, true);
  if (access.ok) assert.equal(access.tenantId, "tenant-a");
});

test("accepts workspace identity and limits each tenant independently", () => {
  delete process.env.LINEAGEGUARD_API_KEYS_JSON;
  process.env.LINEAGEGUARD_TRUST_WORKSPACE_IDENTITY = "true";
  process.env.LINEAGEGUARD_RATE_LIMIT_PER_MINUTE = "1";
  const request = new Request("https://private.example/api/evaluate", {
    headers: {
      "oai-authenticated-user-email": "reviewer@example.com",
    },
  });

  assert.equal(authorizeEvaluationRequest(request, 1_000).ok, true);
  const limited = authorizeEvaluationRequest(request, 1_001);
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.status, 429);
});
