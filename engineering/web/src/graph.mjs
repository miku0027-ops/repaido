export const MAX_CANVAS_NODES = 180;

export function selectGraph(
  nodes,
  edges,
  { view, level, query, module, focus, evidence },
) {
  let eligible = nodes.filter(
    (n) =>
      (view === "combined" ||
        view === "overview" ||
        n.layer === view ||
        (view === "application" && n.layer === "data")) &&
      (evidence === "all" || n.evidence === evidence) &&
      (level === "lld" ||
        !["endpoint", "collection", "code-function"].includes(n.kind)) &&
      (!module || n.module === module || n.id === "module:" + module) &&
      (!query ||
        [n.label, n.id, n.kind, n.file]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  if (view === "overview" && !query && !module && !focus)
    eligible = eligible.filter(
      (n) =>
        ![
          "endpoint",
          "collection",
          "module",
          "code-function",
          "network",
        ].includes(n.kind),
    );
  if (focus) {
    const neighbours = new Set([focus]);
    edges
      .filter((e) => e.source === focus || e.target === focus)
      .forEach((e) => {
        neighbours.add(e.source);
        neighbours.add(e.target);
      });
    eligible = nodes.filter((n) => neighbours.has(n.id));
  }
  const total = eligible.length;
  eligible = eligible.slice(0, MAX_CANVAS_NODES);
  const ids = new Set(eligible.map((n) => n.id));
  const displayed = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  // Fold source dependencies through hidden code elements in HLD only. These
  // inferred summaries are never shown as observed service-to-service traffic.
  if (level === "hld" && !query && !module && !focus) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = new Map();
    for (const edge of edges) {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      outgoing.get(edge.source).push(edge);
    }
    for (const origin of eligible.filter((n) =>
      ["service", "module", "client"].includes(n.kind),
    )) {
      const queue = [{ id: origin.id, distance: 0 }],
        visited = new Set([origin.id]);
      while (queue.length) {
        const current = queue.shift();
        if (current.distance >= 8) continue;
        for (const edge of outgoing.get(current.id) ?? []) {
          if (visited.has(edge.target)) continue;
          visited.add(edge.target);
          if (ids.has(edge.target)) {
            if (current.distance > 0)
              displayed.push({
                id: `summary:${origin.id}:${edge.target}`,
                source: origin.id,
                target: edge.target,
                label: "Source dependency · verify runtime",
                evidence: "inferred",
              });
          } else if (
            ["module", "endpoint", "code-function"].includes(
              byId.get(edge.target)?.kind,
            )
          ) {
            queue.push({ id: edge.target, distance: current.distance + 1 });
          }
        }
      }
    }
  }
  return { nodes: eligible, edges: displayed, total };
}

const ranks = {
  client: 0,
  hosting: 1,
  config: 1,
  network: 2,
  resource: 2,
  service: 2,
  scheduler: 2,
  provider: 3,
  function: 3,
  module: 3,
  endpoint: 4,
  "code-function": 5,
  queue: 6,
  storage: 6,
  database: 6,
  collection: 6,
};
export function layout(nodes) {
  const counts = {};
  return nodes.map((n) => {
    const rank = ranks[n.kind] ?? 4;
    const row = counts[rank] ?? 0;
    counts[rank] = row + 1;
    return {
      id: n.id,
      type: "system",
      data: n,
      position: { x: rank * 315, y: row * 158 },
    };
  });
}

export function mergeBlueprint(blueprint, snapshot) {
  const inventory = snapshot?.collectors?.inventory;
  return {
    nodes: [
      ...blueprint.nodes,
      ...(inventory?.data?.nodes ?? []).map((n) => ({
        ...n,
        status: inventory.state === "stale" ? "stale inventory" : n.status,
      })),
    ],
    edges: [...blueprint.edges, ...(inventory?.data?.edges ?? [])],
  };
}

export function recentlyObserved(node, snapshot, now = Date.now()) {
  const collector = snapshot?.collectors?.events;
  if (
    collector?.state !== "connected" ||
    now - Date.parse(collector.collected_at) > 45000
  )
    return false;
  return (collector.data.events ?? []).some(
    (e) =>
      now - Date.parse(e.at) <= 60000 &&
      now >= Date.parse(e.at) &&
      (node.kind === "endpoint"
        ? e.node_ids?.includes(node.id)
        : node.kind === "service" &&
          node.evidence === "cloud" &&
          e.service === node.label),
  );
}

function escapeXml(s) {
  return String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}
export function drawio(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const boxes = nodes
    .map(
      (n) =>
        `<mxCell id="${escapeXml(n.id)}" value="${escapeXml(n.data.label + "\n" + n.data.evidence)}" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#eef3ff;fontColor=#101c35;strokeColor=#617393;" vertex="1" parent="1"><mxGeometry x="${n.position.x}" y="${n.position.y}" width="260" height="100" as="geometry"/></mxCell>`,
    )
    .join("");
  const links = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map(
      (e) =>
        `<mxCell id="edge-${escapeXml(e.id)}" value="${escapeXml(e.label)}" style="edgeStyle=orthogonalEdgeStyle;html=0;endArrow=block;" edge="1" parent="1" source="${escapeXml(e.source)}" target="${escapeXml(e.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    )
    .join("");
  return `<mxfile host="Repaido Engineering"><diagram name="System blueprint"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${boxes}${links}</root></mxGraphModel></diagram></mxfile>`;
}
