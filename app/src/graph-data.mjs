function safeColor(value, fallback) {
  const candidate = String(value ?? "");
  return /^#[0-9a-f]{6}$/iu.test(candidate) ? candidate : fallback;
}

function markerSets(schema, table) {
  const primary = new Set(table.constraints.filter((item) => item.type === "primary_key").flatMap((item) => item.columns));
  const unique = new Set(table.constraints.filter((item) => item.type === "unique" && item.columns.length === 1).flatMap((item) => item.columns));
  const foreign = new Set(schema.foreignKeys.filter((item) => item.sourceTable === table.id).flatMap((item) => item.sourceColumns));
  return { primary, unique, foreign };
}

function nodeDimensions(table) {
  const longest = Math.max(table.name.length + 8, ...table.columns.map((column) => column.name.length + column.type.length + 15));
  return { width: Math.max(240, Math.min(520, Math.ceil(longest * 7 + 34))), height: 54 + table.columns.length * 18 };
}

function domainMap(workspace) {
  const result = new Map();
  for (const domain of workspace.domains) for (const id of domain.tableIds) result.set(id, domain);
  return result;
}

function groupForEdge(workspace, edge) {
  const explicit = workspace.edgeGroups.find((group) => group.edgeIds.includes(edge.id));
  if (explicit) return explicit;
  const rule = workspace.edgeGroups.find((group) => group.id !== "primary" && group.sourceColumns.some((column) => edge.sourceColumns.includes(column)));
  return rule ?? workspace.edgeGroups.find((group) => group.id === "primary");
}

function cardinality(table, edge) {
  const sorted = [...edge.sourceColumns].sort();
  const unique = table.constraints.some((constraint) => ["primary_key", "unique"].includes(constraint.type)
    && JSON.stringify([...constraint.columns].sort()) === JSON.stringify(sorted));
  const columnMap = new Map(table.columns.map((column) => [column.name, column]));
  const optional = edge.sourceColumns.some((column) => columnMap.get(column)?.nullable);
  return { source: unique ? "1" : "N", target: optional ? "0..1" : "1", nullable: optional };
}

function viewData(schema, workspace, tableIds) {
  const selected = new Set(tableIds);
  const domains = domainMap(workspace);
  const nodes = schema.tables.filter((table) => selected.has(table.id)).map((table) => {
    const markers = markerSets(schema, table);
    const dimensions = nodeDimensions(table);
    const domain = domains.get(table.id) ?? workspace.domains[0];
    return {
      id: table.id,
      name: table.name,
      ...dimensions,
      domain: domain.id,
      fillColor: safeColor(domain.color, "#E7EEF2"),
      strokeColor: safeColor(domain.stroke, "#687B88"),
      columns: table.columns.map((column) => ({
        ...column,
        markers: [
          ...(markers.primary.has(column.name) ? ["PK"] : []),
          ...(markers.foreign.has(column.name) ? ["FK"] : []),
          ...(markers.unique.has(column.name) ? ["UQ"] : [])
        ]
      })),
      constraints: table.constraints.map((constraint) => constraint.definition)
    };
  });
  const tableMap = new Map(schema.tables.map((table) => [table.id, table]));
  const edges = [];
  for (const foreignKey of schema.foreignKeys) {
    if (!selected.has(foreignKey.sourceTable) || !selected.has(foreignKey.targetTable)) continue;
    const group = groupForEdge(workspace, foreignKey);
    edges.push({
      id: foreignKey.id,
      source: foreignKey.sourceTable,
      target: foreignKey.targetTable,
      secondary: group.secondary,
      visible: group.visible,
      groupId: group.id,
      color: safeColor(group.color, "#52606D"),
      groupWeight: group.weight,
      physicalCount: 1,
      columns: [...foreignKey.sourceColumns],
      foreignKeyIds: [foreignKey.id],
      definitions: [foreignKey.definition || foreignKey.name],
      cardinality: cardinality(tableMap.get(foreignKey.sourceTable), foreignKey)
    });
  }
  edges.sort((first, second) => first.id.localeCompare(second.id));
  const groups = Object.fromEntries(workspace.domains.map((domain) => [domain.id, domain.tableIds.filter((id) => selected.has(id))]));
  return { nodes, edges, groups };
}

export function buildGraphData(schema, workspace) {
  return {
    schemaFingerprint: workspace.schemaFingerprint,
    engine: schema.engine,
    namespace: schema.namespace,
    physicalForeignKeyCount: schema.foreignKeys.length,
    views: Object.fromEntries(workspace.views.map((view) => [view.id, viewData(schema, workspace, view.tableIds)])),
    viewNames: Object.fromEntries(workspace.views.map((view) => [view.id, view.name]))
  };
}
