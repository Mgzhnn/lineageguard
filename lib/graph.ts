import {
  analyzeLineage,
  type CustomLineageRule,
  type LineageIssue,
  type Severity,
  type TraceStage,
} from "./analysis.ts";
import { fingerprintValue } from "./fingerprint.ts";
import { TRACE_LIMITS, TracePayloadError } from "./trace-schema.ts";
import { PIPELINE_VERSION } from "./version.ts";

export type TraceGraphStage = TraceStage & {
  parentIds: string[];
  /**
   * Optional claim projection for each incoming edge. A merge node should use
   * this to compare each parent with the portion of the merged output that
   * descends from that parent.
   */
  inheritedClaims?: Record<string, string>;
};

export type GraphLineageIssue = LineageIssue & {
  edgeId: string;
  edgeIndex: number;
  fromStageId: string;
  toStageId: string;
};

export type GraphEdgeResult = {
  id: string;
  edgeIndex: number;
  from: string;
  to: string;
  comparedText: string;
  severity: Severity | "clean";
  issues: GraphLineageIssue[];
};

export type GraphNodeResult = TraceGraphStage & {
  topologicalIndex: number;
  state: "clean" | "verified" | "first-break" | "downstream";
};

export type GraphRecoveryPacket = {
  status: "not-required" | "review-required";
  failedEdgeId: string | null;
  retryNodeId: string | null;
  retryNodeLabel: string | null;
  rejectedText: string | null;
  verifiedParents: Array<{
    id: string;
    label: string;
    text: string;
  }>;
  contaminatedNodeIds: string[];
  protectedInstruction: string;
};

export type ReliabilityGraphRun = {
  id: string;
  fingerprint: string;
  version: typeof PIPELINE_VERSION;
  blockAtOrAbove: Severity;
  topologicalOrder: string[];
  roots: string[];
  nodes: GraphNodeResult[];
  edges: GraphEdgeResult[];
  issues: GraphLineageIssue[];
  firstBlockingEdgeId: string | null;
  ruleFamilyAgreement: {
    active: number;
    total: 3;
    edgeId: string | null;
    summary: string;
  };
  recovery: GraphRecoveryPacket;
};

export type ReliabilityGraphOptions = {
  blockAtOrAbove?: Severity;
  rules?: readonly CustomLineageRule[];
};

export type NormalizedTraceGraphPayload = {
  runName: string;
  guardrail: string;
  nodes: TraceGraphStage[];
};

const severityRank: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(
  record: Record<string, unknown>,
  key: string,
  location: string,
  limit: number,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new TracePayloadError(`${location}.${key} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > limit) {
    throw new TracePayloadError(
      `${location}.${key} must be at most ${limit} characters.`,
    );
  }
  return normalized;
}

function highestSeverity(issues: LineageIssue[]): Severity | "clean" {
  return issues.reduce<Severity | "clean">(
    (highest, issue) =>
      severityRank[issue.severity] > severityRank[highest]
        ? issue.severity
        : highest,
    "clean",
  );
}

function graphEdgeId(from: string, to: string) {
  return `${encodeURIComponent(from)}->${encodeURIComponent(to)}`;
}

function validateAndSortGraph(nodes: readonly TraceGraphStage[]) {
  if (nodes.length < 2) {
    throw new TracePayloadError(
      "A trace graph needs at least two nodes and one edge.",
    );
  }
  if (nodes.length > TRACE_LIMITS.stages) {
    throw new TracePayloadError(
      `A trace graph can contain at most ${TRACE_LIMITS.stages} nodes.`,
    );
  }

  const nodeById = new Map<string, TraceGraphStage>();
  let totalTextCharacters = 0;
  nodes.forEach((node, index) => {
    const id = node.id.trim();
    if (!id || !node.label.trim() || !node.text.trim()) {
      throw new TracePayloadError(
        `nodes[${index}] id, label, and text must be non-empty.`,
      );
    }
    if (id.length > TRACE_LIMITS.identifierCharacters) {
      throw new TracePayloadError(
        `nodes[${index}].id exceeds the identifier limit.`,
      );
    }
    if (node.label.trim().length > TRACE_LIMITS.labelCharacters) {
      throw new TracePayloadError(
        `nodes[${index}].label exceeds the label limit.`,
      );
    }
    if (node.text.trim().length > TRACE_LIMITS.stageTextCharacters) {
      throw new TracePayloadError(
        `nodes[${index}].text exceeds the stage text limit.`,
      );
    }
    if (nodeById.has(id)) {
      throw new TracePayloadError(`Graph node id "${id}" must be unique.`);
    }
    const normalizedParents = node.parentIds.map((parentId) =>
      parentId.trim(),
    );
    if (new Set(normalizedParents).size !== normalizedParents.length) {
      throw new TracePayloadError(
        `Graph node "${id}" contains a duplicate parent id.`,
      );
    }
    totalTextCharacters += node.text.trim().length;
    totalTextCharacters += Object.values(node.inheritedClaims ?? {}).reduce(
      (total, claim) => total + claim.trim().length,
      0,
    );
    nodeById.set(id, {
      ...node,
      id,
      label: node.label.trim(),
      text: node.text.trim(),
      parentIds: normalizedParents,
      inheritedClaims: node.inheritedClaims
        ? Object.fromEntries(
            Object.entries(node.inheritedClaims).map(([parentId, text]) => [
              parentId.trim(),
              text.trim(),
            ]),
          )
        : undefined,
    });
  });
  if (totalTextCharacters > TRACE_LIMITS.totalTextCharacters) {
    throw new TracePayloadError(
      `Trace graph text must total at most ${TRACE_LIMITS.totalTextCharacters} characters.`,
    );
  }

  for (const node of nodeById.values()) {
    for (const parentId of node.parentIds) {
      if (!parentId) {
        throw new TracePayloadError(
          `Graph node "${node.id}" contains an empty parent id.`,
        );
      }
      if (parentId === node.id) {
        throw new TracePayloadError(
          `Graph node "${node.id}" cannot be its own parent.`,
        );
      }
      if (!nodeById.has(parentId)) {
        throw new TracePayloadError(
          `Graph node "${node.id}" references missing parent "${parentId}".`,
        );
      }
      if (parentId.length > TRACE_LIMITS.identifierCharacters) {
        throw new TracePayloadError(
          `Graph node "${node.id}" has an overlong parent id.`,
        );
      }
    }
    for (const [parentId, claim] of Object.entries(
      node.inheritedClaims ?? {},
    )) {
      if (!node.parentIds.includes(parentId)) {
        throw new TracePayloadError(
          `Graph node "${node.id}" has a claim for non-parent "${parentId}".`,
        );
      }
      if (!claim) {
        throw new TracePayloadError(
          `Graph node "${node.id}" has an empty inherited claim.`,
        );
      }
      if (claim.length > TRACE_LIMITS.stageTextCharacters) {
        throw new TracePayloadError(
          `Graph node "${node.id}" has an overlong inherited claim.`,
        );
      }
    }
  }

  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodeById.values()) {
    inDegree.set(node.id, node.parentIds.length);
    node.parentIds.forEach((parentId) => {
      const childIds = children.get(parentId) ?? [];
      childIds.push(node.id);
      children.set(parentId, childIds);
    });
  }

  const queue = [...nodeById.values()]
    .filter((node) => node.parentIds.length === 0)
    .map((node) => node.id);
  if (!queue.length) {
    throw new TracePayloadError("A trace graph needs at least one root node.");
  }
  const order: string[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    order.push(nodeId);
    for (const childId of children.get(nodeId) ?? []) {
      const nextDegree = (inDegree.get(childId) ?? 0) - 1;
      inDegree.set(childId, nextDegree);
      if (nextDegree === 0) queue.push(childId);
    }
  }
  if (order.length !== nodes.length) {
    throw new TracePayloadError("Trace graph parent links contain a cycle.");
  }

  return {
    nodes: order.map((id) => nodeById.get(id)!),
    nodeById,
    children,
    roots: order.filter((id) => nodeById.get(id)!.parentIds.length === 0),
  };
}

function descendantsFrom(
  startId: string,
  children: ReadonlyMap<string, string[]>,
) {
  const descendants = new Set<string>([startId]);
  const queue = [startId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const childId of children.get(queue[cursor]) ?? []) {
      if (descendants.has(childId)) continue;
      descendants.add(childId);
      queue.push(childId);
    }
  }
  return descendants;
}

export function runReliabilityGraphPipeline(
  inputNodes: readonly TraceGraphStage[],
  guardrail = "",
  options: ReliabilityGraphOptions = {},
): ReliabilityGraphRun {
  if (guardrail.length > TRACE_LIMITS.guardrailCharacters) {
    throw new TracePayloadError(
      `Graph guardrail must be at most ${TRACE_LIMITS.guardrailCharacters} characters.`,
    );
  }
  const blockAtOrAbove = options.blockAtOrAbove ?? "medium";
  if (
    blockAtOrAbove !== "low" &&
    blockAtOrAbove !== "medium" &&
    blockAtOrAbove !== "high"
  ) {
    throw new TracePayloadError(
      "Graph blocking threshold must be low, medium, or high.",
    );
  }
  const { nodes, nodeById, children, roots } =
    validateAndSortGraph(inputNodes);
  const edges: GraphEdgeResult[] = [];

  for (const node of nodes) {
    for (const parentId of node.parentIds) {
      const parent = nodeById.get(parentId)!;
      const comparedText = node.inheritedClaims?.[parentId] ?? node.text;
      const edgeIndex = edges.length;
      const edgeId = graphEdgeId(parentId, node.id);
      const pairAnalysis = analyzeLineage(
        [
          parent,
          {
            id: node.id,
            label: node.label,
            text: comparedText,
          },
        ],
        guardrail,
        { rules: options.rules },
      );
      const issues = pairAnalysis.issues.map(
        (issue): GraphLineageIssue => ({
          ...issue,
          id: `${edgeId}:${issue.id}`,
          transitionIndex: edgeIndex,
          edgeId,
          edgeIndex,
          fromStageId: parentId,
          toStageId: node.id,
        }),
      );
      edges.push({
        id: edgeId,
        edgeIndex,
        from: parentId,
        to: node.id,
        comparedText,
        severity: highestSeverity(issues),
        issues,
      });
    }
  }
  if (!edges.length) {
    throw new TracePayloadError("A trace graph needs at least one edge.");
  }

  const firstBlockingEdge =
    edges.find(
      (edge) =>
        severityRank[edge.severity] >= severityRank[blockAtOrAbove],
    ) ?? null;
  const contaminated = firstBlockingEdge
    ? descendantsFrom(firstBlockingEdge.to, children)
    : new Set<string>();
  const graphNodes: GraphNodeResult[] = nodes.map((node, index) => ({
    ...node,
    topologicalIndex: index,
    state: !firstBlockingEdge
      ? "clean"
      : node.id === firstBlockingEdge.to
        ? "first-break"
        : contaminated.has(node.id)
          ? "downstream"
          : "verified",
  }));
  const issues = edges.flatMap((edge) => edge.issues);
  const activeFamilies = new Set(
    firstBlockingEdge?.issues.map((issue) => issue.family) ?? [],
  );
  const retryNode = firstBlockingEdge
    ? nodeById.get(firstBlockingEdge.to)!
    : null;
  const fingerprint = fingerprintValue({
    schema: "lineageguard-graph/1",
    guardrail,
    blockAtOrAbove,
    nodes: nodes.map(
      ({ id, label, text, parentIds, inheritedClaims }) => ({
        id,
        label,
        text,
        parentIds,
        inheritedClaims,
      }),
    ),
  });

  return {
    id: `GRUN-${fingerprint.slice(0, 16).toUpperCase()}`,
    fingerprint: `SHA256-${fingerprint.toUpperCase()}`,
    version: PIPELINE_VERSION,
    blockAtOrAbove,
    topologicalOrder: nodes.map((node) => node.id),
    roots,
    nodes: graphNodes,
    edges,
    issues,
    firstBlockingEdgeId: firstBlockingEdge?.id ?? null,
    ruleFamilyAgreement: {
      active: activeFamilies.size,
      total: 3,
      edgeId: firstBlockingEdge?.id ?? null,
      summary: firstBlockingEdge
        ? `${activeFamilies.size}/3 rule families blocked ${firstBlockingEdge.id}.`
        : "No edge crossed the configured blocking threshold.",
    },
    recovery: retryNode
      ? {
          status: "review-required",
          failedEdgeId: firstBlockingEdge!.id,
          retryNodeId: retryNode.id,
          retryNodeLabel: retryNode.label,
          rejectedText: retryNode.text,
          verifiedParents: retryNode.parentIds.map((parentId) => {
            const parent = nodeById.get(parentId)!;
            return {
              id: parent.id,
              label: parent.label,
              text: parent.text,
            };
          }),
          contaminatedNodeIds: [...contaminated],
          protectedInstruction: guardrail,
        }
      : {
          status: "not-required",
          failedEdgeId: null,
          retryNodeId: null,
          retryNodeLabel: null,
          rejectedText: null,
          verifiedParents: [],
          contaminatedNodeIds: [],
          protectedInstruction: guardrail,
        },
  };
}

export function parseTraceGraphPayload(
  input: unknown,
): NormalizedTraceGraphPayload {
  if (!isRecord(input)) {
    throw new TracePayloadError("Trace graph payload must be a JSON object.");
  }
  if (input.schemaVersion !== "1.1") {
    throw new TracePayloadError('Trace graph schemaVersion must be "1.1".');
  }
  if (!Array.isArray(input.nodes)) {
    throw new TracePayloadError("Trace graph payload must include nodes.");
  }
  if (input.runName !== undefined && typeof input.runName !== "string") {
    throw new TracePayloadError("runName must be a string when provided.");
  }
  if (input.guardrail !== undefined && typeof input.guardrail !== "string") {
    throw new TracePayloadError("guardrail must be a string when provided.");
  }
  const nodes = input.nodes.map((item, index): TraceGraphStage => {
    if (!isRecord(item)) {
      throw new TracePayloadError(`nodes[${index}] must be an object.`);
    }
    if (!Array.isArray(item.parentIds)) {
      throw new TracePayloadError(
        `nodes[${index}].parentIds must be an array.`,
      );
    }
    const parentIds = item.parentIds.map((parentId, parentIndex) => {
      if (typeof parentId !== "string" || !parentId.trim()) {
        throw new TracePayloadError(
          `nodes[${index}].parentIds[${parentIndex}] must be a non-empty string.`,
        );
      }
      return parentId.trim();
    });
    let inheritedClaims: Record<string, string> | undefined;
    if (item.inheritedClaims !== undefined) {
      if (!isRecord(item.inheritedClaims)) {
        throw new TracePayloadError(
          `nodes[${index}].inheritedClaims must be an object.`,
        );
      }
      inheritedClaims = Object.fromEntries(
        Object.entries(item.inheritedClaims).map(([parentId, claim]) => {
          if (typeof claim !== "string" || !claim.trim()) {
            throw new TracePayloadError(
              `nodes[${index}].inheritedClaims.${parentId} must be non-empty.`,
            );
          }
          return [parentId, claim.trim()];
        }),
      );
    }
    return {
      id: requiredText(
        item,
        "id",
        `nodes[${index}]`,
        TRACE_LIMITS.identifierCharacters,
      ),
      label: requiredText(
        item,
        "label",
        `nodes[${index}]`,
        TRACE_LIMITS.labelCharacters,
      ),
      text: requiredText(
        item,
        "text",
        `nodes[${index}]`,
        TRACE_LIMITS.stageTextCharacters,
      ),
      parentIds,
      inheritedClaims,
    };
  });
  validateAndSortGraph(nodes);
  const runName =
    typeof input.runName === "string" && input.runName.trim()
      ? input.runName.trim()
      : "Imported graph run";
  if (runName.length > TRACE_LIMITS.runNameCharacters) {
    throw new TracePayloadError(
      `runName must be at most ${TRACE_LIMITS.runNameCharacters} characters.`,
    );
  }
  const guardrail =
    typeof input.guardrail === "string" ? input.guardrail.trim() : "";
  if (guardrail.length > TRACE_LIMITS.guardrailCharacters) {
    throw new TracePayloadError(
      `guardrail must be at most ${TRACE_LIMITS.guardrailCharacters} characters.`,
    );
  }

  return {
    runName,
    guardrail,
    nodes,
  };
}
