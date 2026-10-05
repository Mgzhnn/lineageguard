import { fingerprintValue, sha256Hex } from "../../lib/fingerprint.ts";
import { cleanOptionalText, cleanText } from "./snapshot.ts";
import {
  LineageGuardBlockedError,
  LineageGuardDuplicateExecutionError,
  type GuardedToolClient,
  type PersistedToolExecution,
  type RegisteredTool,
  type RegisteredToolExecutionOptions,
  type ToolApprovalContext,
  type ToolApprovalVerifier,
  type ToolDecision,
  type ToolIntent,
  type ToolPolicy,
} from "./types.ts";

/**
 * What the tool boundary needs from the owning session: identity, policy,
 * the verifier, and the run state that invalidates pending authorizations.
 */
export type ToolGateHost = {
  readonly sessionId: string;
  readonly toolPolicy: ToolPolicy;
  readonly approvalVerifier?: ToolApprovalVerifier;
  hasSource(): boolean;
  isFrozen(): boolean;
  revision(): number;
  currentRunId(): string;
  emit(type: "tool-allowed" | "tool-blocked", message: string): void;
};

type ToolExecutionRecord = PersistedToolExecution & {
  promise?: Promise<unknown>;
  result?: unknown;
  hasResult?: boolean;
};

// The one-time ledger must agree with the host verifier about which token
// strings are "the same" approval. Verifiers routinely trim what reviewers
// paste, so the ledger fingerprints the trimmed token; everything else is
// byte-exact. Hosts that canonicalize further must do so before calling.
function approvalTokenFingerprint(token: string) {
  return sha256Hex(token.trim());
}

function matchesTool(toolName: string, patterns: string[] = []) {
  const normalized = toolName.trim().toLowerCase();
  return patterns.some((pattern) => {
    const candidate = pattern.trim().toLowerCase();
    if (candidate === "*") return true;
    if (candidate.endsWith("*")) {
      return normalized.startsWith(candidate.slice(0, -1));
    }
    return normalized === candidate;
  });
}

/**
 * The registered-tool boundary of a session: tool registry, policy
 * authorization, one-time approval ledger, and idempotent execution.
 */
export class ToolGate {
  private readonly host: ToolGateHost;
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly consumedApprovalTokenFingerprints = new Set<string>();
  private readonly pendingApprovalTokenFingerprints = new Set<string>();
  private readonly toolExecutions = new Map<string, ToolExecutionRecord>();
  private activeToolExecutions = 0;

  constructor(host: ToolGateHost) {
    this.host = host;
  }

  /** True while a tool runs or an approval is being verified. */
  isBusy() {
    return (
      this.activeToolExecutions > 0 ||
      this.pendingApprovalTokenFingerprints.size > 0
    );
  }

  persistedState() {
    return {
      consumedApprovalTokenFingerprints: [
        ...this.consumedApprovalTokenFingerprints,
      ],
      toolExecutions: [...this.toolExecutions.values()].map(
        ({
          idempotencyKey,
          operationFingerprint,
          status,
        }): PersistedToolExecution => ({
          idempotencyKey,
          operationFingerprint,
          status,
        }),
      ),
    };
  }

  restorePersistedState(
    consumedApprovalTokenFingerprints: readonly string[],
    toolExecutions: readonly PersistedToolExecution[],
  ) {
    consumedApprovalTokenFingerprints.forEach((fingerprint) =>
      this.consumedApprovalTokenFingerprints.add(fingerprint),
    );
    toolExecutions.forEach((record) =>
      this.toolExecutions.set(record.idempotencyKey, { ...record }),
    );
  }

  registerTool<TInput, TResult>(tool: RegisteredTool<TInput, TResult>) {
    if (
      !tool ||
      typeof tool !== "object" ||
      typeof tool.execute !== "function" ||
      typeof tool.sideEffect !== "boolean"
    ) {
      throw new Error(
        "A registered tool needs an execute function and explicit sideEffect boolean.",
      );
    }
    const name = cleanText(tool.name, "Registered tool name");
    const action = cleanText(tool.action, "Registered tool action");
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, { ...tool, name, action } as RegisteredTool);
  }

  getToolClient(): GuardedToolClient {
    return Object.freeze({
      execute: <TInput, TResult>(
        toolName: string,
        input: TInput,
        options?: RegisteredToolExecutionOptions,
      ) =>
        this.executeRegisteredTool<TInput, TResult>(
          toolName,
          input,
          options,
        ),
    });
  }

  async executeRegisteredTool<TInput, TResult>(
    toolName: string,
    input: TInput,
    options: RegisteredToolExecutionOptions = {},
  ): Promise<TResult> {
    const name = cleanText(toolName, "Registered tool name");
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered with this session.`);
    }
    return this.executeTool(
      {
        toolName: tool.name,
        action: tool.action,
        input,
        sideEffect: tool.sideEffect,
        approval: options.approval,
        idempotencyKey: options.idempotencyKey,
      },
      tool.execute as (toolInput: TInput) => TResult | Promise<TResult>,
    );
  }

  authorizeTool<TInput>(intent: ToolIntent<TInput>): ToolDecision<TInput> {
    const prepared = this.prepareToolAuthorization(intent);
    if (prepared.decision) return prepared.decision;

    let approvalVerified = false;
    if (prepared.requiresApproval) {
      try {
        const verification = this.host.approvalVerifier!(
          this.approvalContext(
            prepared.intent,
            prepared.inputFingerprint,
          ),
        );
        if (
          typeof verification === "object" &&
          verification !== null &&
          "then" in verification
        ) {
          void Promise.resolve(verification).catch(() => undefined);
          return this.toolDecision(
            "approval-required",
            "The approval verifier is asynchronous. Use authorizeToolAsync() or executeTool() so it can be awaited safely.",
            prepared.intent,
            prepared.inputFingerprint,
            true,
          );
        }
        approvalVerified = verification === true;
      } catch {
        return this.toolDecision(
          "blocked",
          "The approval verifier failed closed.",
          prepared.intent,
          prepared.inputFingerprint,
          true,
        );
      }
      if (!approvalVerified) {
        return this.toolDecision(
          "approval-required",
          "The supplied approval is invalid or does not match this action.",
          prepared.intent,
          prepared.inputFingerprint,
          true,
        );
      }
    }

    return this.allowedToolDecision(prepared, approvalVerified);
  }

  /**
   * Asynchronous authorization preflight. Unlike executeTool(), this does not
   * consume a one-time approval token; execution verifies it again and
   * consumes it atomically before invoking the tool implementation.
   */
  authorizeToolAsync<TInput>(
    intent: ToolIntent<TInput>,
  ): Promise<ToolDecision<TInput>> {
    return this.authorizeToolWithAsyncVerifier(intent, false);
  }

  private prepareToolAuthorization<TInput>(intent: ToolIntent<TInput>): {
    decision?: ToolDecision<TInput>;
    intent: ToolIntent<TInput>;
    inputFingerprint: string;
    requiresApproval: boolean;
  } {
    if (typeof intent.sideEffect !== "boolean") {
      throw new Error("Tool intent requires an explicit sideEffect boolean.");
    }
    const toolPolicy = this.host.toolPolicy;
    const toolName = cleanText(intent.toolName, "Tool name");
    const action = cleanText(intent.action, "Tool action");
    const inputFingerprint = fingerprintValue(intent.input);
    const normalizedIntent: ToolIntent<TInput> = {
      ...intent,
      toolName,
      action,
      idempotencyKey: cleanOptionalText(
        intent.idempotencyKey,
        "Tool idempotency key",
      ),
      sideEffect:
        intent.sideEffect ||
        matchesTool(toolName, toolPolicy.sideEffectTools),
    };

    if (!this.host.hasSource()) {
      return {
        decision: this.toolDecision(
          "blocked",
          "Record an authoritative source before using tools.",
          normalizedIntent,
          inputFingerprint,
        ),
        intent: normalizedIntent,
        inputFingerprint,
        requiresApproval: false,
      };
    }
    if (this.host.isFrozen()) {
      return {
        decision: this.toolDecision(
          "blocked",
          "The run is frozen after a failed handoff. Recover before using tools.",
          normalizedIntent,
          inputFingerprint,
        ),
        intent: normalizedIntent,
        inputFingerprint,
        requiresApproval: false,
      };
    }
    if (matchesTool(toolName, toolPolicy.deniedTools)) {
      return {
        decision: this.toolDecision(
          "blocked",
          `${toolName} is explicitly denied by the runtime tool policy.`,
          normalizedIntent,
          inputFingerprint,
        ),
        intent: normalizedIntent,
        inputFingerprint,
        requiresApproval: false,
      };
    }

    const explicitlyAllowed = matchesTool(toolName, toolPolicy.allowedTools);
    const requiresApproval =
      matchesTool(toolName, toolPolicy.approvalRequiredTools) ||
      (normalizedIntent.sideEffect &&
        !explicitlyAllowed &&
        (toolPolicy.defaultSideEffectMode ?? "require-approval") ===
          "require-approval");

    if (
      normalizedIntent.sideEffect &&
      !explicitlyAllowed &&
      (toolPolicy.defaultSideEffectMode ?? "require-approval") === "deny"
    ) {
      return {
        decision: this.toolDecision(
          "blocked",
          `${toolName} is a side-effecting tool and the default policy is deny.`,
          normalizedIntent,
          inputFingerprint,
        ),
        intent: normalizedIntent,
        inputFingerprint,
        requiresApproval,
      };
    }

    if (requiresApproval) {
      const approval = normalizedIntent.approval;
      if (typeof approval?.token !== "string" || !approval.token.trim() ||
          typeof approval.approvedBy !== "string" || !approval.approvedBy.trim()) {
        return {
          decision: this.toolDecision(
            "approval-required",
            `${toolName} needs a scoped approval token from an authenticated reviewer.`,
            normalizedIntent,
            inputFingerprint,
            true,
          ),
          intent: normalizedIntent,
          inputFingerprint,
          requiresApproval,
        };
      }
      const tokenFingerprint = approvalTokenFingerprint(approval.token);
      if (
        this.consumedApprovalTokenFingerprints.has(tokenFingerprint) ||
        this.pendingApprovalTokenFingerprints.has(tokenFingerprint)
      ) {
        return {
          decision: this.toolDecision(
            "blocked",
            this.pendingApprovalTokenFingerprints.has(tokenFingerprint)
              ? "This approval token is already being verified or used."
              : "This approval token has already been consumed.",
            normalizedIntent,
            inputFingerprint,
            true,
          ),
          intent: normalizedIntent,
          inputFingerprint,
          requiresApproval,
        };
      }
      if (!this.host.approvalVerifier) {
        return {
          decision: this.toolDecision(
            "approval-required",
            "No approval verifier is configured for this session.",
            normalizedIntent,
            inputFingerprint,
            true,
          ),
          intent: normalizedIntent,
          inputFingerprint,
          requiresApproval,
        };
      }
    }

    return {
      intent: normalizedIntent,
      inputFingerprint,
      requiresApproval,
    };
  }

  private approvalContext<TInput>(
    intent: ToolIntent<TInput>,
    inputFingerprint: string,
  ): Readonly<ToolApprovalContext> {
    return {
      sessionId: this.host.sessionId,
      runId: this.host.currentRunId(),
      toolName: intent.toolName,
      action: intent.action,
      inputFingerprint,
      approval: Object.freeze({ ...intent.approval! }),
    };
  }

  private allowedToolDecision<TInput>(
    prepared: {
      intent: ToolIntent<TInput>;
      inputFingerprint: string;
      requiresApproval: boolean;
    },
    approvalVerified: boolean,
  ) {
    return this.toolDecision(
      "allowed",
      approvalVerified
        ? `Scoped approval verified for ${prepared.intent.approval?.approvedBy}.`
        : prepared.intent.sideEffect
          ? `${prepared.intent.toolName} is explicitly allowed by host policy.`
          : `${prepared.intent.toolName} is read-only.`,
      prepared.intent,
      prepared.inputFingerprint,
      prepared.requiresApproval,
      approvalVerified,
    );
  }

  private async authorizeToolWithAsyncVerifier<TInput>(
    intent: ToolIntent<TInput>,
    consumeApproval: boolean,
  ): Promise<ToolDecision<TInput>> {
    const revision = this.host.revision();
    const prepared = this.prepareToolAuthorization(intent);
    if (prepared.decision) return prepared.decision;
    if (!prepared.requiresApproval) {
      return this.allowedToolDecision(prepared, false);
    }

    const approval = prepared.intent.approval!;
    const tokenFingerprint = approvalTokenFingerprint(approval.token);
    this.pendingApprovalTokenFingerprints.add(tokenFingerprint);
    try {
      let approvalVerified = false;
      try {
        approvalVerified =
          (await this.host.approvalVerifier!(
            this.approvalContext(
              prepared.intent,
              prepared.inputFingerprint,
            ),
          )) === true;
      } catch {
        return this.toolDecision(
          "blocked",
          "The approval verifier failed closed.",
          prepared.intent,
          prepared.inputFingerprint,
          true,
        );
      }
      if (!approvalVerified) {
        return this.toolDecision(
          "approval-required",
          "The supplied approval is invalid or does not match this action.",
          prepared.intent,
          prepared.inputFingerprint,
          true,
        );
      }
      if (this.host.isFrozen() || this.host.revision() !== revision) {
        return this.toolDecision("blocked", "The run changed or was frozen while approval was pending.",
          prepared.intent, prepared.inputFingerprint, true);
      }
      if (consumeApproval) {
        this.consumedApprovalTokenFingerprints.add(tokenFingerprint);
      }
      return this.allowedToolDecision(prepared, true);
    } finally {
      this.pendingApprovalTokenFingerprints.delete(tokenFingerprint);
    }
  }

  async executeTool<TInput, TResult>(
    intent: ToolIntent<TInput>,
    execute: (input: TInput) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    // Validate before cloning: structuredClone alone invokes getters and drops
    // unsupported object properties. Fingerprinting rejects those shapes.
    const inputFingerprint = fingerprintValue(intent.input);
    const capturedInput = structuredClone(intent.input);
    if (fingerprintValue(capturedInput) !== inputFingerprint) {
      throw new Error("Tool input cannot be copied without changing its fingerprint.");
    }
    intent = { ...intent, input: capturedInput,
      approval: intent.approval ? { ...intent.approval } : undefined };
    const revision = this.host.revision();
    const idempotencyKey = cleanOptionalText(
      intent.idempotencyKey,
      "Tool idempotency key",
    );
    const operationFingerprint = fingerprintValue({
      toolName: intent.toolName.trim(),
      action: intent.action.trim(),
      input: intent.input,
    });
    if (idempotencyKey) {
      const existing = this.toolExecutions.get(idempotencyKey);
      if (existing) {
        if (existing.operationFingerprint !== operationFingerprint) {
          throw new LineageGuardDuplicateExecutionError(
            idempotencyKey,
            "The tool idempotency key was reused for a different operation.",
          );
        }
        if (existing.promise) {
          return existing.promise as Promise<TResult>;
        }
        if (existing.status === "completed" && existing.hasResult) {
          return existing.result as TResult;
        }
        throw new LineageGuardDuplicateExecutionError(
          idempotencyKey,
          "This operation was already recorded; its prior result is not available after restoration.",
        );
      }
    }

    this.activeToolExecutions += 1;
    // Reserve the idempotency record before invoking host callbacks, which may
    // synchronously reenter this session.
    const executionPromise = Promise.resolve().then(async () => {
      const decision = await this.authorizeToolWithAsyncVerifier(intent, true);
      if (decision.status !== "allowed") {
        throw new LineageGuardBlockedError(decision);
      }
      if (this.host.isFrozen() || this.host.revision() !== revision) {
        throw new LineageGuardBlockedError({ ...decision, status: "blocked",
          reason: "The run changed or was frozen before tool execution." });
      }
      return execute(decision.intent.input as TInput);
    });
    const record: ToolExecutionRecord | undefined = idempotencyKey
      ? {
          idempotencyKey,
          operationFingerprint,
          status: "pending",
          promise: executionPromise,
        }
      : undefined;
    if (record) this.toolExecutions.set(idempotencyKey!, record);

    try {
      const result = await executionPromise;
      if (record) {
        record.status = "completed";
        record.promise = undefined;
        record.result = result;
        record.hasResult = true;
      }
      return result;
    } catch (error) {
      // Only a completed execution is deduplicated. A blocked or failed
      // attempt leaves no record, so a retry under the same key re-invokes
      // the tool instead of replaying the error.
      if (record) this.toolExecutions.delete(idempotencyKey!);
      throw error;
    } finally {
      this.activeToolExecutions -= 1;
    }
  }

  private toolDecision<TInput>(
    status: ToolDecision<TInput>["status"],
    reason: string,
    intent: ToolIntent<TInput>,
    inputFingerprint: string,
    requiresApproval = false,
    approvalVerified = false,
  ): ToolDecision<TInput> {
    const decision = {
      status,
      reason,
      intent,
      inputFingerprint,
      requiresApproval,
      approvalVerified,
    };
    this.host.emit(
      status === "allowed" ? "tool-allowed" : "tool-blocked",
      `${intent.toolName}: ${reason}`,
    );
    return decision;
  }
}
