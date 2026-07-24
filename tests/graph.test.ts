import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTraceGraphPayload,
  runReliabilityGraphPipeline,
} from "../lib/graph.ts";
import { LineageGuardGraphRun } from "../sdk/index.ts";

const graphNodes = [
  {
    id: "source",
    label: "Research source",
    text: "A pilot suggests some users may improve by 12–18%.",
    parentIds: [],
  },
  {
    id: "policy",
    label: "Publishing policy",
    text: "Do not publish without human approval.",
    parentIds: [],
  },
  {
    id: "research",
    label: "Research agent",
    text: "A pilot suggests some users may improve by 12–18%.",
    parentIds: ["source"],
  },
  {
    id: "writer",
    label: "Writer",
    text: "The pilot proves all users improve by 18%. Human approval is required.",
    parentIds: ["research", "policy"],
    inheritedClaims: {
      research: "The pilot proves all users improve by 18%.",
      policy: "Human approval is required before publishing.",
    },
  },
  {
    id: "publisher",
    label: "Publisher",
    text: "The pilot proves all users improve by 18%.",
    parentIds: ["writer"],
  },
] as const;

test("analyzes a DAG edge-by-edge and contains only descendants", () => {
  const run = runReliabilityGraphPipeline(
    graphNodes.map((node) => ({
      ...node,
      parentIds: [...node.parentIds],
      inheritedClaims:
        "inheritedClaims" in node ? { ...node.inheritedClaims } : undefined,
    })),
    "Do not publish without human approval.",
  );

  assert.match(run.id, /^GRUN-[A-F0-9]{16}$/);
  assert.equal(run.firstBlockingEdgeId, "research->writer");
  assert.deepEqual(
    new Set(run.recovery.contaminatedNodeIds),
    new Set(["writer", "publisher"]),
  );
  assert.equal(
    run.nodes.find((node) => node.id === "policy")?.state,
    "verified",
  );
  assert.deepEqual(
    run.recovery.verifiedParents.map((parent) => parent.id),
    ["research", "policy"],
  );
});

test("uses per-parent claim projections for clean merge edges", () => {
  const run = new LineageGuardGraphRun()
    .recordRoot("facts", "Facts", "The estimate may be 5%.")
    .recordRoot("policy", "Policy", "Human approval is required.")
    .recordHandoff(
      "merge",
      "Merge",
      "The estimate may be 5%. Human approval is required.",
      ["facts", "policy"],
      {
        facts: "The estimate may be 5%.",
        policy: "Human approval is required.",
      },
    )
    .finalize();

  assert.equal(run.firstBlockingEdgeId, null);
  assert.equal(run.recovery.status, "not-required");
  assert.ok(run.edges.every((edge) => edge.severity === "clean"));
});

test("rejects graph cycles and missing parents", () => {
  assert.throws(
    () =>
      runReliabilityGraphPipeline([
        {
          id: "a",
          label: "A",
          text: "A",
          parentIds: ["b"],
        },
        {
          id: "b",
          label: "B",
          text: "B",
          parentIds: ["a"],
        },
      ]),
    /root|cycle/i,
  );
  assert.throws(
    () =>
      runReliabilityGraphPipeline([
        {
          id: "root",
          label: "Root",
          text: "Root",
          parentIds: [],
        },
        {
          id: "child",
          label: "Child",
          text: "Child",
          parentIds: ["missing"],
        },
      ]),
    /missing parent/i,
  );
});

test("parses the versioned graph contract", () => {
  const parsed = parseTraceGraphPayload({
    schemaVersion: "1.1",
    runName: "Diamond",
    nodes: [
      { id: "root", label: "Root", text: "Root text.", parentIds: [] },
      {
        id: "child",
        label: "Child",
        text: "Root text.",
        parentIds: ["root"],
      },
    ],
  });

  assert.equal(parsed.runName, "Diamond");
  assert.deepEqual(parsed.nodes[1].parentIds, ["root"]);
});

test("rejects an invalid graph blocking threshold", () => {
  assert.throws(
    () =>
      runReliabilityGraphPipeline(
        graphNodes.map((node) => ({
          ...node,
          parentIds: [...node.parentIds],
          inheritedClaims:
            "inheritedClaims" in node
              ? { ...node.inheritedClaims }
              : undefined,
        })),
        "",
        {
          blockAtOrAbove: "disabled" as never,
        },
      ),
    /blocking threshold must be/i,
  );
});

test("keeps graph edge ids unambiguous when node ids contain arrows", () => {
  const run = runReliabilityGraphPipeline([
    {
      id: "a->b",
      label: "First root",
      text: "The estimate may be 5%.",
      parentIds: [],
    },
    {
      id: "c",
      label: "First child",
      text: "The estimate may be 5%.",
      parentIds: ["a->b"],
    },
    {
      id: "a",
      label: "Second root",
      text: "The estimate may be 5%.",
      parentIds: [],
    },
    {
      id: "b->c",
      label: "Second child",
      text: "The estimate may be 5%.",
      parentIds: ["a"],
    },
  ]);

  assert.deepEqual(
    run.edges.map((edge) => edge.id).sort(),
    ["a-%3Eb->c", "a->b-%3Ec"],
  );
});

test("copies graph builder inputs before storing them", () => {
  const parentIds = ["facts"];
  const inheritedClaims = { facts: "The estimate may be 5%." };
  const run = new LineageGuardGraphRun()
    .recordRoot("facts", "Facts", "The estimate may be 5%.")
    .recordHandoff(
      "writer",
      "Writer",
      "The estimate may be 5%.",
      parentIds,
      inheritedClaims,
    );

  parentIds[0] = "missing";
  inheritedClaims.facts = "The estimate is definitely 50%.";

  assert.deepEqual(run.toTrace().nodes[1], {
    id: "writer",
    label: "Writer",
    text: "The estimate may be 5%.",
    parentIds: ["facts"],
    inheritedClaims: { facts: "The estimate may be 5%." },
  });
  assert.equal(run.finalize().firstBlockingEdgeId, null);
});
