import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {Activity,ArrowDownToLine,ArrowRight,Boxes,Cable,Check,ChevronRight,CircleHelp,Cloud,Code2,Database,Focus,GitBranch,Layers3,LockKeyhole,LogOut,Map,Maximize2,Network,Pause,Play,Search,Server,Settings2,ShieldCheck,X,Folder,Functions,Schedule,Queue,Devices} from '../../../web/src/icons';
import "@xyflow/react/dist/style.css";
import { read, follow } from "./api";
import {
  drawio,
  layout,
  mergeBlueprint,
  recentlyObserved,
  selectGraph,
} from "./graph.mjs";
import type {
  Blueprint,
  Config,
  Element,
  Link,
  Snapshot,
  Trace,
} from "./types";

const icons: Record<string, typeof Server> = {
  service: Server,
  endpoint: Cable,
  database: Database,
  collection: Folder,
  module: Code2,
  client: Devices,
  hosting: Cloud,
  network: Network,
  function: Functions,
  scheduler: Schedule,
  queue: Queue,
  config: Settings2,
};
const views = [
  { id: "overview", label: "System overview", icon: Map },
  { id: "application", label: "Application", icon: Code2 },
  { id: "infrastructure", label: "Infrastructure", icon: Cloud },
  { id: "combined", label: "Combined map", icon: Layers3 },
];
function time(value?: string | null) {
  return value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Not collected";
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function SystemNode({ data }: NodeProps) {
  const item = data as unknown as Element & { observed: boolean };
  const Icon = icons[item.kind] ?? Boxes;
  return (
    <div
      className={
        "system-node kind-" + item.kind + (item.observed ? " observed" : "")
      }
    >
      <Handle type="target" position={Position.Left} />
      <header>
        <span className="node-icon">
          <Icon size={20} />
        </span>
        <span>{item.kind}</span>
        <span className={"evidence evidence-" + item.evidence}>
          {item.evidence}
        </span>
      </header>
      <strong>{item.label}</strong>
      <footer>
        <i className={item.observed ? "signal" : ""} />
        {item.observed
          ? "Request observed · last 60s"
          : item.evidence === "cloud"
            ? item.status
            : "Defined in source"}
        <ChevronRight size={16} />
      </footer>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { system: SystemNode };

function Inspector({
  node,
  allNodes,
  edges,
  snapshot,
  close,
  focus,
}: {
  node: Element;
  allNodes: Element[];
  edges: Link[];
  snapshot?: Snapshot;
  close: () => void;
  focus: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState("details");
  const [source, setSource] = useState<{
    code: string;
    redaction: string;
    revision: string;
    truncated: boolean;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (tab !== "code") return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setSource(undefined);
    read<{
      code: string;
      redaction: string;
      revision: string;
      truncated: boolean;
    }>("source?node=" + encodeURIComponent(node.id), controller.signal)
      .then(setSource)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [tab, node.id]);
  const connections = edges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );
  const events =
    snapshot?.collectors.events?.data.events?.filter(
      (e) => e.node_ids.includes(node.id) || e.service === node.label,
    ) ?? [];
  return (
    <dialog
      ref={ref}
      className="inspector"
      aria-labelledby="element-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="inspector-inner">
        <header>
          <div>
            <span className="eyebrow">
              {node.kind} / {node.evidence} evidence
            </span>
            <h2 id="element-title">{node.label}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close element details"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <nav className="segment" aria-label="Element details">
          {["details", "connections", "code", "activity"].map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="inspector-body" tabIndex={0}>
          {tab === "details" && (
            <>
              <div className="callout">
                <ShieldCheck size={20} />
                <p>
                  {node.evidence === "cloud"
                    ? "Cloud inventory confirms this resource exists. Its configuration does not establish application health."
                    : "Extracted from repository source. Runtime execution and the deployed version are not verified by this connection."}
                </p>
              </div>
              <dl>
                <dt>Element ID</dt>
                <dd>{node.id}</dd>
                <dt>Source location</dt>
                <dd>
                  {node.file
                    ? `${node.file}:${node.line ?? 1}`
                    : "Cloud inventory"}
                </dd>
                {node.handler && (
                  <>
                    <dt>Handler</dt>
                    <dd>{node.handler}</dd>
                  </>
                )}
                {Object.entries(node.details ?? {})
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => (
                    <div className="detail-row" key={k}>
                      <dt>{k.replaceAll("_", " ")}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
              </dl>
              {node.functions && (
                <details>
                  <summary>Functions & calls ({node.functions.length})</summary>
                  <ul className="function-list">
                    {node.functions.map((f, i) => (
                      <li key={f.name + i}>
                        <strong>{f.name}</strong>
                        <span>Line {f.line}</span>
                        <p>{f.calls.join(" → ") || "No static calls"}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                className="primary"
                onClick={() => {
                  focus(node.id);
                  close();
                }}
              >
                <Focus size={16} /> Focus on this element
              </button>
            </>
          )}
          {tab === "connections" && (
            <>
              <p className="subtle">
                Arrows show direction. Evidence states how the connection was
                found.
              </p>
              {connections.length ? (
                connections.map((e) => (
                  <article className="connection" key={e.id}>
                    <span className={"evidence evidence-" + e.evidence}>
                      {e.evidence}
                    </span>
                    <strong>
                      {allNodes.find((n) => n.id === e.source)?.label}
                      <ArrowRight size={16} />
                      {allNodes.find((n) => n.id === e.target)?.label}
                    </strong>
                    <p>{e.label}</p>
                    {e.file && (
                      <small>
                        {e.file}:{e.line}
                      </small>
                    )}
                  </article>
                ))
              ) : (
                <p>
                  No verified or source-defined connections in this catalogue.
                </p>
              )}
            </>
          )}
          {tab === "code" && (
            <>
              {busy && <p role="status">Loading source excerpt…</p>}
              {error && <p role="alert">{error}</p>}
              {source && (
                <>
                  <p>{source.redaction}</p>
                  <p className="subtle">
                    Checkout revision {source.revision.slice(0, 12)}
                    {source.truncated && " · excerpt limited to 240 lines"}
                  </p>
                  <pre>{source.code}</pre>
                </>
              )}
            </>
          )}
          {tab === "activity" && (
            <>
              <p className="subtle">
                Observed log entries within 15 minutes. Missing activity does
                not mean the element is idle.
              </p>
              {events.length ? (
                events.map((e) => (
                  <article className="connection" key={e.id}>
                    <strong>
                      {e.method} {e.route ?? e.kind}
                    </strong>
                    <span>
                      {time(e.at)} · {e.status ?? e.severity} ·{" "}
                      {e.latency ?? "Duration unavailable"}
                    </span>
                    {e.trace_id && <small>Trace {e.trace_id}</small>}
                  </article>
                ))
              ) : (
                <div className="empty">
                  <Activity />
                  <h3>No activity available</h3>
                  <p>
                    {snapshot?.collectors.events?.error ??
                      "No matching request was returned in this observation window."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

function TraceView({ trace }: { trace: Trace }) {
  const starts = trace.spans
    .map((s) => Date.parse(s.start))
    .filter(Number.isFinite);
  const origin = Math.min(...starts);
  const max =
    Math.max(
      ...trace.spans.map((s) => Date.parse(s.end)).filter(Number.isFinite),
    ) - origin;
  return (
    <div className="trace-detail">
      <p>Trace {trace.id}</p>
      {trace.spans.map((s) => (
        <div className="span-row" key={s.id}>
          <span>
            {s.name}
            <small>
              {s.parent_id && s.parent_id !== "0"
                ? "Parent " + s.parent_id
                : "Root span"}
            </small>
          </span>
          <div className="span-track">
            <i
              style={{
                left: `${Math.max(0, ((Date.parse(s.start) - origin) / (max || 1)) * 100)}%`,
                width: `${Math.max(0.5, ((Date.parse(s.end) - Date.parse(s.start)) / (max || 1)) * 100)}%`,
              }}
            />
          </div>
          <span>{Math.max(0, Date.parse(s.end) - Date.parse(s.start))} ms</span>
        </div>
      ))}
      {trace.truncated && <p>Showing the first 200 spans.</p>}
    </div>
  );
}

function Workspace({ config, logout }: { config: Config; logout: () => void }) {
  const [blueprint, setBlueprint] = useState<Blueprint>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [view, setView] = useState("overview");
  const [level, setLevel] = useState("hld");
  const [query, setQuery] = useState("");
  const [module, setModule] = useState("");
  const [evidence, setEvidence] = useState("all");
  const [focus, setFocus] = useState("");
  const [selected, setSelected] = useState<Element>();
  const [running, setRunning] = useState(true);
  const [visible, setVisible] = useState(!document.hidden);
  const [pane, setPane] = useState("canvas");
  const [eventQuery, setEventQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [trace, setTrace] = useState<Trace>();
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const { fitView, getNodes } = useReactFlow();
  useEffect(() => {
    const fn = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    read<Blueprint>("blueprint", controller.signal)
      .then(setBlueprint)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!blueprint || !running || !visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const connect = async () => {
      try {
        await follow(controller.signal, (next) => {
          setSnapshot(next);
          setError("");
          failures = 0;
        });
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          failures++;
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(connect, Math.min(60000, 3000 * 2 ** failures));
    };
    connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [blueprint, running, visible]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  const graph = useMemo(
    () =>
      blueprint
        ? mergeBlueprint(blueprint, snapshot)
        : { nodes: [], edges: [] },
    [blueprint, snapshot],
  );
  const filtered = useMemo(
    () =>
      selectGraph(graph.nodes, graph.edges, {
        view,
        level,
        query,
        module,
        focus,
        evidence,
      }),
    [graph, view, level, query, module, focus, evidence],
  );
  const signature = filtered.nodes.map((n: Element) => n.id).join("|");
  useEffect(() => {
    let saved: Record<string, { x: number; y: number }> = {};
    try {
      saved = JSON.parse(
        localStorage.getItem("repaido-engineering-layout") || "{}",
      );
    } catch {
      /* Ignore obsolete layout only. */
    }
    setNodes(
      layout(filtered.nodes).map((n: Node) => ({
        ...n,
        position: saved[n.id] ?? n.position,
      })),
    );
    // Layout resets only when the visible topology changes, never for telemetry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => ({
        ...n,
        data: {
          ...(graph.nodes.find((item: Element) => item.id === n.id) ?? n.data),
          observed:
            running && visible && recentlyObserved(n.data, snapshot, clock),
        },
      })),
    );
  }, [snapshot, clock, running, visible, setNodes, graph]);
  const flowEdges = useMemo(
    () =>
      filtered.edges.map((e: Link) => ({
        ...e,
        type: "smoothstep",
        label: e.label,
        animated: false,
        style: {
          stroke:
            e.evidence === "cloud"
              ? "#096d63"
              : e.evidence === "inferred"
                ? "#896024"
                : "#7084a8",
          strokeWidth: 1.4,
          strokeDasharray: e.evidence === "source" ? "5 4" : undefined,
        },
        labelStyle: { fill: "#253956", fontSize: 10 },
        labelBgStyle: { fill: "#f8faff", fillOpacity: 0.97 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#7084a8" },
      })),
    [filtered.edges],
  );
  const modules = useMemo(
    () => blueprint?.nodes.filter((n) => n.kind === "module") ?? [],
    [blueprint],
  );
  const collectors = Object.entries(snapshot?.collectors ?? {});
  const connected = collectors.filter(
    ([, c]) => c.state === "connected",
  ).length;
  const events = snapshot?.collectors.events?.data.events ?? [];
  const metrics = snapshot?.collectors.metrics?.data.services ?? [];
  const traces = snapshot?.collectors.traces?.data.traces ?? [];
  const chooseView = (id: string) => {
    setView(id);
    setPane("canvas");
    setFocus("");
    setModule("");
    setQuery("");
  };
  const saveLayout = useCallback(() => {
    try {
      localStorage.setItem(
        "repaido-engineering-layout",
        JSON.stringify(
          Object.fromEntries(getNodes().map((n) => [n.id, n.position])),
        ),
      );
      setMessage("Layout saved on this device.");
    } catch {
      setMessage("This browser could not save the layout.");
    }
  }, [getNodes]);
  return (
    <div className="engineering-shell">
      <a href="#workspace" className="skip">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <div className="wordmark">
          repaido<span>ENGINEERING</span>
        </div>
        <div className="project-chip">
          <span className="project-icon">r.</span>
          <div>
            <strong>{config.project}</strong>
            <small>System workspace</small>
          </div>
          <LockKeyhole size={16} />
        </div>
        <p className="rail-label">BLUEPRINT</p>
        <nav aria-label="Architecture views">
          {views.map((v) => (
            <button
              key={v.id}
              className={view === v.id && pane === "canvas" ? "active" : ""}
              onClick={() => chooseView(v.id)}
            >
              <v.icon size={24} />
              {v.label}
            </button>
          ))}
        </nav>
        <p className="rail-label">OBSERVATIONS</p>
        <nav aria-label="Monitoring views">
          <button
            className={pane === "activity" ? "active" : ""}
            onClick={() => setPane("activity")}
          >
            <Activity size={20} /> API activity
          </button>
          <button
            className={pane === "traces" ? "active" : ""}
            onClick={() => setPane("traces")}
          >
            <GitBranch size={20} /> Event traces
          </button>
          <button
            className={pane === "coverage" ? "active" : ""}
            onClick={() => setPane("coverage")}
          >
            <ShieldCheck size={20} /> Data coverage
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="read-only">
            <ShieldCheck size={20} />
            <span>
              Read-only access<small>Production changes disabled</small>
            </span>
          </div>
          {!config.local_preview && (
            <button onClick={logout}>
              <LogOut size={16} /> Sign out
            </button>
          )}
        </div>
      </aside>
      <main id="workspace" className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">REPAIDO / ENGINEERING</span>
            <h1>
              {pane === "canvas"
                ? views.find((v) => v.id === view)?.label
                : pane === "activity"
                  ? "API activity"
                  : pane === "traces"
                    ? "Event traces"
                    : "Data coverage"}
            </h1>
          </div>
          <div className="top-actions">
            <span
              className={"connection-status " + (connected ? "connected" : "")}
            >
              <i />
              {!running
                ? "Updates paused"
                : !snapshot
                  ? "Connecting collectors"
                  : connected === 4
                    ? "Collectors connected"
                    : connected
                      ? `${connected}/4 collectors connected`
                      : "Live data disconnected"}
            </span>
            <button
              className="icon-button"
              onClick={() => setRunning((v) => !v)}
              aria-label={
                running ? "Pause live updates" : "Resume live updates"
              }
            >
              {running ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              onClick={() => {
                download(
                  "repaido-blueprint.json",
                  JSON.stringify(
                    {
                      revision: blueprint?.revision,
                      exported_at: new Date().toISOString(),
                      nodes: graph.nodes,
                      edges: graph.edges,
                      collectors: snapshot?.collectors,
                    },
                    null,
                    2,
                  ),
                  "application/json",
                );
                setMessage("Blueprint exported with evidence and timestamps.");
              }}
              disabled={!blueprint}
            >
              <ArrowDownToLine size={16} /> Export JSON
            </button>
          </div>
        </header>
        {config.local_preview && (
          <div className="preview-bar">
            <LockKeyhole size={16} /> Local preview · source data from this
            checkout · engineering sign-in required in production
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => location.reload()}>Retry connection</button>
            {!config.local_preview && (
              <button onClick={logout}>Use another account</button>
            )}
          </div>
        )}
        <section className="summary-strip" aria-label="Coverage summary">
          <div>
            <span>Repository elements</span>
            <strong>
              {blueprint?.nodes.length.toLocaleString() ?? "—"}
              <small>Source-defined</small>
            </strong>
          </div>
          <div>
            <span>Cloud resources</span>
            <strong>
              {snapshot?.collectors.inventory?.data.nodes?.length ?? "—"}
              <small>
                {snapshot?.collectors.inventory?.state ?? "Awaiting collection"}
              </small>
            </strong>
          </div>
          <div>
            <span>Observed requests · 5m</span>
            <strong>
              {metrics.some((m) => m.requests !== null)
                ? metrics
                    .reduce((n, m) => n + (m.requests ?? 0), 0)
                    .toLocaleString()
                : "—"}
              <small>Sampled cloud metrics</small>
            </strong>
          </div>
          <div>
            <span>Source revision</span>
            <strong className="revision">
              {blueprint?.revision.slice(0, 8) ?? "—"}
              <small>Deployment not verified</small>
            </strong>
          </div>
        </section>
        {pane === "canvas" && (
          <>
            <div className="canvas-toolbar">
              <div className="segment" aria-label="Detail level">
                <button
                  aria-pressed={level === "hld"}
                  onClick={() => setLevel("hld")}
                >
                  HLD
                </button>
                <button
                  aria-pressed={level === "lld"}
                  onClick={() => setLevel("lld")}
                >
                  LLD
                </button>
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Find a service, API or collection"
                  placeholder="Find service, API, collection…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setFocus("");
                  }}
                />
              </label>
              <label className="select-label">
                <span className="sr-only">Module</span>
                <select
                  value={module}
                  onChange={(e) => {
                    setModule(e.target.value);
                    setFocus("");
                  }}
                >
                  <option value="">All modules</option>
                  {modules.map((n) => (
                    <option key={n.id} value={n.module}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Evidence filter</span>
                <select
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                >
                  <option value="all">All evidence</option>
                  <option value="source">Source only</option>
                  <option value="cloud">Cloud only</option>
                  <option value="inferred">Inferred only</option>
                </select>
              </label>
              <button
                className="icon-button"
                aria-label="Fit blueprint to screen"
                onClick={() => fitView({ padding: 0.12 })}
              >
                <Maximize2 size={20} />
              </button>
              <button onClick={saveLayout}>Save layout</button>
              <button
                title="Open this diagram in draw.io"
                onClick={() => {
                  download(
                    "repaido-blueprint.drawio",
                    drawio(getNodes(), filtered.edges),
                    "application/xml",
                  );
                  setMessage("draw.io diagram exported.");
                }}
              >
                <ArrowDownToLine size={16} />
                <span className="sr-only">Export draw.io</span>
              </button>
            </div>
            <div className="canvas-meta">
              <span>
                {level === "hld" ? "High-level design" : "Low-level design"} ·{" "}
                {filtered.nodes.length} of {filtered.total} matching elements
              </span>
              {focus && (
                <button onClick={() => setFocus("")}>
                  Clear focus <X size={16} />
                </button>
              )}
              {filtered.total > filtered.nodes.length && (
                <span>Filter by module or search to reveal more elements.</span>
              )}
              <span className="legend">
                <i className="dashed" /> Source <i className="solid" /> Cloud{" "}
                <i className="inferred" /> Inferred
              </span>
            </div>
            <div
              className="canvas"
              aria-label="Interactive system architecture"
            >
              <ReactFlow
                nodes={nodes}
                edges={flowEdges as Edge[]}
                onNodesChange={onNodesChange}
                nodeTypes={nodeTypes}
                onNodeClick={(_, n) =>
                  setSelected(graph.nodes.find((v: Element) => v.id === n.id))
                }
                minZoom={0.08}
                maxZoom={2.5}
                fitView
                fitViewOptions={{ padding: 0.13 }}
                nodesConnectable={false}
                deleteKeyCode={null}
                onlyRenderVisibleElements
                proOptions={{ hideAttribution: false }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={24}
                  size={1}
                  color="#c2cfdf"
                />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) =>
                    n.data.evidence === "cloud" ? "#0e756c" : "#284988"
                  }
                  maskColor="rgba(222,230,242,.7)"
                />
              </ReactFlow>
              {!filtered.nodes.length && (
                <div className="canvas-empty">
                  <Network size={24} />
                  <h2>
                    {blueprint
                      ? "No elements in this view"
                      : "Reading the system blueprint…"}
                  </h2>
                  <p>
                    {blueprint
                      ? "Try a different filter or open Data coverage to check the cloud connection."
                      : "Extracting source relationships and checking access."}
                  </p>
                </div>
              )}
              <div className="canvas-note">
                <CircleHelp size={16} /> Drag to arrange · scroll to zoom ·
                select an element to inspect
              </div>
            </div>
            <FitCanvas signature={signature} />
          </>
        )}
        {pane === "coverage" && (
          <section className="data-page" tabIndex={0}>
            <div className="page-intro">
              <h2>Know what this map can see.</h2>
              <p>
                Each source has its own collection time and limits. Unavailable
                data stays unknown.
              </p>
            </div>
            <div className="coverage-grid">
              {["inventory", "metrics", "events", "traces"].map((name) => {
                const c = snapshot?.collectors[name];
                return (
                  <article className="coverage-card" key={name}>
                    <header>
                      <h3>{name}</h3>
                      <span
                        className={
                          "evidence " +
                          (c?.state === "connected" ? "evidence-cloud" : "")
                        }
                      >
                        {c?.state ?? "connecting"}
                      </span>
                    </header>
                    <dl>
                      <dt>Collection interval</dt>
                      <dd>{c ? c.interval_seconds + " seconds" : "—"}</dd>
                      <dt>Last successful collection</dt>
                      <dd>{time(c?.last_success_at)}</dd>
                    </dl>
                    <p>
                      {c?.error ??
                        c?.data.note ??
                        "Read-only resource inventory from Cloud Asset Inventory."}
                    </p>
                    {c?.data.truncated && (
                      <p className="error">
                        Result limit reached. This is a partial view.
                      </p>
                    )}
                    {name === "inventory" && (
                      <p>
                        Unresolved references:{" "}
                        {c?.data.unresolved_references ?? "unknown"}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
            <article className="coverage-card">
              <h3>Source and runtime are separate evidence</h3>
              <ul>
                {blueprint?.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                <li>
                  Network lines show declared resource references. Packet flow,
                  DNS resolution and firewall reachability need dedicated probes
                  or VPC Flow Logs.
                </li>
                <li>
                  Trace parent IDs identify recorded causality. Source imports
                  and API path literals do not establish an event firing in
                  production.
                </li>
                <li>
                  Cloud provider delays, logging exclusions and sampling can
                  hide activity. This console is not yet a replacement for alert
                  delivery, uptime probes or incident retention.
                </li>
              </ul>
            </article>
          </section>
        )}
        {pane === "activity" && (
          <section className="data-page" tabIndex={0}>
            <div className="activity-filters">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Filter observed activity"
                  placeholder="Filter service or route…"
                  value={eventQuery}
                  onChange={(e) => setEventQuery(e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={errorsOnly}
                  onChange={(e) => setErrorsOnly(e.target.checked)}
                />{" "}
                Errors only
              </label>
              <span>Latest 100 entries · 15-minute window</span>
            </div>
            {metrics.length > 0 && (
              <div className="metrics-grid">
                {metrics.map((m) => (
                  <article className="metric-card" key={m.name + m.region}>
                    <h3>{m.name}</h3>
                    <small>
                      {m.region} · {time(m.latest_at)}
                    </small>
                    <strong>
                      {m.requests ?? m.executions ?? "—"}{" "}
                      <span>observations / 5m</span>
                    </strong>
                    <p>
                      {(m.server_errors ?? 0) + (m.function_errors ?? 0)} server
                      / function errors
                    </p>
                  </article>
                ))}
              </div>
            )}
            {events.length ? (
              <div className="table-wrap" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Service / route</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events
                      .filter(
                        (e) =>
                          [e.service, e.route]
                            .join(" ")
                            .toLowerCase()
                            .includes(eventQuery.toLowerCase()) &&
                          (!errorsOnly ||
                            (e.status ?? 0) >= 500 ||
                            [
                              "ERROR",
                              "CRITICAL",
                              "ALERT",
                              "EMERGENCY",
                            ].includes(e.severity)),
                      )
                      .map((e) => (
                        <tr key={e.id}>
                          <td>{time(e.at)}</td>
                          <td>
                            <strong>{e.service}</strong>
                            <span>
                              {e.method} {e.route ?? e.kind}
                            </span>
                          </td>
                          <td>
                            <span
                              className={(e.status ?? 0) >= 500 ? "error" : ""}
                            >
                              {e.status ?? e.severity}
                            </span>
                          </td>
                          <td>{e.latency ?? "—"}</td>
                          <td>
                            {e.trace_id ? (
                              <button
                                onClick={() => {
                                  setTrace(
                                    traces.find((t) => t.id === e.trace_id),
                                  );
                                  setPane("traces");
                                }}
                              >
                                {e.trace_id.slice(0, 8)}
                                <ArrowRight size={16} />
                              </button>
                            ) : (
                              "Not recorded"
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <Activity size={24} />
                <h2>No observed activity available</h2>
                <p>
                  {snapshot?.collectors.events?.error ??
                    "There are no entries in the current observation window."}
                </p>
                <button onClick={() => setPane("coverage")}>
                  Check data coverage
                </button>
              </div>
            )}
          </section>
        )}
        {pane === "traces" && (
          <section className="data-page" tabIndex={0}>
            <div className="page-intro">
              <h2>Follow a recorded request.</h2>
              <p>
                Parent-child spans show the calls captured by tracing.
                Uninstrumented work remains unknown.
              </p>
            </div>
            {traces.length ? (
              <div className="trace-grid">
                <div className="trace-list">
                  {traces.map((t) => (
                    <button
                      key={t.id}
                      aria-pressed={trace?.id === t.id}
                      onClick={() => setTrace(t)}
                    >
                      <GitBranch size={16} />
                      <span>
                        {t.id.slice(0, 14)}
                        <small>{t.spans.length} spans</small>
                      </span>
                    </button>
                  ))}
                </div>
                {trace ? (
                  <TraceView trace={trace} />
                ) : (
                  <p>Select a trace to view its waterfall.</p>
                )}
              </div>
            ) : (
              <div className="empty">
                <GitBranch size={24} />
                <h2>No traces available</h2>
                <p>
                  {snapshot?.collectors.traces?.error ??
                    "Connect Cloud Trace and instrument service calls to see recorded request paths."}
                </p>
                <button onClick={() => setPane("coverage")}>
                  Check data coverage
                </button>
              </div>
            )}
          </section>
        )}
        <footer className="workspace-footer">
          <span>
            <i /> Source blueprint · {blueprint?.edges.length ?? 0} defined
            connections
          </span>
          <span>
            {running && visible ? "Following updates" : "Updates paused"} · Last
            response {time(snapshot?.at)}
          </span>
        </footer>
      </main>
      {selected && (
        <Inspector
          node={selected}
          allNodes={graph.nodes}
          edges={graph.edges}
          snapshot={snapshot}
          close={() => setSelected(undefined)}
          focus={setFocus}
        />
      )}
      <div className="toast" role="status">
        {message && (
          <>
            <Check size={16} />
            {message}
          </>
        )}
      </div>
    </div>
  );
}
function FitCanvas({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.13 }), 90);
    return () => clearTimeout(t);
  }, [signature, fitView]);
  return null;
}
export default function App(props: { config: Config; logout: () => void }) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  );
}
