export function fcoseOptions(settings, pinned, positions, callbacks = {}) {
  return {
    name: "fcose",
    quality: "default",
    randomize: false,
    animate: true,
    fit: false,
    padding: Math.max(10, settings.fcoseIdealEdgeLength / 4),
    nodeDimensionsIncludeLabels: false,
    nodeRepulsion: (node) => {
      const width = Number(node.data("width")) || 280;
      const height = Number(node.data("height")) || 120;
      return 4500 * settings.fcoseRepulsion * Math.sqrt(width * height / (280 * 120));
    },
    idealEdgeLength: (edge) => {
      const weight = Number(edge.data("weight")) || 1;
      return Math.max(30, settings.fcoseIdealEdgeLength / Math.sqrt(weight));
    },
    edgeElasticity: () => Math.max(0.01, 0.45 * settings.fcoseAttraction),
    gravity: Math.max(0, 0.25 * settings.fcoseGravity),
    numIter: Math.max(50, Math.round(settings.fcoseIterations)),
    tile: false,
    packComponents: false,
    fixedNodeConstraint: [...pinned]
      .filter((id) => positions[id])
      .sort()
      .map((nodeId) => ({ nodeId, position: { ...positions[nodeId] } })),
    ready: callbacks.ready,
    stop: callbacks.stop
  };
}
