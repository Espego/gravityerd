import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PHYSICS_SETTINGS,
  activePhysicsEdges,
  angularGapError,
  angularNeighborMap,
  edgeContractionMagnitude,
  initialPositions,
  physicsMetrics,
  refinePhysicsPositions,
  resolveRectangleCollisions
} from "../app/src/physics-core.mjs";
import { fcoseOptions } from "../app/src/physics-engines.mjs";
import { relaxPhysicsBatch } from "../app/src/physics-worker-tasks.mjs";

const view = {
  nodes: [
    { id: "a", width: 200, height: 100, domain: "one" },
    { id: "b", width: 220, height: 120, domain: "one" },
    { id: "c", width: 180, height: 90, domain: "two" }
  ],
  edges: [
    { id: "ab", source: "a", target: "b", audit: false, physicalCount: 2 },
    { id: "ac-audit", source: "a", target: "c", audit: true, physicalCount: 1 }
  ],
  groups: { one: ["a", "b"], two: ["c"] }
};

const fanOnly = {
  ...DEFAULT_PHYSICS_SETTINGS,
  edgeContraction: 0,
  repulsion: 0,
  gravity: 0,
  collisionPadding: 0,
  domainAttraction: 0,
  fanTension: 1,
  speed: 1
};

test("seeded positions are deterministic and a different seed changes them", () => {
  assert.deepEqual(initialPositions(view, 42), initialPositions(view, 42));
  assert.notDeepEqual(initialPositions(view, 42), initialPositions(view, 43));
});

test("physical FK count and audit weight determine spring weight", () => {
  const hidden = activePhysicsEdges(view, DEFAULT_PHYSICS_SETTINGS);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].weight, 2);
  const visible = activePhysicsEdges(view, { ...DEFAULT_PHYSICS_SETTINGS, showAuditEdges: true, auditWeight: 0.2 });
  assert.equal(visible.length, 2);
  assert.equal(visible.find((edge) => edge.audit).weight, 0.2);
});

test("rectangle collision resolution uses dimensions and treats pins as absolute", () => {
  const positions = { a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, c: { x: 700, y: 0 } };
  resolveRectangleCollisions(view, positions, new Set(["a"]), 24, 8);
  assert.deepEqual(positions.a, { x: 0, y: 0 });
  assert.notDeepEqual(positions.b, { x: 20, y: 0 });
  assert.equal(physicsMetrics(view, positions).nodeOverlaps, 0);

  const pinnedOverlap = { a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, c: { x: 700, y: 0 } };
  resolveRectangleCollisions(view, pinnedOverlap, new Set(["a", "b"]), 24, 8);
  assert.deepEqual(pinnedOverlap.a, { x: 0, y: 0 });
  assert.deepEqual(pinnedOverlap.b, { x: 20, y: 0 });
  assert.equal(physicsMetrics(view, pinnedOverlap).nodeOverlaps, 1);
});

test("realtime edge contraction shortens linked edges and preserves finite positions", () => {
  const positions = { a: { x: -600, y: 0 }, b: { x: 600, y: 0 }, c: { x: 0, y: 500 } };
  const before = Math.abs(positions.b.x - positions.a.x);
  for (let pass = 0; pass < 12; pass++) {
    refinePhysicsPositions(view, positions, new Set(), {
      ...DEFAULT_PHYSICS_SETTINGS,
      gravity: 0,
      domainAttraction: 0,
      fanTension: 0
    });
  }
  assert.ok(Math.abs(positions.b.x - positions.a.x) < before);
  assert.ok(Object.values(positions).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("edge contraction grows superlinearly for long edges without destabilizing the step", () => {
  const short = edgeContractionMagnitude(200, 1, 1.65);
  const long = edgeContractionMagnitude(400, 1, 1.65);
  assert.ok(long > short * 2);
  assert.equal(edgeContractionMagnitude(400, 0, 1.65), 0);
  assert.ok(Number.isFinite(edgeContractionMagnitude(1_000_000, 3, 2.5)));
  assert.equal(edgeContractionMagnitude(1_000_000, 3, 2.5), 96);
});

test("angular fans straighten degree-two chains", () => {
  const chain = {
    nodes: [
      { id: "left", width: 80, height: 60, domain: "chain" },
      { id: "middle", width: 80, height: 60, domain: "chain" },
      { id: "right", width: 80, height: 60, domain: "chain" }
    ],
    edges: [
      { id: "middle-left", source: "middle", target: "left", audit: false, physicalCount: 1 },
      { id: "middle-right", source: "middle", target: "right", audit: false, physicalCount: 1 }
    ],
    groups: { chain: ["left", "middle", "right"] }
  };
  const positions = {
    left: { x: -400, y: 0 },
    middle: { x: 0, y: 300 },
    right: { x: 400, y: 0 }
  };
  const before = angularGapError(chain, positions);
  for (let pass = 0; pass < 24; pass++) refinePhysicsPositions(chain, positions, new Set(), fanOnly);
  assert.ok(angularGapError(chain, positions) < before * 0.5);
});

test("angular fans spread a hub without reserving slots for parallel or audit FK", () => {
  const hub = {
    nodes: [
      { id: "hub", width: 100, height: 80, domain: "one" },
      { id: "a", width: 60, height: 40, domain: "one" },
      { id: "b", width: 60, height: 40, domain: "one" },
      { id: "c", width: 60, height: 40, domain: "one" },
      { id: "audit", width: 60, height: 40, domain: "one" }
    ],
    edges: [
      { id: "hub-a-1", source: "a", target: "hub", audit: false, physicalCount: 1 },
      { id: "hub-a-2", source: "a", target: "hub", audit: false, physicalCount: 1 },
      { id: "hub-b", source: "b", target: "hub", audit: false, physicalCount: 1 },
      { id: "hub-c", source: "c", target: "hub", audit: false, physicalCount: 1 },
      { id: "hub-audit", source: "audit", target: "hub", audit: true, physicalCount: 1 }
    ],
    groups: { one: ["hub", "a", "b", "c", "audit"] }
  };
  assert.deepEqual(angularNeighborMap(hub).get("hub"), ["a", "b", "c"]);
  const positions = {
    hub: { x: 0, y: 0 },
    a: { x: 400, y: 0 },
    b: { x: 400, y: 50 },
    c: { x: 400, y: 100 },
    audit: { x: -400, y: 0 }
  };
  const before = angularGapError(hub, positions);
  for (let pass = 0; pass < 40; pass++) refinePhysicsPositions(hub, positions, new Set(["hub", "audit"]), fanOnly);
  assert.ok(angularGapError(hub, positions) < before * 0.7);
  assert.deepEqual(positions.hub, { x: 0, y: 0 });
  assert.deepEqual(positions.audit, { x: -400, y: 0 });
});

test("diagnostics never reject or alter a realtime step", () => {
  const crossingView = {
    nodes: view.nodes,
    edges: [{ id: "ac", source: "a", target: "c", audit: false, physicalCount: 1 }],
    groups: view.groups
  };
  const positions = { a: { x: -400, y: 0 }, b: { x: 0, y: 0 }, c: { x: 400, y: 0 } };
  assert.equal(physicsMetrics(crossingView, positions).nodeIntersections, 1);
  const withDiagnostics = relaxPhysicsBatch(crossingView, positions, [], DEFAULT_PHYSICS_SETTINGS, {
    includeDiagnostics: true,
    iterations: 1
  });
  const withoutDiagnostics = relaxPhysicsBatch(crossingView, positions, [], DEFAULT_PHYSICS_SETTINGS, {
    includeDiagnostics: false,
    iterations: 1
  });
  assert.deepEqual(withDiagnostics.positions, withoutDiagnostics.positions);
  assert.equal(withoutDiagnostics.metrics.nodeIntersections, undefined);
});

test("realtime worker preserves every pinned coordinate", () => {
  const positions = initialPositions(view, 123);
  const fixed = { ...positions.a };
  const result = relaxPhysicsBatch(view, positions, ["a"], DEFAULT_PHYSICS_SETTINGS, { iterations: 5 });
  assert.deepEqual(result.positions.a, fixed);
  assert.ok(Object.values(result.positions).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("fCoSE bootstrap keeps the shared start and explicit fixed constraints", () => {
  const positions = initialPositions(view, 100);
  const options = fcoseOptions(DEFAULT_PHYSICS_SETTINGS, new Set(["b"]), positions);
  assert.equal(options.randomize, false);
  assert.deepEqual(options.fixedNodeConstraint, [{ nodeId: "b", position: positions.b }]);
  assert.equal(options.idealEdgeLength({ data: () => 4 }), 70);
  assert.equal(options.numIter, 240);
});
