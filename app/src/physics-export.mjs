import { activePhysicsEdges } from "./physics-core.mjs";

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function safeColor(value, fallback) {
  const candidate = String(value ?? "");
  return /^#[0-9a-f]{6}$/iu.test(candidate) ? candidate : fallback;
}

function safeTooltip(value) {
  return escapeXml(escapeHtml(value));
}

function safeNumber(value) {
  if (!Number.isFinite(value)) throw new Error("Layout contains a non-finite coordinate");
  return Math.round(value * 1000) / 1000;
}

function nodeValue(node) {
  const rows = node.columns.map((column) => {
    const marker = escapeHtml(column.markers.join("·"));
    return `<div style="font-family:monospace;font-size:11px;line-height:21px;white-space:nowrap"><span style="display:inline-block;width:42px;color:#52606d">${marker}</span>${escapeHtml(column.name)}${column.nullable ? "?" : ""} : ${escapeHtml(column.type)}</div>`;
  }).join("");
  return escapeXml(`<div style="font-size:16px;font-weight:700;padding:2px 0 7px 0">${escapeHtml(node.name)}</div>${rows}`);
}

function normalizeSnapshot(view, positions) {
  const minX = Math.min(...view.nodes.map((node) => positions[node.id].x - node.width / 2));
  const minY = Math.min(...view.nodes.map((node) => positions[node.id].y - node.height / 2));
  return Object.fromEntries(view.nodes.map((node) => [node.id, {
    x: safeNumber(positions[node.id].x + 60 - minX),
    y: safeNumber(positions[node.id].y + 110 - minY)
  }]));
}

function diagram(snapshot, data, index) {
  const view = data.views[snapshot.view];
  if (!view) throw new Error(`Unknown view ${snapshot.view}`);
  const positions = normalizeSnapshot(view, snapshot.positions);
  const edges = activePhysicsEdges(view, snapshot.settings);
  const pageWidth = Math.ceil(Math.max(1200, Math.max(...view.nodes.map((node) => positions[node.id].x + node.width / 2)) + 60) / 100) * 100;
  const pageHeight = Math.ceil(Math.max(900, Math.max(...view.nodes.map((node) => positions[node.id].y + node.height / 2)) + 60) / 100) * 100;
  const id = `gravityerd-${index}-${snapshot.view}`;
  const title = `${data.viewNames[snapshot.view]} · seed ${snapshot.seed}`;
  const titleValue = escapeXml(`<b>${escapeHtml(title)}</b><br><font color="#52606d">Schema SHA-256 ${escapeHtml(data.schemaFingerprint.slice(0, 16))}</font>`);
  const nodes = view.nodes.map((node) => {
    const position = positions[node.id];
    const style = `rounded=1;arcSize=5;whiteSpace=wrap;html=1;fillColor=${safeColor(node.fillColor, "#E7EEF2")};strokeColor=${safeColor(node.strokeColor, "#687B88")};fontColor=#1F2937;align=left;verticalAlign=top;spacing=10;shadow=0;`;
    return `<mxCell id="${escapeXml(`${id}:node:${node.id}`)}" parent="${escapeXml(`${id}:1`)}" vertex="1" value="${nodeValue(node)}" tooltip="${safeTooltip(node.constraints.join("\n"))}" style="${escapeXml(style)}"><mxGeometry x="${safeNumber(position.x - node.width / 2)}" y="${safeNumber(position.y - node.height / 2)}" width="${node.width}" height="${node.height}" as="geometry"/></mxCell>`;
  }).join("");
  const edgeCells = edges.map((edge) => {
    const optionalStart = edge.cardinality.nullable ? "startArrow=oval;startFill=0;startSize=8;" : "startArrow=none;";
    const style = `edgeStyle=none;rounded=0;html=1;strokeWidth=1.7;strokeColor=${safeColor(edge.color, "#52606D")};${optionalStart}endArrow=block;endFill=1;endSize=10;`;
    return `<mxCell id="${escapeXml(`${id}:${edge.id}`)}" parent="${escapeXml(`${id}:1`)}" edge="1" source="${escapeXml(`${id}:node:${edge.source}`)}" target="${escapeXml(`${id}:node:${edge.target}`)}" value="" tooltip="${safeTooltip(edge.definitions.join("\n"))}" style="${escapeXml(style)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  }).join("");
  return `<diagram id="${escapeXml(id)}" name="${escapeXml(title)}"><mxGraphModel dx="${pageWidth}" dy="${pageHeight}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0"><root><mxCell id="${escapeXml(`${id}:0`)}"/><mxCell id="${escapeXml(`${id}:1`)}" parent="${escapeXml(`${id}:0`)}"/><mxCell id="${escapeXml(`${id}:title`)}" parent="${escapeXml(`${id}:1`)}" vertex="1" value="${titleValue}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=none;fontSize=20;align=left;verticalAlign=middle;"><mxGeometry x="50" y="20" width="${pageWidth - 100}" height="58" as="geometry"/></mxCell>${nodes}${edgeCells}</root></mxGraphModel></diagram>`;
}

export function createDrawioExport(data, snapshots) {
  if (!snapshots.length) throw new Error("No computed layout is available for export");
  const pages = snapshots.slice().sort((first, second) => first.view.localeCompare(second.view)).map((snapshot, index) => diagram(snapshot, data, index));
  return `<mxfile host="app.diagrams.net" agent="GravityERD" type="device" compressed="false" pages="${pages.length}" data-schema-fingerprint="${data.schemaFingerprint}">${pages.join("")}</mxfile>\n`;
}
