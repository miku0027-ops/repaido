"""Failure isolation, bounded provider work and durable recovery under contention."""
import threading
import time
import base64
import io
import json
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pytest
import bike_dispatch as dispatch
import bike_runtime as runtime
import bike_worker_health as probes
from routing_cache import RouteReads, RoutingBusy, cache_key
from test_bike_dispatch import store, pubsub_env, ride, PubSubMessage


def test_one_worker_leaving_or_failing_cannot_disable_healthy_peer(store, monkeypatch):
    pubsub_env(monkeypatch)
    config = dispatch.configuration()
    for name, connected, backlog in [('a', True, 9), ('b', True, 9), ('c', False, 900)]:
        store.run(lambda u: runtime.heartbeat(u, name, config, connected=connected, now=1000, backlog=backlog))
    value = store.run(lambda u: dispatch.engine_health(u, 1001))
    assert value['ready'] and value['healthy_workers'] == 2 and value['degraded_workers'] == 1
    assert value['outbox_backlog'] == 9  # overlapping samples cannot be added
    store.run(lambda u: runtime.heartbeat(u, 'a', config, connected=False, draining=True, now=1002))
    assert store.run(lambda u: dispatch.engine_health(u, 1003))['healthy_workers'] == 1
    assert not store.run(lambda u: dispatch.engine_health(u, 1061))['ready']
    store.run(lambda u: runtime.heartbeat(u, 'new', config, connected=True, now=1062))
    assert store.run(lambda u: dispatch.engine_health(u, 1063))['ready']


def test_failure_is_key_scoped_throttled_and_only_matching_replay_clears_it(store):
    runtime.record_failure(store, 'a', 'event-2', 'native_commit_failed', 1000)
    runtime.record_failure(store, 'a', 'event-2', 'native_commit_failed', 1001)
    store.run(lambda u: runtime.clear_failure(u, 'a', 'event-1', 1002))
    assert store.run(lambda u: runtime.rider_blocked(u, 'a'))
    assert not store.run(lambda u: runtime.rider_blocked(u, 'b'))
    row = store.run(lambda u: u.get('bike_dispatch_key_health', runtime.digest('a')))
    assert row['attempts'] == 1
    store.run(lambda u: runtime.clear_failure(u, 'a', 'event-2', 1003))
    assert not store.run(lambda u: runtime.rider_blocked(u, 'a'))


def test_probe_distinguishes_startup_broker_outage_and_stalled_process(monkeypatch):
    clock = {'now': 1000}
    monkeypatch.setattr(probes.time, 'monotonic', lambda: clock['now'])
    pulse = probes.WorkerPulse()
    assert not pulse.status() and not pulse.status(True)
    pulse.touch(True)
    assert pulse.status() and pulse.status(True)
    pulse.touch(False)
    assert pulse.status() and not pulse.status(True)
    clock['now'] += 46
    assert not pulse.status()


def test_private_http_probes_have_no_cache_or_internal_details():
    pulse = probes.WorkerPulse(); pulse.touch(True)
    server = probes.health_server(pulse, 0, '127.0.0.1')
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/livez', timeout=2) as response:
            assert response.status == 200 and response.headers['Cache-Control'] == 'no-store'
            assert response.read() == b'{"status": "ok"}'
        pulse.touch(False)
        with pytest.raises(urllib.error.HTTPError) as failure:
            urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/readyz', timeout=2)
        assert failure.value.code == 503
    finally:
        server.shutdown(); server.server_close()


def test_pinned_quota_secret_load_checks_integrity_and_withholds_secret_on_failure(monkeypatch):
    import google.auth
    import google_crc32c
    from types import SimpleNamespace
    resource='projects/repaido/secrets/fixture-quota/versions/1'
    secret=b'fixture-only-quota-key-more-than-thirty-two-bytes'
    monkeypatch.setenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET_RESOURCE',resource)
    monkeypatch.setenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET','')
    credentials=SimpleNamespace(before_request=lambda *args:None)
    monkeypatch.setattr(google.auth,'default',lambda **kwargs:(credentials,'repaido'))
    payload={'payload':{'data':base64.b64encode(secret).decode(),'dataCrc32c':str(google_crc32c.value(secret))}}
    requested=[]
    def response(request,timeout):
        requested.append((request.full_url,timeout))
        return io.BytesIO(json.dumps(payload).encode())
    monkeypatch.setattr(urllib.request,'urlopen',response)
    probes.load_quota_secret()
    import os
    assert os.environ['REPAIDO_BIKE_PROMO_QUOTA_SECRET']==secret.decode()
    assert requested==[('https://secretmanager.googleapis.com/v1/'+resource+':access',10)]
    with pytest.raises(RuntimeError,match='one quota-secret source'):probes.load_quota_secret()
    monkeypatch.delenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET')
    payload['payload']['dataCrc32c']='0'
    with pytest.raises(RuntimeError) as error:probes.load_quota_secret()
    assert secret.decode() not in str(error.value) and base64.b64encode(secret).decode() not in str(error.value)
    monkeypatch.setenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET_RESOURCE',resource.replace('/1','/latest'))
    with pytest.raises(RuntimeError,match='pinned'):probes.load_quota_secret()


def test_supervisor_reconnects_without_setting_global_stop_or_losing_owner(store, monkeypatch):
    import bike_dispatch_worker as worker
    owners, delays = [], []
    stop = threading.Event()
    def run(*_, **kwargs):
        owners.append(kwargs['owner'])
        if len(owners) < 3: raise OSError('Fixture subscriber disconnect')
        stop.set()
    monkeypatch.setattr(worker, 'run_pubsub', run)
    monkeypatch.setattr(stop, 'wait', lambda delay: delays.append(delay))
    worker.supervise(store, lambda *_: None, stop=stop, adapter_factory=object, jitter=lambda low, high: high)
    assert len(owners) == 3 and len(set(owners)) == 1 and delays == [2, 4]


def test_provider_singleflight_exact_keys_memory_cap_and_ttl():
    clock = {'now': 0}; calls = []
    gate, entered = threading.Event(), threading.Event()
    pool = RouteReads(workers=2, pending=2, entries=3, ttl=10, max_bytes=90, clock=lambda: clock['now'])
    def load():
        calls.append(1); entered.set(); gate.wait(2)
        return {'points': [1, 2, 3], 'distance_metres': 2}
    try:
        future = pool.submit('same', load); assert entered.wait(1)
        assert all(pool.submit('same', load) is future for _ in range(100))
        gate.set(); assert future.result(2)['distance_metres'] == 2
        pool.close()  # done callbacks are finished before inspecting accounting
        assert len(calls) == 1 and pool.snapshot()['coalesced'] == 100
        assert pool.read('same', load)['points'] == [1, 2, 3]
        result = pool.read('same', load); result['points'].append(999)
        assert pool.read('same', load)['points'] == [1, 2, 3]
        # Two exact pins never coalesce just because they share a map tile.
        assert cache_key('eta', {'lat':1, 'lng':2}, {'lat':3, 'lng':4}) != cache_key('eta', {'lat':1.00001, 'lng':2}, {'lat':3, 'lng':4})
    finally:
        gate.set(); pool.close()


def test_provider_backpressure_outage_circuit_and_half_open_recovery():
    clock = {'now': 0}
    pool = RouteReads(workers=1, pending=1, entries=3, ttl=2, max_bytes=100, clock=lambda: clock['now'])
    gate, entered = threading.Event(), threading.Event()
    def held(): entered.set(); gate.wait(2); return {'ok': True}
    try:
        first = pool.submit('busy', held); assert entered.wait(1)
        with pytest.raises(RoutingBusy): pool.submit('other', held)
        gate.set(); first.result(2)
        for index in range(3):
            with pytest.raises(OSError): pool.read('fail'+str(index), lambda: (_ for _ in ()).throw(OSError('Fixture provider outage')))
        with pytest.raises(RoutingBusy): pool.submit('open', lambda: {})
        clock['now'] += 16
        assert pool.read('probe', lambda: {'restored': True}) == {'restored': True}
        assert not pool.snapshot()['circuit_open']
        # Oversized responses may be returned but are never retained.
        assert pool.read('large', lambda: {'points': 'x'*200})['points'] == 'x'*200
        assert pool.snapshot()['cached_bytes'] <= 100
        clock['now'] += 3
        assert pool.read('probe', lambda: {'fresh': True}) == {'fresh': True}
    finally:
        gate.set(); pool.close()


def test_stationary_gps_avoids_shared_cell_writes_but_revival_invalidates(store):
    from test_bike_dispatch import PIN
    store.run(lambda u: dispatch.index_availability(u, 'bike', PIN, True, 1000, 1000))
    before = store.run(lambda u: u.get('bike_dispatch_cell_versions', dispatch.cell(PIN)))
    store.run(lambda u: dispatch.index_availability(u, 'bike', PIN, True, 1020, 1020))
    assert store.run(lambda u: u.get('bike_dispatch_cell_versions', dispatch.cell(PIN))) == before
    store.run(lambda u: dispatch.index_availability(u, 'bike', PIN, True, 1200, 1200))
    after = store.run(lambda u: u.get('bike_dispatch_cell_versions', dispatch.cell(PIN)))
    assert after['version'] > before['version']


def test_slow_relay_makes_fair_progress_before_revisiting_busy_rider(store, monkeypatch):
    clock={'now':0}; published=[]
    for rider in ('a','b','c','d'):
        for number in range(2):
            store.run(lambda u:dispatch.enqueue(u,ride(f'{rider}-{number}',rider=rider),'booking_requested'))
    monkeypatch.setattr(dispatch.time,'monotonic',lambda:clock['now'])
    class SlowBroker:
        def publish(self,event):
            published.append(event['rider_id']);clock['now']+=3
    cursor=runtime.RelayCursor('worker')
    for turn in range(4):
        assert dispatch.relay_once(store,SlowBroker(),owner='worker',cursor=cursor,limit=4,time_budget=2,now=1000+turn)==1
    assert published==['a','b','c','d']
