import {
  DEFAULT_PHYSICS_SETTINGS,
  clonePositions,
  meanMovement,
  nodeOverlapCount,
  physicsMetrics,
  refinePhysicsPositions
} from "./physics-core.mjs";

function pinnedSet(ids) {
  return new Set(Array.isArray(ids) ? ids : []);
}

export function relaxPhysicsBatch(
  view,
  sourcePositions,
  pinnedIds = [],
  settings = DEFAULT_PHYSICS_SETTINGS,
  { includeDiagnostics = true, iterations } = {}
) {
  const positions = clonePositions(sourcePositions);
  const pinned = pinnedSet(pinnedIds);
  const passCount = Math.max(1, Math.min(8, iterations ?? Math.round(Math.max(0.2, settings.speed) * 2)));
  for (let pass = 0; pass < passCount; pass++) {
    refinePhysicsPositions(view, positions, pinned, settings);
  }
  const movement = meanMovement(sourcePositions, positions);
  const metrics = includeDiagnostics
    ? physicsMetrics(view, positions, settings, movement)
    : { nodeOverlaps: nodeOverlapCount(view, positions), movement };
  return { positions, metrics, movement };
}

export function runPhysicsWorkerTask(type, payload) {
  if (type === "relax") {
    return relaxPhysicsBatch(
      payload.view,
      payload.positions,
      payload.pinned,
      payload.settings,
      payload.options
    );
  }
  throw new Error(`Unknown physics worker task ${type}`);
}
