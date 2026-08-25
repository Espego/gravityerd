import { normalizeWorkspace } from "./project-format.mjs";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function identifier(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function warning(code, message) {
  return { code, message };
}

function baseResult(section, candidate, summary, metrics, details, warnings, preservation) {
  return { section, candidate, summary, metrics, details, warnings, preservation };
}

function analyzeDomains(values, candidate, schema) {
  const tableIds = new Set(schema.tables.map((table) => table.id));
  const assignments = new Map();
  const warnings = [];
  let unknownCount = 0;
  let duplicateCount = 0;

  for (const [index, rawDomain] of values.entries()) {
    const domainId = identifier(rawDomain?.id, `domains[${index}]`);
    const rawIds = list(rawDomain?.tableIds).map(String);
    const duplicates = duplicateValues(rawIds);
    duplicateCount += duplicates.length;
    for (const tableId of duplicates) warnings.push(warning("duplicate-table-id", `${domainId} repeats table ${tableId}.`));
    for (const tableId of new Set(rawIds)) {
      if (!tableIds.has(tableId)) {
        unknownCount += 1;
        warnings.push(warning("unknown-table-id", `${domainId} references unknown table ${tableId}.`));
        continue;
      }
      const domains = assignments.get(tableId) ?? [];
      domains.push(domainId);
      assignments.set(tableId, domains);
    }
  }

  let multiDomainCount = 0;
  for (const [tableId, domains] of assignments) {
    if (domains.length < 2) continue;
    multiDomainCount += 1;
    warnings.push(warning("multiple-domains", `${tableId} appears in ${domains.join(", ")}; the first domain wins.`));
  }

  const ungrouped = candidate.domains.find((domain) => domain.id === "ungrouped");
  const details = candidate.domains.map((domain) => ({ label: domain.name, value: `${domain.tableIds.length} tables` }));
  const metrics = [
    { label: "Tables", value: schema.tables.length },
    { label: "Domains", value: candidate.domains.length },
    { label: "Ungrouped", value: ungrouped?.tableIds.length ?? 0 },
    { label: "Unknown IDs", value: unknownCount },
    { label: "Duplicate memberships", value: duplicateCount + multiDomainCount }
  ];
  return baseResult(
    "domains",
    candidate,
    `${schema.tables.length} tables across ${candidate.domains.length} domains; ${ungrouped?.tableIds.length ?? 0} remain Ungrouped.`,
    metrics,
    details,
    warnings,
    "Active view, positions, pins, and gravity settings will be preserved."
  );
}

function analyzeViews(values, candidate, schema, currentWorkspace) {
  const tableIds = new Set(schema.tables.map((table) => table.id));
  const warnings = [];
  let unknownCount = 0;
  let duplicateCount = 0;
  for (const [index, rawView] of values.entries()) {
    const viewId = identifier(rawView?.id, `views[${index}]`);
    if (viewId === "all") warnings.push(warning("built-in-view", "The supplied all view is ignored; All tables is generated from the schema."));
    const rawIds = list(rawView?.tableIds).map(String);
    const duplicates = duplicateValues(rawIds);
    duplicateCount += duplicates.length;
    for (const tableId of duplicates) warnings.push(warning("duplicate-table-id", `${viewId} repeats table ${tableId}.`));
    for (const tableId of new Set(rawIds)) {
      if (!tableIds.has(tableId)) {
        unknownCount += 1;
        warnings.push(warning("unknown-table-id", `${viewId} references unknown table ${tableId}.`));
      }
    }
  }
  const activeViewPreserved = candidate.views.some((view) => view.id === currentWorkspace.activeView);
  const details = candidate.views.map((view) => ({ label: view.name, value: `${view.tableIds.length} tables` }));
  const metrics = [
    { label: "Views", value: candidate.views.length },
    { label: "Unknown IDs", value: unknownCount },
    { label: "Duplicate IDs", value: duplicateCount },
    { label: "Active view preserved", value: activeViewPreserved ? "Yes" : "No" }
  ];
  return baseResult(
    "views",
    candidate,
    `${candidate.views.length} views will be available; ${activeViewPreserved ? "the active view remains selected" : "the active view falls back to All tables"}.`,
    metrics,
    details,
    warnings,
    activeViewPreserved
      ? "Active view, positions, pins, and gravity settings will be preserved."
      : "Positions, pins, and gravity settings will be preserved; active view will fall back to All tables."
  );
}

function analyzeEdgeGroups(values, candidate, schema) {
  const edgeIds = new Set(schema.foreignKeys.map((edge) => edge.id));
  const warnings = [];
  let unknownCount = 0;
  let duplicateExplicitCount = 0;
  let duplicateRuleCount = 0;

  for (const [index, rawGroup] of values.entries()) {
    const groupId = identifier(rawGroup?.id, `edgeGroups[${index}]`);
    const rawEdgeIds = list(rawGroup?.edgeIds).map(String);
    for (const edgeId of duplicateValues(rawEdgeIds)) {
      duplicateExplicitCount += 1;
      warnings.push(warning("duplicate-edge-id", `${groupId} repeats relationship ${edgeId}.`));
    }
    for (const edgeId of new Set(rawEdgeIds)) {
      if (!edgeIds.has(edgeId)) {
        unknownCount += 1;
        warnings.push(warning("unknown-edge-id", `${groupId} references unknown relationship ${edgeId}.`));
      }
    }
    const rawRules = list(rawGroup?.sourceColumns).map(String);
    for (const column of duplicateValues(rawRules)) {
      duplicateRuleCount += 1;
      warnings.push(warning("duplicate-source-column", `${groupId} repeats source-column rule ${column}.`));
    }
    if (groupId === "primary" && rawRules.length) {
      warnings.push(warning("ignored-primary-rule", "Source-column rules on primary are ignored; primary is the fallback group."));
    }
  }

  const assignments = new Map(candidate.edgeGroups.map((group) => [group.id, { total: 0, explicit: 0, rule: 0 }]));
  const ruleMatches = new Map();
  for (const group of candidate.edgeGroups.filter((item) => item.id !== "primary")) {
    for (const column of group.sourceColumns) ruleMatches.set(`${group.id}\0${column}`, 0);
  }

  let conflictCount = 0;
  for (const edge of schema.foreignKeys) {
    const explicit = candidate.edgeGroups.filter((group) => group.edgeIds.includes(edge.id));
    const matchingGroups = candidate.edgeGroups.filter((group) => group.id !== "primary"
      && group.sourceColumns.some((column) => edge.sourceColumns.includes(column)));
    for (const group of matchingGroups) {
      for (const column of group.sourceColumns.filter((item) => edge.sourceColumns.includes(item))) {
        const key = `${group.id}\0${column}`;
        ruleMatches.set(key, (ruleMatches.get(key) ?? 0) + 1);
      }
    }
    let winner;
    let mode;
    if (explicit.length) {
      winner = explicit[0];
      mode = "explicit";
      if (explicit.length > 1) {
        conflictCount += 1;
        warnings.push(warning("explicit-conflict", `${edge.id} is explicit in ${explicit.map((group) => group.id).join(", ")}; ${winner.id} wins.`));
      }
    } else {
      winner = matchingGroups[0] ?? candidate.edgeGroups.find((group) => group.id === "primary");
      mode = matchingGroups.length ? "rule" : "fallback";
      if (matchingGroups.length > 1) {
        conflictCount += 1;
        warnings.push(warning("rule-conflict", `${edge.id} matches rules in ${matchingGroups.map((group) => group.id).join(", ")}; ${winner.id} wins.`));
      }
    }
    const counts = assignments.get(winner.id);
    counts.total += 1;
    if (mode === "explicit") counts.explicit += 1;
    if (mode === "rule") counts.rule += 1;
  }

  for (const [key, count] of ruleMatches) {
    if (count) continue;
    const [groupId, column] = key.split("\0");
    warnings.push(warning("unused-source-column", `${groupId}.${column} matches no relationship.`));
  }

  const details = [];
  for (const group of candidate.edgeGroups) {
    const counts = assignments.get(group.id);
    details.push({ label: group.name, value: `${counts.total} relationships (${counts.explicit} explicit, ${counts.rule} by rule)` });
    for (const column of group.sourceColumns) {
      details.push({ label: `${group.name}.${column}`, value: `${ruleMatches.get(`${group.id}\0${column}`) ?? 0} raw matches` });
    }
  }
  const assignedTotal = [...assignments.values()].reduce((sum, counts) => sum + counts.total, 0);
  const metrics = [
    { label: "Relationships", value: schema.foreignKeys.length },
    { label: "Assigned after precedence", value: assignedTotal },
    { label: "Conflicts", value: conflictCount },
    { label: "Unknown IDs", value: unknownCount },
    { label: "Duplicate entries", value: duplicateExplicitCount + duplicateRuleCount }
  ];
  return baseResult(
    "edgeGroups",
    candidate,
    `${assignedTotal} relationships are assigned across ${candidate.edgeGroups.length} groups after precedence.`,
    metrics,
    details,
    warnings,
    "Active view, positions, pins, and gravity settings will be preserved. Secondary groups do not contribute to angular fan forces."
  );
}

export function analyzeConfiguration(section, values, currentWorkspace, schemaFingerprint, schema) {
  if (!Array.isArray(values)) throw new Error("Configuration must be a JSON array");
  if (!["domains", "views", "edgeGroups"].includes(section)) throw new Error(`Unknown configuration section ${section}`);
  const candidate = normalizeWorkspace({ ...currentWorkspace, [section]: values }, schemaFingerprint, schema);
  if (section === "domains") return analyzeDomains(values, candidate, schema);
  if (section === "views") return analyzeViews(values, candidate, schema, currentWorkspace);
  return analyzeEdgeGroups(values, candidate, schema);
}
