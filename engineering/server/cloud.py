"""Bounded, read-only GCP collectors. Credentials never leave this process.

Never forward raw log payloads, environment values, secret resources, database
documents, request bodies or headers to the console. Availability is independent
per collector; permission failures are visible, never replaced with sample data.
"""
import hashlib
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlsplit

import google.auth
from google.auth.transport.requests import AuthorizedSession


ASSET_TYPES = [
    'run.googleapis.com/Service', 'cloudfunctions.googleapis.com/CloudFunction',
    'compute.googleapis.com/Network', 'compute.googleapis.com/Subnetwork',
    'compute.googleapis.com/Firewall', 'compute.googleapis.com/ForwardingRule',
    'compute.googleapis.com/GlobalForwardingRule', 'compute.googleapis.com/BackendService',
    'compute.googleapis.com/UrlMap', 'compute.googleapis.com/NetworkEndpointGroup',
    'compute.googleapis.com/Instance', 'compute.googleapis.com/SecurityPolicy',
    'sqladmin.googleapis.com/Instance', 'firestore.googleapis.com/Database',
    'pubsub.googleapis.com/Topic', 'pubsub.googleapis.com/Subscription',
    'storage.googleapis.com/Bucket', 'cloudscheduler.googleapis.com/Job',
    'vpcaccess.googleapis.com/Connector', 'dns.googleapis.com/ManagedZone',
]


def stamp(value=None):
    return datetime.fromtimestamp(value or time.time(), timezone.utc).isoformat()


class CloudError(Exception):
    pass


class GoogleTransport:
    def __init__(self):
        self.local = threading.local()

    def request(self, api, path, params=None, body=None):
        if api not in {'cloudasset', 'monitoring', 'logging', 'cloudtrace'}:
            raise CloudError('Collector destination is not permitted.')
        if not getattr(self.local, 'session', None):
            try:
                # Asset Inventory and Trace do not accept cloud-platform.read-only.
                # IAM on the dedicated identity restricts this scope to reads.
                credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
                self.local.session = AuthorizedSession(credentials)
            except Exception:
                raise CloudError('No usable application default credentials. Connect a read-only GCP identity.') from None
        try:
            result = self.local.session.request('POST' if body is not None else 'GET',
                f'https://{api}.googleapis.com/{path}', params=params, json=body, timeout=12)
            if result.status_code != 200:
                raise CloudError(f'{api} returned HTTP {result.status_code}. Check API availability and read permissions.')
            return result.json()
        except CloudError:
            raise
        except Exception:
            raise CloudError(f'{api} could not be reached within the collection deadline.') from None


class Cache:
    """One request per collector/interval/process, including failure cooldown."""
    def __init__(self):
        self.lock = threading.Lock()
        self.locks = {}
        self.items = {}

    def get(self, key, ttl, collect):
        with self.lock:
            key_lock = self.locks.setdefault(key, threading.Lock())
        with key_lock:
            old = self.items.get(key)
            if old and time.monotonic() - old['attempt'] < ttl:
                return old['value']
            now = stamp()
            try:
                data = collect()
                result = {'state': 'connected', 'collected_at': now, 'last_success_at': now,
                    'interval_seconds': ttl, 'data': data}
            except Exception as error:
                previous = old['value'] if old else {}
                result = {'state': 'stale' if previous.get('last_success_at') else 'unavailable',
                    'collected_at': now, 'last_success_at': previous.get('last_success_at'),
                    'interval_seconds': ttl, 'error': str(error) if isinstance(error, CloudError) else 'The collector could not parse the provider response.', 'data': previous.get('data', {})}
            self.items[key] = {'attempt': time.monotonic(), 'value': result}
            return result


def resource_kind(asset_type):
    return ('service' if asset_type.startswith('run.') else
        'function' if asset_type.startswith('cloudfunctions.') else
        'database' if asset_type.startswith(('firestore.', 'sqladmin.')) else
        'storage' if asset_type.startswith('storage.') else
        'queue' if asset_type.startswith('pubsub.') else
        'scheduler' if asset_type.startswith('cloudscheduler.') else 'network')


def normalize_asset(asset):
    name = asset.get('name', '')
    data = asset.get('resource', {}).get('data', {})
    asset_type = asset.get('assetType', '')
    label = name.rsplit('/', 1)[-1]
    conditions = data.get('status', {}).get('conditions', data.get('conditions', []))
    # Ready is a control-plane property, not proof of an end-to-end healthy app.
    ready = next((row.get('status', row.get('state')) for row in conditions
        if row.get('type') == 'Ready'), None)
    details = {'asset_type': asset_type, 'resource_name': name,
        'location': asset.get('resource', {}).get('location', 'unknown'),
        'updated_at': asset.get('updateTime'), 'control_plane_ready': ready,
        'latest_ready_revision': data.get('status', {}).get('latestReadyRevisionName') or data.get('latestReadyRevision')}
    node = {'id': 'asset:' + name, 'label': label, 'kind': resource_kind(asset_type),
        'layer': 'infrastructure', 'evidence': 'cloud', 'status': 'configuration observed',
        'details': details}
    references = []
    # Follow only explicit infrastructure reference keys; never environment,
    # metadata or free-text configuration. Relationship does not imply traffic.
    reference_keys = {'network', 'subnetwork', 'topic', 'deadLetterTopic', 'target',
        'urlMap', 'securityPolicy', 'service', 'group', 'connector', 'backendService', 'defaultService'}
    def visit(obj, parent=''):
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key in {'env', 'environmentVariables', 'secretEnvironmentVariables', 'metadata', 'labels', 'headers', 'body'}:
                    continue
                if key in reference_keys and isinstance(value, str) and ('projects/' in value or value.startswith('//')):
                    references.append((key, value))
                elif isinstance(value, (dict, list)):
                    visit(value, key)
        elif isinstance(obj, list):
            for value in obj:
                visit(value, parent)
    visit(data)
    return node, references


def resource_tail(value):
    return value[value.index('projects/'):] if 'projects/' in value else value


class Cloud:
    def __init__(self, project, catalog, enabled=False, transport=None):
        if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', project):
            raise ValueError('Invalid engineering GCP project ID.')
        self.project = project
        self.catalog = catalog
        self.enabled = enabled
        self.transport = transport or GoogleTransport()
        self.cache = Cache()
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix='engineering-collector')
        self.routes = []
        for node in catalog.nodes.values():
            if node['kind'] == 'endpoint':
                parts = re.split(r'(\{[^}]+\})', node['route'])
                pattern = '^' + ''.join('[^/]+' if p.startswith('{') else re.escape(p) for p in parts) + '$'
                self.routes.append((re.compile(pattern), node['method'], node['route'], node['id']))

    def inventory(self):
        assets = []
        token = None
        for _ in range(5):
            params = {'contentType': 'RESOURCE', 'assetTypes': ASSET_TYPES, 'pageSize': 200}
            if token:
                params['pageToken'] = token
            result = self.transport.request('cloudasset', f'v1/projects/{self.project}/assets', params=params)
            assets.extend(result.get('assets', []))
            token = result.get('nextPageToken')
            if not token:
                break
        nodes, pending, edges = [], [], []
        for asset in assets:
            node, refs = normalize_asset(asset)
            nodes.append(node)
            pending.extend((node['id'], key, value) for key, value in refs)
        lookup = {resource_tail(n['details']['resource_name']): n['id'] for n in nodes}
        for source, label, target in pending:
            target_id = lookup.get(resource_tail(target))
            if target_id:
                edges.append({'id': hashlib.sha256(f'{source}|{target_id}|{label}'.encode()).hexdigest()[:20],
                    'source': source, 'target': target_id, 'label': label, 'evidence': 'cloud'})
        for node in nodes:
            source_id = 'service:' + node['label']
            if node['kind'] == 'service' and source_id in self.catalog.nodes:
                edges.append({'id': 'mapping:' + node['id'], 'source': source_id, 'target': node['id'],
                    'label': 'same service name · source revision unverified', 'evidence': 'inferred'})
        return {'nodes': nodes, 'edges': edges, 'truncated': bool(token), 'limit': 1000,
            'asset_types': ASSET_TYPES, 'unresolved_references': len(pending) - (len(edges) - sum(e['evidence'] == 'inferred' for e in edges))}

    def metrics(self):
        end = time.time()
        services = {}
        truncated = False
        for metric, aligner, field in [
            ('run.googleapis.com/request_count', 'ALIGN_SUM', 'requests'),
            ('run.googleapis.com/request_latencies', 'ALIGN_PERCENTILE_95', 'latency'),
            ('cloudfunctions.googleapis.com/function/execution_count', 'ALIGN_SUM', 'executions')]:
            response = self.transport.request('monitoring', f'v3/projects/{self.project}/timeSeries', params={
                'filter': f'metric.type="{metric}"', 'interval.startTime': stamp(end - 300),
                'interval.endTime': stamp(end), 'aggregation.alignmentPeriod': '60s',
                'aggregation.perSeriesAligner': aligner, 'view': 'FULL', 'pageSize': 200})
            truncated |= bool(response.get('nextPageToken'))
            for series in response.get('timeSeries', []):
                resource = series.get('resource', {})
                labels = resource.get('labels', {})
                name = labels.get('service_name') or labels.get('function_name') or 'unknown'
                region = labels.get('location') or labels.get('region', 'unknown')
                key = name + '@' + region
                row = services.setdefault(key, {'name': name, 'region': region,
                    'resource_type': resource.get('type'), 'requests': None, 'server_errors': None,
                    'executions': None, 'function_errors': None, 'latency_series': [], 'latest_at': None})
                metric_labels = series.get('metric', {}).get('labels', {})
                for point in series.get('points', []):
                    value = point.get('value', {})
                    count = float(value.get('int64Value', value.get('doubleValue', 0)))
                    at = point.get('interval', {}).get('endTime')
                    if at and (row['latest_at'] is None or at > row['latest_at']):
                        row['latest_at'] = at
                    if field == 'latency':
                        row['latency_series'].append({'at': at, 'p95_ms': count, 'revision': labels.get('revision_name', '')})
                    else:
                        row[field] = (row[field] or 0) + count
                        error_field = 'server_errors' if field == 'requests' else 'function_errors'
                        row[error_field] = row[error_field] or 0
                        if field == 'requests' and str(metric_labels.get('response_code_class', '')).startswith('5'):
                            row['server_errors'] += count
                        if field == 'executions' and metric_labels.get('status') not in {None, 'ok'}:
                            row['function_errors'] += count
        return {'services': list(services.values()), 'window_seconds': 300, 'truncated': truncated,
            'note': 'Cloud Monitoring is sampled and can arrive late. Missing series mean unknown, not zero traffic. P95 values are per revision and minute; they are not merged percentiles.'}

    def events(self):
        since = stamp(time.time() - 900)
        response = self.transport.request('logging', 'v2/entries:list', body={
            'resourceNames': ['projects/' + self.project], 'pageSize': 100,
            'orderBy': 'timestamp desc', 'filter': f'timestamp >= "{since}" AND (resource.type="cloud_run_revision" OR resource.type="cloud_function")'})
        rows = []
        for entry in response.get('entries', []):
            labels = entry.get('resource', {}).get('labels', {})
            http = entry.get('httpRequest', {})
            payload = entry.get('jsonPayload', {})
            route = None
            node_ids = []
            method = http.get('requestMethod', payload.get('method', ''))
            if method not in {'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'}:
                method = ''
            path = urlsplit(http.get('requestUrl', '')).path.removeprefix('/api')
            # Only a template from the catalogue may be returned, never a raw
            # URL with customer IDs, query strings or unrecognised route data.
            for pattern, verb, template, node_id in self.routes:
                if verb == method and pattern.fullmatch(path):
                    route = template
                    node_ids.append(node_id)
            trace = entry.get('trace', '').rsplit('/', 1)[-1]
            if not re.fullmatch(r'[0-9a-f]{32}', trace):
                trace = None
            severity = entry.get('severity', 'DEFAULT')
            if severity not in {'DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'}:
                severity = 'DEFAULT'
            status = http.get('status')
            rows.append({'id': hashlib.sha256(str(entry.get('insertId', '')).encode() + str(entry.get('timestamp', '')).encode()).hexdigest()[:20],
                'at': entry.get('timestamp'), 'service': labels.get('service_name', labels.get('function_name', 'unknown')),
                'region': labels.get('location', labels.get('region', 'unknown')), 'revision': labels.get('revision_name'),
                'severity': severity, 'method': method, 'route': route, 'node_ids': node_ids,
                'status': status if isinstance(status, int) else None,
                'latency': http.get('latency') if re.fullmatch(r'[0-9.]+s', str(http.get('latency', ''))) else None,
                'trace_id': trace, 'kind': 'request' if http else 'application log (payload withheld)'})
        return {'events': rows, 'truncated': bool(response.get('nextPageToken')), 'limit': 100, 'window_seconds': 900,
            'note': 'Latest 100 log entries within 15 minutes. Payloads and personal data are withheld. Correlation requires propagated trace IDs.'}

    def traces(self):
        result = self.transport.request('cloudtrace', f'v1/projects/{self.project}/traces', params={
            'startTime': stamp(time.time() - 900), 'endTime': stamp(), 'pageSize': 20,
            'view': 'COMPLETE', 'orderBy': 'start desc'})
        traces = []
        safe_templates = {n['route'] for n in self.catalog.nodes.values() if n['kind'] == 'endpoint'}
        for trace in result.get('traces', []):
            spans = []
            for span in trace.get('spans', [])[:200]:
                labels = span.get('labels', {})
                route = labels.get('http.route') or labels.get('/http/route')
                spans.append({'id': span.get('spanId'), 'parent_id': span.get('parentSpanId'),
                    'start': span.get('startTime'), 'end': span.get('endTime'),
                    'name': route if route in safe_templates else 'Instrumented span',
                    'kind': span.get('kind', 'SPAN_KIND_UNSPECIFIED')})
            traces.append({'id': trace.get('traceId'), 'spans': spans, 'truncated': len(trace.get('spans', [])) > 200})
        return {'traces': traces, 'truncated': bool(result.get('nextPageToken')), 'window_seconds': 900,
            'note': 'Parent-child edges come only from recorded trace spans. Uninstrumented calls and unsampled requests are not visible.'}

    def snapshot(self):
        if not self.enabled:
            return {name: {'state': 'disconnected', 'interval_seconds': ttl, 'collected_at': None,
                'last_success_at': None, 'data': {}, 'error': 'Live collection is off. Configure a read-only GCP identity and ENGINEERING_CLOUD_ENABLED=true.'}
                for name, ttl in [('inventory', 300), ('metrics', 60), ('events', 15), ('traces', 60)]}
        jobs = [(name, self.pool.submit(self.cache.get, name, ttl, collect)) for name, ttl, collect in [
            ('inventory', 300, self.inventory), ('metrics', 60, self.metrics),
            ('events', 15, self.events), ('traces', 60, self.traces)]]
        return {name: future.result() for name, future in jobs}
