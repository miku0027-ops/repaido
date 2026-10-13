export type Element = {
  id: string;
  label: string;
  kind: string;
  layer: string;
  evidence: string;
  status: string;
  file?: string;
  line?: number;
  module?: string;
  method?: string;
  route?: string;
  handler?: string;
  details?: Record<string, unknown>;
  functions?: { name: string; line: number; calls: string[] }[];
};
export type Link = {
  id: string;
  source: string;
  target: string;
  label: string;
  evidence: string;
  file?: string;
  line?: number;
};
export type Blueprint = {
  nodes: Element[];
  edges: Link[];
  revision: string;
  digest: string;
  project: string;
  generated_at: string;
  limitations: string[];
  notes: string[];
};
export type Event = {
  id: string;
  at: string;
  service: string;
  region: string;
  revision?: string;
  severity: string;
  method: string;
  route?: string;
  node_ids: string[];
  status?: number;
  latency?: string;
  trace_id?: string;
  kind: string;
};
export type Span = {
  id: string;
  parent_id?: string;
  start: string;
  end: string;
  name: string;
  kind: string;
};
export type Trace = { id: string; spans: Span[]; truncated: boolean };
export type Metric = {
  name: string;
  region: string;
  requests: number | null;
  server_errors: number | null;
  executions: number | null;
  function_errors: number | null;
  latest_at?: string;
  latency_series: { at: string; p95_ms: number; revision: string }[];
};
export type Collector = {
  state: string;
  collected_at: string | null;
  last_success_at: string | null;
  interval_seconds: number;
  error?: string;
  data: {
    nodes?: Element[];
    edges?: Link[];
    events?: Event[];
    traces?: Trace[];
    services?: Metric[];
    truncated?: boolean;
    note?: string;
    unresolved_references?: number;
  };
};
export type Snapshot = { at: string; collectors: Record<string, Collector> };
export type Config = {
  firebase: Record<string, string>;
  project: string;
  local_preview: boolean;
};
