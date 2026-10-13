import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from engineering.server.app import create_app, verify_engineer
from engineering.server.catalog import Catalog
from engineering.server.cloud import Cache, Cloud, CloudError, normalize_asset


@pytest.fixture
def catalog(tmp_path):
    (tmp_path / 'backend').mkdir()
    (tmp_path / 'backend/main.py').write_text('''
import operations
password = "super-secret-value"
@app.get('/orders/{order_id}')
def get_order(order_id):
    return operations.get(order_id)
@app.post('/orders')
def add_order():
    return fs_collection('orders')
def work(u):
    return u.get('workers', 'id')
''')
    (tmp_path / 'backend/operations.py').write_text('def get(value): return value\n')
    (tmp_path / 'backend/test_private.py').write_text('raise RuntimeError("MUST NOT EXECUTE")')
    (tmp_path / '.env').write_text('TOP_SECRET=secret-canary')
    (tmp_path / 'firebase.json').write_text(json.dumps({'hosting': {'rewrites': [
        {'source': '/api/**', 'run': {'serviceId': 'repaido-api', 'region': 'us-central1'}}]}}))
    return Catalog(tmp_path)


def test_catalog_static_routes_source_and_inference(catalog):
    assert 'route:main:GET:/orders/{order_id}' in catalog.nodes
    assert 'collection:orders' in catalog.nodes
    assert catalog.nodes['collection:ops_workers']['evidence'] == 'inferred'
    assert 'module:test_private' not in catalog.nodes
    assert any(e['label'] == 'calls in handler' for e in catalog.edges.values())
    assert all(e['source'] in catalog.nodes and e['target'] in catalog.nodes for e in catalog.edges.values())
    assert all(n['status'] == 'unverified' for n in catalog.nodes.values())


def test_source_never_reads_arbitrary_path_or_returns_literals(catalog):
    for value in ('../../.env', 'module:../.env', '/etc/passwd', 'module:test_private'):
        assert catalog.source(value) is None
    code = catalog.source('module:main')['code']
    assert 'super-secret-value' not in code
    assert 'secret-canary' not in json.dumps(catalog.graph())
    assert '[string redacted]' in code
    assert 'def get_order' in catalog.source('route:main:GET:/orders/{order_id}')['code']


def test_engineering_role_enforced_not_admin(catalog):
    seen = []
    def verifier(token):
        seen.append(token)
        return {'uid': 'u', 'engineer': token == 'engineer', 'admin': True}
    app = create_app(root=catalog.root, catalog=catalog, verifier=verifier, preview=False)
    client = TestClient(app)
    for path in ('blueprint', 'snapshot', 'source?node=module:main', 'stream'):
        assert client.get('/engineering-api/' + path).status_code == 401
        assert client.get('/engineering-api/' + path, headers={'Authorization': 'Bearer admin'}).status_code == 403
    result = client.get('/engineering-api/blueprint', headers={'Authorization': 'Bearer engineer'})
    assert result.status_code == 200
    assert result.headers['cache-control'] == 'private, no-store'
    assert "frame-ancestors 'none'" in result.headers['content-security-policy']
    assert client.post('/engineering-api/blueprint').status_code == 405
    assert client.get('/engineering-api/blueprint?token=engineer').status_code == 401


def test_firebase_verification_checks_revocation_and_exact_claim(monkeypatch):
    from engineering.server import app as module
    monkeypatch.setattr(module.firebase_admin, 'get_app', lambda name: object())
    checks = []
    def verify(token, **kw):
        checks.append(kw)
        return {'uid': 'engineer', 'engineer': token, 'admin': True}
    monkeypatch.setattr(module.auth, 'verify_id_token', verify)
    assert verify_engineer(True, 'repaido')['engineer'] is True
    assert checks[0]['check_revoked'] is True
    for token in ('true', 1, None):
        with pytest.raises(HTTPException) as caught:
            verify_engineer(token, 'repaido')
        assert caught.value.status_code == 403


def test_local_preview_does_not_trust_remote_or_forwarded_clients(catalog, monkeypatch):
    app = create_app(root=catalog.root, catalog=catalog, preview=True)
    assert TestClient(app).get('/engineering-api/blueprint').status_code == 401
    local = TestClient(app, client=('127.0.0.1', 1234), base_url='http://127.0.0.1')
    assert local.get('/engineering-api/blueprint').status_code == 200
    assert local.get('/engineering-api/blueprint', headers={'X-Forwarded-For': '127.0.0.1'}).status_code == 401
    assert local.get('/engineering-api/blueprint', headers={'Host': 'attacker.example'}).status_code == 401
    monkeypatch.setenv('K_SERVICE', 'production')
    with pytest.raises(RuntimeError, match='forbidden'):
        create_app(root=catalog.root, catalog=catalog, preview=True)


def test_cloud_inventory_allowlist_omits_configuration_secrets():
    node, refs = normalize_asset({'name': '//run.googleapis.com/projects/repaido/locations/us-central1/services/api',
        'assetType': 'run.googleapis.com/Service', 'resource': {'data': {
            'env': [{'name': 'API_KEY', 'value': 'secret-canary'}], 'metadata': {'secrets': 'secret-canary'},
            'network': 'projects/repaido/global/networks/default',
            'status': {'conditions': [{'type': 'Ready', 'status': 'True'}]}}}})
    assert 'secret-canary' not in json.dumps((node, refs))
    assert refs == [('network', 'projects/repaido/global/networks/default')]
    assert node['status'] == 'configuration observed'


def test_singleflight_cache_and_stale_retention():
    cache = Cache()
    calls = []
    def collect():
        calls.append(1)
        time.sleep(.01)
        return {'value': 12}
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: cache.get('metrics', 60, collect), range(8)))
    assert len(calls) == 1
    assert all(r['data'] == {'value': 12} for r in results)
    def fail():
        raise CloudError('Permission denied')
    stale = cache.get('metrics', 0, fail)
    assert stale['state'] == 'stale' and stale['data']['value'] == 12
    assert stale['last_success_at'] == results[0]['last_success_at']
    unknown = cache.get('new', 60, fail)
    assert unknown['state'] == 'unavailable' and unknown['data'] == {}


class FakeTransport:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []
    def request(self, api, path, params=None, body=None):
        self.calls.append((api, path, params, body))
        return self.responses[api](params, body)


def test_inventory_pagination_bound_and_explicit_resource_edges(catalog):
    response = {'assets': [
        {'name': '//compute.googleapis.com/projects/repaido/global/networks/net', 'assetType': 'compute.googleapis.com/Network'},
        {'name': '//compute.googleapis.com/projects/repaido/regions/us-central1/subnetworks/sub', 'assetType': 'compute.googleapis.com/Subnetwork',
         'resource': {'data': {'network': 'https://www.googleapis.com/compute/v1/projects/repaido/global/networks/net'}}}], 'nextPageToken': 'more'}
    transport = FakeTransport({'cloudasset': lambda p,b: response})
    cloud = Cloud('repaido', catalog, True, transport)
    value = cloud.inventory()
    assert len(transport.calls) == 5
    assert value['truncated'] is True
    assert any(e['label'] == 'network' and e['evidence'] == 'cloud' for e in value['edges'])


def test_events_strip_customer_ids_queries_payloads_and_unmatched_urls(catalog):
    transport = FakeTransport({'logging': lambda p,b: {'entries': [
        {'timestamp': '2026-10-13T10:00:00Z', 'insertId': '1', 'resource': {'labels': {'service_name': 'repaido-api'}},
         'httpRequest': {'requestUrl': 'https://private/api/orders/customer-secret?token=secret-canary', 'requestMethod': 'GET', 'status': 200, 'latency': '0.31s'},
         'jsonPayload': {'password': 'secret-canary'}, 'textPayload': 'private customer text', 'trace': 'projects/repaido/traces/' + 'a' * 32},
        {'insertId': '2', 'httpRequest': {'requestUrl': 'https://private/unknown/customer-private', 'requestMethod': 'GET'}, 'trace': 'invalid-private-trace'}]}})
    cloud = Cloud('repaido', catalog, True, transport)
    value = cloud.events()
    serial = json.dumps(value)
    assert all(secret not in serial for secret in ('customer-secret', 'secret-canary', 'customer-private', 'private customer text', 'invalid-private'))
    assert value['events'][0]['route'] == '/orders/{order_id}'
    assert value['events'][1]['route'] is None
    assert transport.calls[0][3]['pageSize'] == 100
    assert 'timestamp >=' in transport.calls[0][3]['filter']


def test_metrics_do_not_fabricate_absent_request_counts(catalog):
    def monitoring(params, body):
        if 'request_latencies' in params['filter']:
            return {'timeSeries': [{'resource': {'type': 'cloud_run_revision', 'labels': {'service_name': 'api'}},
                'points': [{'interval': {'endTime': '2026-10-13T10:00:00Z'}, 'value': {'doubleValue': 13.5}}]}]}
        return {}
    value = Cloud('repaido', catalog, True, FakeTransport({'monitoring': monitoring})).metrics()
    assert value['services'][0]['requests'] is None
    assert value['services'][0]['latency_series'][0]['p95_ms'] == 13.5


def test_disconnected_collectors_make_no_external_calls(catalog):
    transport = FakeTransport({})
    value = Cloud('repaido', catalog, False, transport).snapshot()
    assert len(value) == 4 and all(c['state'] == 'disconnected' and c['data'] == {} for c in value.values())
    assert transport.calls == []


def test_trace_parent_relationships_without_span_labels_or_raw_names(catalog):
    transport = FakeTransport({'cloudtrace': lambda p,b: {'traces': [{'traceId': 'a' * 32, 'spans': [
        {'spanId': '1', 'name': '/customers/private-name', 'labels': {'http.route': '/orders/{order_id}', 'token': 'canary'}},
        {'spanId': '2', 'parentSpanId': '1', 'name': 'private-sql-query', 'labels': {'sql.query': 'canary'}}]}]}})
    value = Cloud('repaido', catalog, True, transport).traces()
    assert value['traces'][0]['spans'][1]['parent_id'] == '1'
    assert 'canary' not in json.dumps(value) and 'private-' not in json.dumps(value)
