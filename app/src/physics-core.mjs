export const PHYSICS_STATE_VERSION = 2;
export const PHYSICS_MODEL = "fcose-realtime";

export const DEFAULT_PHYSICS_SETTINGS = Object.freeze({
  fcoseIdealEdgeLength: 140,
  fcoseAttraction: 1,
  fcoseRepulsion: 1,
  fcoseGravity: 1,
  fcoseIterations: 240,
  edgeContraction: 1,
  edgeContractionExponent: 1.65,
  repulsionRange: 220,
  repulsion: 1,
  gravity: 1,
  collisionPadding: 24,
  domainAttraction: 1.25,
  fanTension: 0.45,
  auditWeight: 0.15,
  showAuditEdges: false,
  speed: 1
});

export const PHYSICS_SETTING_LIMITS = Object.freeze({
  fcoseIdealEdgeLength: Object.freeze([40, 360]),
  fcoseAttraction: Object.freeze([0.1, 2]),
  fcoseRepulsion: Object.freeze([0.1, 4]),
  fcoseGravity: Object.freeze([0, 4]),
  fcoseIterations: Object.freeze([50, 600]),
  edgeContraction: Object.freeze([0, 3]),
  edgeContractionExponent: Object.freeze([1, 2.5]),
  repulsionRange: Object.freeze([40, 500]),
  repulsion: Object.freeze([0, 4]),
  gravity: Object.freeze([0, 4]),
  collisionPadding: Object.freeze([0, 100]),
  domainAttraction: Object.freeze([0, 2]),
  fanTension: Object.freeze([0, 2]),
  auditWeight: Object.freeze([0, 4]),
  speed: Object.freeze([0.2, 3])
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizePhysicsSettings(source = {}) {
  const result = { ...DEFAULT_PHYSICS_SETTINGS };
  for (const [name, [minimum, maximum]] of Object.entries(PHYSICS_SETTING_LIMITS)) {
    let legacyValue;
    if (name === "fcoseIdealEdgeLength") legacyValue = source.idealEdgeLength;
    else if (name === "fcoseAttraction") legacyValue = source.attraction;
    else if (name === "fcoseRepulsion") legacyValue = source.repulsion;
    else if (name === "fcoseGravity") legacyValue = source.gravity;
    else if (name === "edgeContraction") legacyValue = source.attraction;
    else if (name === "repulsionRange" && Number.isFinite(Number(source.idealEdgeLength))) {
      legacyValue = Number(source.idealEdgeLength) * 1.6;
    } else if (name === "fanTension") legacyValue = source.topologyTension;
    const value = Number(source[name] ?? legacyValue);
    if (Number.isFinite(value)) result[name] = Math.min(maximum, Math.max(minimum, value));
  }
  result.fcoseIterations = Math.round(result.fcoseIterations);
  result.showAuditEdges = Boolean(source.showAuditEdges);
  return result;
}

export function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function initialPositions(view, seed) {
  const random = seededRandom(seed);
  const area = view.nodes.reduce((sum, node) => sum + node.width * node.height, 0);
  const side = Math.max(1200, Math.sqrt(area * 5));
  const result = {};
  for (const node of [...view.nodes].sort((first, second) => first.id.localeCompare(second.id))) {
    result[node.id] = {
      x: Math.round((random() - 0.5) * side * 1000) / 1000,
      y: Math.round((random() - 0.5) * side * 1000) / 1000
    };
  }
  return result;
}

export function activePhysicsEdges(view, settings = DEFAULT_PHYSICS_SETTINGS) {
  return view.edges
    .filter((edge) => edge.visible !== false && (!edge.audit || settings.showAuditEdges))
    .map((edge) => ({
      ...edge,
      weight: edge.physicalCount * Number(edge.groupWeight ?? (edge.audit ? settings.auditWeight : 1))
    }));
}

function positionOf(positions, id) {
  const position = positions[id];
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error(`Missing finite position for ${id}`);
  }
  return position;
}

function movableShare(firstPinned, secondPinned) {
  if (firstPinned && secondPinned) return [0, 0];
  if (firstPinned) return [0, 1];
  if (secondPinned) return [1, 0];
  return [0.5, 0.5];
}

function stableDirection(id) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function rectangleRadius(node, ux, uy) {
  return Math.abs(ux) * node.width / 2 + Math.abs(uy) * node.height / 2;
}

export function resolveRectangleCollisions(view, positions, pinned = new Set(), padding = 24, passes = 6) {
  const nodes = [...view.nodes].sort((first, second) => first.id.localeCompare(second.id));
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (let firstIndex = 0; firstIndex < nodes.length; firstIndex++) {
      const first = nodes[firstIndex];
      const firstPosition = positionOf(positions, first.id);
      for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex++) {
        const second = nodes[secondIndex];
        const secondPosition = positionOf(positions, second.id);
        const dx = secondPosition.x - firstPosition.x;
        const dy = secondPosition.y - firstPosition.y;
        const overlapX = (first.width + second.width) / 2 + padding - Math.abs(dx);
        const overlapY = (first.height + second.height) / 2 + padding - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const [firstShare, secondShare] = movableShare(pinned.has(first.id), pinned.has(second.id));
        if (!firstShare && !secondShare) continue;
        if (overlapX < overlapY) {
          const direction = dx === 0 ? (first.id < second.id ? 1 : -1) : Math.sign(dx);
          firstPosition.x -= direction * overlapX * firstShare;
          secondPosition.x += direction * overlapX * secondShare;
        } else {
          const direction = dy === 0 ? (first.id < second.id ? 1 : -1) : Math.sign(dy);
          firstPosition.y -= direction * overlapY * firstShare;
          secondPosition.y += direction * overlapY * secondShare;
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
  return positions;
}

function emptyForces(view) {
  return Object.fromEntries(view.nodes.map((node) => [node.id, { x: 0, y: 0 }]));
}

function addForce(forces, id, x, y, scale = 1) {
  if (!forces[id]) return;
  forces[id].x += finite(x) * scale;
  forces[id].y += finite(y) * scale;
}

export function edgeContractionMagnitude(shrinkableDistance, strength, exponent, weight = 1) {
  const normalizedDistance = Math.max(0, finite(shrinkableDistance)) / 160;
  const safeStrength = Math.max(0, finite(strength));
  const safeExponent = Math.max(1, Math.min(3, finite(exponent, 1.65)));
  const safeWeight = Math.max(0, finite(weight, 1));
  return Math.min(96, safeStrength * safeWeight * 0.9 * normalizedDistance ** safeExponent);
}

function applyEdgeContraction(view, positions, pinned, settings, edges, forces) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = positionOf(positions, edge.source);
    const target = positionOf(positions, edge.target);
    let dx = target.x - source.x;
    let dy = target.y - source.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 0.001) {
      const direction = stableDirection(edge.id);
      dx = direction.x;
      dy = direction.y;
      distance = 1;
    }
    const ux = dx / distance;
    const uy = dy / distance;
    const minimumDistance = rectangleRadius(nodes.get(edge.source), ux, uy)
      + rectangleRadius(nodes.get(edge.target), ux, uy)
      + settings.collisionPadding;
    const shrinkableDistance = Math.max(0, distance - minimumDistance);
    const magnitude = edgeContractionMagnitude(
      shrinkableDistance,
      settings.edgeContraction,
      settings.edgeContractionExponent,
      edge.weight
    );
    const [sourceShare, targetShare] = movableShare(pinned.has(edge.source), pinned.has(edge.target));
    addForce(forces, edge.source, ux, uy, magnitude * sourceShare);
    addForce(forces, edge.target, -ux, -uy, magnitude * targetShare);
  }
}

function applyNodeRepulsion(view, positions, pinned, settings, forces) {
  const nodes = [...view.nodes].sort((first, second) => first.id.localeCompare(second.id));
  const influence = settings.repulsionRange + settings.collisionPadding;
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex++) {
    const first = nodes[firstIndex];
    const firstPosition = positionOf(positions, first.id);
    for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex++) {
      const second = nodes[secondIndex];
      const secondPosition = positionOf(positions, second.id);
      let dx = secondPosition.x - firstPosition.x;
      let dy = secondPosition.y - firstPosition.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        const direction = stableDirection(`${first.id}:${second.id}`);
        dx = direction.x;
        dy = direction.y;
        distance = 1;
      }
      const ux = dx / distance;
      const uy = dy / distance;
      const surfaceDistance = distance
        - rectangleRadius(first, ux, uy)
        - rectangleRadius(second, ux, uy);
      if (surfaceDistance >= influence) continue;
      const proximity = Math.max(0, influence - Math.max(0, surfaceDistance)) / Math.max(1, influence);
      const magnitude = settings.repulsion * (0.2 + proximity * proximity * 4.8);
      const [firstShare, secondShare] = movableShare(pinned.has(first.id), pinned.has(second.id));
      addForce(forces, first.id, -ux, -uy, magnitude * firstShare);
      addForce(forces, second.id, ux, uy, magnitude * secondShare);
    }
  }
}

function applyGravity(view, positions, pinned, strength, forces) {
  if (strength <= 0 || !view.nodes.length) return;
  const centroid = view.nodes.reduce((sum, node) => ({
    x: sum.x + positions[node.id].x,
    y: sum.y + positions[node.id].y
  }), { x: 0, y: 0 });
  centroid.x /= view.nodes.length;
  centroid.y /= view.nodes.length;
  for (const node of view.nodes) {
    if (pinned.has(node.id)) continue;
    addForce(
      forces,
      node.id,
      centroid.x - positions[node.id].x,
      centroid.y - positions[node.id].y,
      strength * 0.0007
    );
  }
}

function applyDomainAttraction(view, positions, pinned, strength, forces) {
  if (strength <= 0) return;
  for (const ids of Object.values(view.groups)) {
    const members = ids.filter((id) => positions[id]).sort();
    if (members.length < 2) continue;
    const centroid = members.reduce((sum, id) => ({
      x: sum.x + positions[id].x,
      y: sum.y + positions[id].y
    }), { x: 0, y: 0 });
    centroid.x /= members.length;
    centroid.y /= members.length;
    for (const id of members) {
      if (pinned.has(id)) continue;
      addForce(
        forces,
        id,
        centroid.x - positions[id].x,
        centroid.y - positions[id].y,
        strength * 0.0016
      );
    }
  }
}

export function angularNeighborMap(view) {
  const neighbors = new Map(view.nodes.map((node) => [node.id, new Set()]));
  for (const edge of view.edges) {
    if (edge.audit || edge.secondary || edge.visible === false) continue;
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }
  return new Map([...neighbors].map(([id, ids]) => [id, [...ids].sort()]));
}

function normalizeAngle(angle) {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function limitedVector(x, y, limit) {
  const length = Math.hypot(x, y);
  if (!length || length <= limit) return { x, y };
  return { x: x * limit / length, y: y * limit / length };
}

export function angularGapError(view, positions) {
  let total = 0;
  let count = 0;
  for (const [centerId, neighborIds] of angularNeighborMap(view)) {
    if (neighborIds.length < 2) continue;
    const center = positionOf(positions, centerId);
    const ordered = neighborIds.map((id) => ({
      id,
      angle: Math.atan2(positions[id].y - center.y, positions[id].x - center.x)
    })).sort((first, second) => first.angle - second.angle || first.id.localeCompare(second.id));
    const target = Math.PI * 2 / ordered.length;
    for (let index = 0; index < ordered.length; index++) {
      const gap = normalizeAngle(ordered[(index + 1) % ordered.length].angle - ordered[index].angle);
      total += Math.abs(target - gap);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function applyAngularFans(view, positions, pinned, strength, forces) {
  if (strength <= 0) return;
  for (const [centerId, neighborIds] of angularNeighborMap(view)) {
    if (neighborIds.length < 2) continue;
    const center = positionOf(positions, centerId);
    const ordered = neighborIds.map((id) => {
      const dx = positions[id].x - center.x;
      const dy = positions[id].y - center.y;
      return { id, angle: Math.atan2(dy, dx), radius: Math.max(1, Math.hypot(dx, dy)) };
    }).sort((first, second) => first.angle - second.angle || first.id.localeCompare(second.id));
    const targetGap = Math.PI * 2 / ordered.length;
    const degreeScale = strength * 0.055 / Math.sqrt(ordered.length);
    for (let index = 0; index < ordered.length; index++) {
      const first = ordered[index];
      const second = ordered[(index + 1) % ordered.length];
      const gap = normalizeAngle(second.angle - first.angle);
      const error = targetGap - gap;
      const firstMagnitude = error * Math.min(first.radius, 600) * degreeScale;
      const secondMagnitude = error * Math.min(second.radius, 600) * degreeScale;
      const firstVector = limitedVector(
        Math.sin(first.angle) * firstMagnitude,
        -Math.cos(first.angle) * firstMagnitude,
        7
      );
      const secondVector = limitedVector(
        -Math.sin(second.angle) * secondMagnitude,
        Math.cos(second.angle) * secondMagnitude,
        7
      );
      let residualX = 0;
      let residualY = 0;
      if (pinned.has(first.id)) {
        residualX += firstVector.x;
        residualY += firstVector.y;
      } else {
        addForce(forces, first.id, firstVector.x, firstVector.y);
      }
      if (pinned.has(second.id)) {
        residualX += secondVector.x;
        residualY += secondVector.y;
      } else {
        addForce(forces, second.id, secondVector.x, secondVector.y);
      }
      if (!pinned.has(centerId) && (residualX || residualY)) {
        addForce(forces, centerId, -residualX, -residualY, 0.5);
      }
    }
  }
}

function applyForces(view, positions, pinned, settings, forces) {
  const maxStep = 8 * Math.max(0.35, Math.min(1.75, settings.speed));
  for (const node of view.nodes) {
    if (pinned.has(node.id)) continue;
    const force = limitedVector(forces[node.id].x, forces[node.id].y, maxStep);
    positions[node.id].x = finite(positions[node.id].x + force.x, positions[node.id].x);
    positions[node.id].y = finite(positions[node.id].y + force.y, positions[node.id].y);
  }
}

export function refinePhysicsPositions(view, positions, pinned = new Set(), sourceSettings = DEFAULT_PHYSICS_SETTINGS) {
  const settings = normalizePhysicsSettings(sourceSettings);
  const forces = emptyForces(view);
  const edges = activePhysicsEdges(view, settings);
  applyEdgeContraction(view, positions, pinned, settings, edges, forces);
  applyNodeRepulsion(view, positions, pinned, settings, forces);
  applyGravity(view, positions, pinned, settings.gravity, forces);
  applyDomainAttraction(view, positions, pinned, settings.domainAttraction, forces);
  applyAngularFans(view, positions, pinned, settings.fanTension, forces);
  applyForces(view, positions, pinned, settings, forces);
  resolveRectangleCollisions(view, positions, pinned, settings.collisionPadding, 8);
  return positions;
}

function rectangleOverlap(first, firstPosition, second, secondPosition, padding = 0) {
  return Math.abs(firstPosition.x - secondPosition.x) < (first.width + second.width) / 2 + padding
    && Math.abs(firstPosition.y - secondPosition.y) < (first.height + second.height) / 2 + padding;
}

export function nodeOverlapCount(view, positions, padding = 0) {
  let result = 0;
  for (let first = 0; first < view.nodes.length; first++) {
    for (let second = first + 1; second < view.nodes.length; second++) {
      if (rectangleOverlap(
        view.nodes[first],
        positionOf(positions, view.nodes[first].id),
        view.nodes[second],
        positionOf(positions, view.nodes[second].id),
        padding
      )) result += 1;
    }
  }
  return result;
}

function segmentIntersectsRectangle(first, second, node, position) {
  const left = position.x - node.width / 2;
  const right = position.x + node.width / 2;
  const top = position.y - node.height / 2;
  const bottom = position.y + node.height / 2;
  let low = 0;
  let high = 1;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  for (const [p, q] of [[-dx, first.x - left], [dx, right - first.x], [-dy, first.y - top], [dy, bottom - first.y]]) {
    if (p === 0 && q < 0) return false;
    if (p === 0) continue;
    const ratio = q / p;
    if (p < 0) low = Math.max(low, ratio);
    else high = Math.min(high, ratio);
    if (low > high) return false;
  }
  return high > 0.001 && low < 0.999;
}

export function nodeIntersectionPairs(view, positions, settings = DEFAULT_PHYSICS_SETTINGS) {
  const result = [];
  for (const edge of activePhysicsEdges(view, settings)) {
    const source = positionOf(positions, edge.source);
    const target = positionOf(positions, edge.target);
    for (const node of view.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      if (segmentIntersectsRectangle(source, target, node, positionOf(positions, node.id))) {
        result.push({ edge, node });
      }
    }
  }
  return result;
}

function orientation(first, second, third) {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function properIntersection(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return first * second < 0 && third * fourth < 0;
}

function collinearOverlapLength(a, b, c, d) {
  if (Math.abs(orientation(a, b, c)) > 0.01 || Math.abs(orientation(a, b, d)) > 0.01) return 0;
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const values = horizontal ? [a.x, b.x, c.x, d.x] : [a.y, b.y, c.y, d.y];
  const firstMin = Math.min(values[0], values[1]);
  const firstMax = Math.max(values[0], values[1]);
  const secondMin = Math.min(values[2], values[3]);
  const secondMax = Math.max(values[2], values[3]);
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

export function physicsMetrics(view, positions, settings = DEFAULT_PHYSICS_SETTINGS, movement = 0) {
  const edges = activePhysicsEdges(view, settings);
  let nodeIntersections = 0;
  let crossings = 0;
  let sharedLength = 0;
  let totalEdgeLength = 0;
  for (const edge of edges) {
    const source = positionOf(positions, edge.source);
    const target = positionOf(positions, edge.target);
    totalEdgeLength += Math.hypot(target.x - source.x, target.y - source.y);
    for (const node of view.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      if (segmentIntersectsRectangle(source, target, node, positionOf(positions, node.id))) nodeIntersections += 1;
    }
  }
  for (let first = 0; first < edges.length; first++) {
    for (let second = first + 1; second < edges.length; second++) {
      const firstEdge = edges[first];
      const secondEdge = edges[second];
      if ([firstEdge.source, firstEdge.target].some((id) => id === secondEdge.source || id === secondEdge.target)) continue;
      const a = positionOf(positions, firstEdge.source);
      const b = positionOf(positions, firstEdge.target);
      const c = positionOf(positions, secondEdge.source);
      const d = positionOf(positions, secondEdge.target);
      if (properIntersection(a, b, c, d)) crossings += 1;
      sharedLength += collinearOverlapLength(a, b, c, d);
    }
  }
  const left = Math.min(...view.nodes.map((node) => positions[node.id].x - node.width / 2));
  const right = Math.max(...view.nodes.map((node) => positions[node.id].x + node.width / 2));
  const top = Math.min(...view.nodes.map((node) => positions[node.id].y - node.height / 2));
  const bottom = Math.max(...view.nodes.map((node) => positions[node.id].y + node.height / 2));
  return {
    nodeOverlaps: nodeOverlapCount(view, positions),
    nodeIntersections,
    crossings,
    sharedLength: Math.round(sharedLength * 100) / 100,
    totalEdgeLength: Math.round(totalEdgeLength * 100) / 100,
    area: Math.round((right - left) * (bottom - top)),
    movement: Math.round(finite(movement) * 1000) / 1000
  };
}

export function clonePositions(positions) {
  return Object.fromEntries(Object.entries(positions).map(([id, point]) => [id, { x: point.x, y: point.y }]));
}

export function meanMovement(before, after) {
  const ids = Object.keys(after);
  if (!ids.length) return 0;
  return ids.reduce((sum, id) => {
    const first = before[id] ?? after[id];
    return sum + Math.hypot(after[id].x - first.x, after[id].y - first.y);
  }, 0) / ids.length;
}
