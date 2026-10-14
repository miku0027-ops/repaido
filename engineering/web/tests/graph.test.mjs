import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectGraph,
  layout,
  drawio,
  recentlyObserved,
  mergeBlueprint,
} from "../src/graph.mjs";

const nodes = [
  {
    id: "a",
    label: 'API <&" service',
    kind: "service",
    layer: "infrastructure",
    evidence: "source",
  },
  {
    id: "b",
    label: "Route",
    kind: "endpoint",
    layer: "application",
    evidence: "source",
  },
  {
    id: "c",
    label: "Data",
    kind: "collection",
    layer: "data",
    evidence: "inferred",
  },
];
const edges = [
  { id: "ab", source: "a", target: "b", label: "declares", evidence: "source" },
  { id: "bc", source: "b", target: "c", label: "reads", evidence: "inferred" },
];
const settings = {
  view: "combined",
  level: "lld",
  query: "",
  module: "",
  focus: "",
  evidence: "all",
};
test("HLD hides endpoint detail, LLD shows the source topology", () => {
  assert.equal(
    selectGraph(nodes, edges, { ...settings, level: "hld" }).nodes.length,
    1,
  );
  assert.equal(selectGraph(nodes, edges, settings).edges.length, 2);
});
test("search, evidence filters and focus keep only valid links", () => {
  assert.equal(
    selectGraph(nodes, edges, { ...settings, evidence: "inferred" }).edges
      .length,
    0,
  );
  assert.equal(
    selectGraph(nodes, edges, { ...settings, query: "route" }).nodes[0].id,
    "b",
  );
  assert.equal(
    selectGraph(nodes, edges, { ...settings, focus: "b", level: "hld" }).nodes
      .length,
    3,
  );
});
test("large diagrams retain a declared limit without dropping total count", () => {
  const large = Array.from({ length: 600 }, (_, i) => ({
    ...nodes[0],
    id: String(i),
  }));
  const selected = selectGraph(large, [], settings);
  assert.equal(selected.total, 600);
  assert.equal(selected.nodes.length, 180);
});
test("draw.io export uses arranged positions and escapes XML", () => {
  const placed = layout(nodes);
  placed[0].position.x = 123;
  const xml = drawio(placed, edges);
  assert.match(xml, /x="123"/);
  assert.match(xml, /&lt;&amp;&quot;/);
  assert.match(xml, /source="a" target="b"/);
  assert.doesNotMatch(xml, /API <&/);
});
test("motion requires recent observed traffic and stops on stale or missing data", () => {
  const now = Date.now();
  const snapshot = {
    collectors: {
      events: {
        state: "connected",
        collected_at: new Date(now).toISOString(),
        data: {
          events: [{ at: new Date(now - 1000).toISOString(), node_ids: ["b"] }],
        },
      },
    },
  };
  assert.equal(recentlyObserved(nodes[1], snapshot, now), true);
  assert.equal(recentlyObserved(nodes[0], snapshot, now), false);
  assert.equal(recentlyObserved(nodes[1], snapshot, now + 90000), false);
  snapshot.collectors.events.state = "stale";
  assert.equal(recentlyObserved(nodes[1], snapshot, now), false);
});
test("cloud inventory staleness is preserved when merged with source", () => {
  const merged = mergeBlueprint(
    { nodes, edges },
    {
      collectors: {
        inventory: {
          state: "stale",
          data: { nodes: [{ id: "cloud", evidence: "cloud" }] },
        },
      },
    },
  );
  assert.equal(merged.nodes.at(-1).status, "stale inventory");
  assert.equal(merged.nodes.length, 4);
});
test("HLD dependency folding remains inferred, never observed traffic", () => {
  const items = [
    { id: "api", kind: "service", evidence: "source" },
    { id: "impl", kind: "module", evidence: "source" },
    { id: "vendor", kind: "provider", evidence: "source" },
  ];
  const links = [
    { id: "one", source: "api", target: "impl" },
    { id: "two", source: "impl", target: "vendor" },
  ];
  const result = selectGraph(items, links, {
    ...settings,
    view: "overview",
    level: "hld",
  });
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].evidence, "inferred");
  assert.match(result.edges[0].label, /verify runtime/);
});
