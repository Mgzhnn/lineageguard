import { sha256Hex } from "./fingerprint.ts";

export type EvaluationAccess =
  | {
      ok: true;
      tenantId: string;
      remaining: number;
      limit: number;
      resetAt: number;
    }
  | {
      ok: false;
      status: 401 | 429 | 503;
      error: string;
      retryAfterSeconds?: number;
    };

type RateWindow = {
  startedAt: number;
  count: number;
};

const rateWindows = new Map<string, RateWindow>();
const WINDOW_MILLISECONDS = 60_000;
const DEFAULT_REQUESTS_PER_WINDOW = 60;

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function configuredRateLimit() {
  const parsed = Number.parseInt(
    process.env.LINEAGEGUARD_RATE_LIMIT_PER_MINUTE ?? "",
    10,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REQUESTS_PER_WINDOW;
}

function parseKeyConfiguration():
  | { ok: true; keys: Record<string, string> }
  | { ok: false } {
  const raw = process.env.LINEAGEGUARD_API_KEYS_JSON?.trim();
  if (!raw) return { ok: true, keys: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false };
    }
    const keys = Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          Boolean(entry[0].trim()) &&
          typeof entry[1] === "string" &&
          Boolean(entry[1].trim()),
      ),
    );
    if (Object.keys(keys).length !== Object.keys(parsed).length) {
      return { ok: false };
    }
    return { ok: true, keys };
  } catch {
    return { ok: false };
  }
}

function equalSecret(left: string, right: string) {
  const leftHash = sha256Hex(left);
  const rightHash = sha256Hex(right);
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |=
      leftHash.charCodeAt(index) ^ (rightHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function authenticateTenant(request: Request):
  | { ok: true; tenantId: string }
  | { ok: false; status: 401 | 503; error: string } {
  const workspaceUser = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (
    workspaceUser &&
    process.env.LINEAGEGUARD_TRUST_WORKSPACE_IDENTITY === "true"
  ) {
    return { ok: true, tenantId: `workspace:${workspaceUser}` };
  }

  const configuration = parseKeyConfiguration();
  if (!configuration.ok) {
    return {
      ok: false,
      status: 503,
      error: "Evaluation API authentication is misconfigured.",
    };
  }
  const configuredTenants = Object.keys(configuration.keys);
  if (!configuredTenants.length) {
    if (isLoopbackHostname(new URL(request.url).hostname)) {
      return { ok: true, tenantId: "local-development" };
    }
    return {
      ok: false,
      status: 503,
      error:
        "Evaluation API access is disabled until tenant authentication is configured.",
    };
  }

  const tenantId = request.headers.get("x-lineageguard-tenant")?.trim();
  const bearerToken = readBearerToken(request);
  if (!tenantId || !bearerToken) {
    return {
      ok: false,
      status: 401,
      error: "Tenant id and bearer token are required.",
    };
  }
  const expected = configuration.keys[tenantId];
  if (!expected || !equalSecret(bearerToken, expected)) {
    return {
      ok: false,
      status: 401,
      error: "Tenant credentials are invalid.",
    };
  }
  return { ok: true, tenantId };
}

function applyRateLimit(tenantId: string, now: number): EvaluationAccess {
  const limit = configuredRateLimit();
  const previous = rateWindows.get(tenantId);
  const window =
    !previous || now - previous.startedAt >= WINDOW_MILLISECONDS
      ? { startedAt: now, count: 0 }
      : previous;
  window.count += 1;
  rateWindows.set(tenantId, window);

  if (rateWindows.size > 1_000) {
    for (const [key, candidate] of rateWindows) {
      if (now - candidate.startedAt >= WINDOW_MILLISECONDS) {
        rateWindows.delete(key);
      }
    }
  }

  const resetAt = window.startedAt + WINDOW_MILLISECONDS;
  if (window.count > limit) {
    return {
      ok: false,
      status: 429,
      error: "Evaluation API rate limit exceeded.",
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
    };
  }
  return {
    ok: true,
    tenantId,
    remaining: Math.max(0, limit - window.count),
    limit,
    resetAt,
  };
}

export function authorizeEvaluationRequest(
  request: Request,
  now = Date.now(),
): EvaluationAccess {
  const authentication = authenticateTenant(request);
  if (!authentication.ok) return authentication;
  return applyRateLimit(authentication.tenantId, now);
}

export function resetEvaluationRateLimits() {
  rateWindows.clear();
}
