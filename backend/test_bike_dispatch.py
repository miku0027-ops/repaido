"""Real H3 geometry + transactional dispatch invariants; broker is a test adapter."""
import copy
import json
import math
import sqlite3
from contextlib import contextmanager
from types import SimpleNamespace

import h3
import pytest

import bike_dispatch as dispatch
from operations import Store

PIN = {'lat': 21.4934, 'lng': 86.9135}


@pytest.fixture
def store(tmp_path):
    path = str(tmp_path / 'dispatch.sqlite')
    @contextmanager
    def database():
        with sqlite3.connect(path) as connection:
            connection.row_factory = sqlite3.Row
            yield connection
    core = SimpleNamespace(USE_FIRESTORE=False, DB_PATH=path, db=database)
    store = Store(core)
    store.init()
    dispatch.initialize(core)
    dispatch._CACHE.clear()
    return store


def destination(origin, distance, bearing):
    lat, lng = math.radians(origin['lat']), math.radians(origin['lng'])
    heading, arc = math.radians(bearing), distance / 6371000
    end_lat = math.asin(math.sin(lat) * math.cos(arc) + math.cos(lat) * math.sin(arc) * math.cos(heading))
    end_lng = lng + math.atan2(math.sin(heading) * math.sin(arc) * math.cos(lat), math.cos(arc) - math.sin(lat) * math.sin(end_lat))
    return {'lat': math.degrees(end_lat), 'lng': (math.degrees(end_lng) + 180) % 360 - 180}


@pytest.mark.parametrize('origin', [PIN, {'lat': 0, 'lng': 179.999}, {'lat': 89.999, 'lng': -179}, {'lat': -89.99, 'lng': 30},
                                   *[dict(zip(('lat', 'lng'), h3.cell_to_latlng(item))) for item in h3.get_pentagons(6)]])
def test_real_h3_circle_cover_including_poles_dateline_and_pentagons(origin):
    cover = set(dispatch.nearby_cells(origin))
    assert 1 <= len(cover) <= 37
    for bearing in range(0, 360, 5):
        for radius in (1, 1000, 3999, 4000):
            assert dispatch.cell(destination(origin, radius, bearing)) in cover


def test_h3_rejects_invalid_radius_and_pin():
    for pin in ({'lat': 91, 'lng': 10}, {'lat': float('nan'), 'lng': 10}, {'lat': 1, 'lng': float('inf')}):
        with pytest.raises(ValueError):
            dispatch.cell(pin)
    with pytest.raises(ValueError):
        dispatch.nearby_cells(PIN, 8000)


def test_index_move_offline_staleness_and_cache_invalidation(store):
    now = 1000
    def online(u):
        dispatch.index_availability(u, 'a', PIN, True, now, now)
        dispatch.index_availability(u, 'stale', PIN, True, now, now - 121)
        dispatch.index_availability(u, 'offline', PIN, False, now, now)
    store.run(online)
    assert store.run(lambda u: dispatch.candidate_ids(u, PIN, 4000, now)) == ['a']
    assert store.run(lambda u: dispatch.candidate_ids(u, PIN, 4000, now + 1)) == ['a']
    store.run(lambda u: dispatch.index_availability(u, 'a', destination(PIN, 30000, 0), True, now, now))
    assert store.run(lambda u: dispatch.candidate_ids(u, PIN, 4000, now + 1)) == []
    assert store.run(lambda u: dispatch.candidate_ids(u, destination(PIN, 30000, 0), 4000, now)) == ['a']
    store.run(lambda u: dispatch.index_availability(u, 'a', None, False, now, now))
    assert store.run(lambda u: dispatch.candidate_ids(u, destination(PIN, 30000, 0), 4000, now)) == []


def test_cache_contains_ids_and_cells_only_no_customer_gps_or_uncommitted_writes(store):
    store.run(lambda u: dispatch.index_availability(u, 'rider-a', PIN, True, 1000, 1000))
    store.run(lambda u: dispatch.candidate_ids(u, PIN, 4000, 1000))
    cache = repr(dispatch._CACHE)
    assert str(PIN['lat']) not in cache and str(PIN['lng']) not in cache
    before = copy.deepcopy(dispatch._CACHE)
    def pending(u):
        dispatch.index_availability(u, 'not-committed', PIN, True, 1000, 1000)
        assert 'not-committed' in dispatch.candidate_ids(u, PIN, 4000, 1000)
        raise RuntimeError('rollback')
    with pytest.raises(RuntimeError):
        store.run(pending)
    assert dispatch._CACHE == before
    assert store.run(lambda u: dispatch.candidate_ids(u, PIN, 4000, 1000)) == ['rider-a']


def test_search_is_bounded_without_collection_scan(store, monkeypatch):
    from operations import Unit
    monkeypatch.setattr(Unit, 'all', lambda *_: pytest.fail('Unbounded scan'))
    def seed(u):
        for index in range(40):
            dispatch.index_availability(u, f'rider-{index:03}', PIN, True, 1000, 1000)
    store.run(seed)
    ids = store.run(lambda u: dispatch.candidate_ids(u, PIN, 4000, 1000))
    assert len(ids) == dispatch.CELL_LIMIT
    assert len(ids) <= dispatch.MAX_CANDIDATES


def test_busy_rider_is_indexed_at_current_position_and_next_dropoff(store):
    finish = destination(PIN, 30000, 0)
    store.run(lambda u: dispatch.index_availability(u, 'busy', PIN, True, 1900, 1000, next_pickup_origin=finish))
    assert store.run(lambda u: dispatch.candidate_ids(u, finish, 4000, 1000)) == ['busy']
    assert store.run(lambda u: dispatch.candidate_ids(u, PIN, 4000, 1000)) == ['busy']
    store.run(lambda u: dispatch.index_availability(u, 'busy', PIN, True, 1001, 1001))
    assert store.run(lambda u: dispatch.candidate_ids(u, finish, 4000, 1001)) == []


def test_scoring_waits_for_current_finish_and_reranks_with_actual_road_eta(monkeypatch):
    monkeypatch.delenv('GOOGLE_ROUTES_API_KEY', raising=False)
    now = 1000
    rows = [{'id': 'near-busy', 'position': PIN, 'next_pickup_origin': PIN, 'available_at': now + 1200},
            {'id': 'near-idle', 'position': destination(PIN, 100, 0), 'available_at': now},
            {'id': 'far-idle', 'position': destination(PIN, 600, 0), 'available_at': now},
            {'id': 'too-far', 'position': destination(PIN, 5000, 0)},
            {'id': 'too-busy', 'position': PIN, 'available_at': now + 3601}]
    baseline = dispatch.rank_candidates(rows, PIN, now)
    assert [row['id'] for row in baseline] == ['near-idle', 'far-idle', 'near-busy']
    assert all(row['route_source'] == 'distance_estimate' for row in baseline)
    calls = []
    def routes(origin, destination):
        calls.append((origin, destination))
        seconds = 900 if origin == rows[1]['position'] else 20
        return {'distance_metres': 600, 'duration_seconds': seconds, 'provider': 'google_routes'}
    ranked = dispatch.rank_candidates(rows, PIN, now, route_provider=routes)
    assert ranked[0]['id'] == 'far-idle'
    assert ranked[-1]['available_in_seconds'] == 1200
    assert len(calls) == 3
    assert all(row['route_source'] == 'google_routes' for row in ranked)
    assert all('_dispatch_origin' not in row for row in ranked)


def ride(identifier='ride-a', version=1, rider='rider-a'):
    return {'id': identifier, 'version': version, 'rider_id': rider, 'updated_at': 1000,
            'pickup': PIN, 'phone': 'private-contact', 'otp': 'private-otp'}


def test_enqueue_has_per_rider_commit_sequence_and_no_passenger_secrets(store):
    first = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    duplicate = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    second = store.run(lambda u: dispatch.enqueue(u, ride('ride-b'), 'booking_requested'))
    other = store.run(lambda u: dispatch.enqueue(u, ride('ride-c', rider='rider-b'), 'booking_requested'))
    assert first == duplicate and [first['sequence'], second['sequence'], other['sequence']] == [1, 2, 1]
    assert not {'phone', 'pickup', 'otp', 'customer_id'} & first.keys()


class Adapter:
    def __init__(self):
        self.events = []
        self.fail = False

    def publish(self, event):
        if self.fail:
            raise dispatch.RetryDispatch('Broker unavailable')
        self.events.append(copy.deepcopy(event))


def test_relay_order_lease_and_delivery_failure_leave_durable_work(store):
    first = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    second = store.run(lambda u: dispatch.enqueue(u, ride('ride-b'), 'booking_requested'))
    adapter = Adapter()
    adapter.fail = True
    with pytest.raises(dispatch.RetryDispatch):
        dispatch.relay_once(store, adapter, owner='worker-1', now=1000)
    assert not store.run(lambda u: u.get('bike_dispatch_outbox', first['id']))['published']
    assert dispatch.relay_once(store, adapter, owner='worker-2', now=1001) == 0
    adapter.fail = False
    assert dispatch.relay_once(store, adapter, owner='worker-1', now=1001) == 1
    assert dispatch.relay_once(store, adapter, owner='worker-2', now=1002) == 1
    assert adapter.events == [first, second]


def test_atomic_consumer_deduplicates_and_rejects_forged_durable_envelope(store):
    event = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    calls = []
    def reserve(u, envelope):
        calls.append(envelope['id'])
        u.put('test_reservation', 'rider-a', {'id': 'rider-a', 'ride_id': envelope['ride_id']})
        return {'reserved': True}
    assert dispatch.apply_event(store, event, reserve)['duplicate'] is False
    assert dispatch.apply_event(store, event, reserve)['duplicate'] is True
    assert len(calls) == 1
    forged = {**event, 'rider_id': 'another-rider'}
    with pytest.raises(ValueError, match='committed outbox'):
        dispatch.apply_event(store, forged, reserve)


def test_delivery_ack_transaction_failure_replays_same_event_before_next_sequence(store, monkeypatch):
    first = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    second = store.run(lambda u: dispatch.enqueue(u, ride('ride-b'), 'booking_requested'))
    adapter = Adapter()
    original = store.run
    def crash_after_delivery(callback):
        if callback.__name__ == 'acknowledge':
            raise RuntimeError('Database temporarily unavailable after broker delivery')
        return original(callback)
    monkeypatch.setattr(store, 'run', crash_after_delivery)
    with pytest.raises(RuntimeError):
        dispatch.relay_once(store, adapter, owner='old-worker', now=1000)
    monkeypatch.setattr(store, 'run', original)
    assert dispatch.relay_once(store, adapter, owner='new-worker', now=1031) == 1
    assert dispatch.relay_once(store, adapter, owner='new-worker', now=1032) == 1
    assert adapter.events == [first, first, second]
    calls = []
    for event in adapter.events:
        dispatch.apply_event(store, event, lambda u, item: calls.append(item['id']))
    assert calls == [first['id'], second['id']]


def test_many_hot_riders_cannot_starve_later_rider_streams(store):
    for rider in ['a', 'b', 'c', 'd', 'z']:
        for version in range(1, 4):
            store.run(lambda u, rider=rider, version=version: dispatch.enqueue(u, ride(rider, version, rider), 'position'))
    adapter = Adapter()
    dispatch.relay_once(store, adapter, owner='worker', now=1000, limit=2)
    dispatch.relay_once(store, adapter, owner='worker', now=1001, limit=2)
    dispatch.relay_once(store, adapter, owner='worker', now=1002, limit=2)
    assert [event['rider_id'] for event in adapter.events] == ['a', 'b', 'c', 'd', 'z']


def test_consumer_sequence_and_callback_failure_cannot_write_partial_dedup(store):
    first = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    second = store.run(lambda u: dispatch.enqueue(u, ride('ride-b'), 'booking_requested'))
    with pytest.raises(dispatch.RetryDispatch):
        dispatch.apply_event(store, second, lambda *_: None)
    def failing(u, event):
        u.put('test_reservation', 'rider-a', {'id': 'rider-a'})
        raise RuntimeError('Try again')
    with pytest.raises(RuntimeError):
        dispatch.apply_event(store, first, failing)
    assert store.run(lambda u: u.get('bike_dispatch_consumed', first['id'])) is None
    assert store.run(lambda u: u.get('test_reservation', 'rider-a')) is None
    dispatch.apply_event(store, first, lambda *_: {'reserved': True})
    dispatch.apply_event(store, second, lambda *_: {'reserved': False})


class Message:
    def __init__(self, event):
        self.event = event
    def error(self): return None
    def value(self): return json.dumps(self.event).encode()
    def key(self): return self.event['rider_id'].encode()
    def topic(self): return 'repaido.bike.dispatch.v1'
    def partition(self): return 0
    def offset(self): return 4


class Consumer:
    def __init__(self, event):
        self.message = Message(event)
        self.commits, self.seeks = [], []
    def poll(self, timeout): return self.message
    def commit(self, **kwargs): self.commits.append(kwargs)
    def seek(self, partition): self.seeks.append(partition)


def test_broker_offset_is_committed_only_after_success_and_seeked_after_failure(store):
    pytest.importorskip('confluent_kafka', reason='Optional Kafka compatibility extra')
    event = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    consumer = Consumer(event)
    def fail(*_): raise RuntimeError('Reservation failed')
    with pytest.raises(RuntimeError):
        dispatch.consume_once(store, consumer, fail)
    assert not consumer.commits and consumer.seeks[0].offset == 4
    assert dispatch.consume_once(store, consumer, lambda *_: {'reserved': True})['duplicate'] is False
    assert consumer.commits[0]['asynchronous'] is False
    assert dispatch.consume_once(store, consumer, fail)['duplicate'] is True
    assert len(consumer.commits) == 2


def kafka_env(monkeypatch):
    monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE', 'kafka')
    monkeypatch.setenv('REPAIDO_BIKE_KAFKA_BOOTSTRAP_SERVERS', 'broker.example.com:9093')
    monkeypatch.setenv('REPAIDO_BIKE_KAFKA_USERNAME', 'test-only')
    monkeypatch.setenv('REPAIDO_BIKE_KAFKA_PASSWORD', 'test-only')


def test_configuration_fail_closed_and_never_silent_direct_fallback(monkeypatch):
    monkeypatch.delenv('REPAIDO_BIKE_KAFKA_BOOTSTRAP_SERVERS', raising=False)
    monkeypatch.delenv('REPAIDO_BIKE_DISPATCH_MODE', raising=False)
    assert dispatch.readiness()['ready'] is False
    monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE', 'direct')
    with pytest.raises(RuntimeError): dispatch.configuration()
    monkeypatch.setenv('REPAIDO_ENV', 'test')
    monkeypatch.setenv('REPAIDO_BIKE_DIRECT_DEV_ENABLED', 'true')
    monkeypatch.delenv('K_SERVICE', raising=False)
    assert dispatch.configuration() == {'mode': 'direct'}
    monkeypatch.setenv('K_SERVICE', 'cloud-run-production')
    with pytest.raises(RuntimeError): dispatch.configuration()


def test_worker_health_requires_recent_real_broker_heartbeat(store, monkeypatch):
    kafka_env(monkeypatch)
    health = store.run(lambda u: dispatch.engine_health(u, 1000))
    assert health['configured'] and not health['ready'] and health['reason'] == 'worker_stale'
    config = dispatch.configuration()
    store.run(lambda u: u.put('bike_dispatch_health', 'engine', {'id': 'engine', 'mode': 'kafka',
        'configuration_fingerprint': dispatch._configuration_fingerprint(config), 'updated_at': 1000,
        'broker_connected': True, 'outbox_backlog': 2}))
    assert store.run(lambda u: dispatch.engine_health(u, 1060))['ready']
    assert not store.run(lambda u: dispatch.engine_health(u, 1061))['ready']
    assert 'broker.example.com' not in json.dumps(health)


def test_actual_librdkafka_adapter_partition_key_ack_and_secure_configuration(monkeypatch):
    confluent_kafka = pytest.importorskip('confluent_kafka', reason='Optional Kafka compatibility extra')
    kafka_env(monkeypatch)
    configurations, messages = [], []
    class Producer:
        def __init__(self, config): configurations.append(config)
        def list_topics(self, **kwargs):
            return SimpleNamespace(topics={'repaido.bike.dispatch.v1': SimpleNamespace(error=None, partitions={0: SimpleNamespace(error=None)})})
        def produce(self, topic, **kwargs):
            messages.append((topic, kwargs))
            kwargs['on_delivery'](None, None)
        def flush(self, timeout): return 0
    monkeypatch.setattr(confluent_kafka, 'Producer', Producer)
    adapter = dispatch.KafkaAdapter()
    assert adapter.ready()
    event = {'rider_id': 'rider-a', 'sequence': 1}
    adapter.publish(event)
    assert messages[0][1]['key'] == b'rider-a'
    assert json.loads(messages[0][1]['value']) == event
    assert configurations[0]['enable.idempotence'] is True
    assert configurations[0]['acks'] == 'all'
    assert configurations[0]['ssl.endpoint.identification.algorithm'] == 'https'
    monkeypatch.setenv('REPAIDO_BIKE_KAFKA_SECURITY_PROTOCOL', 'PLAINTEXT')
    with pytest.raises(RuntimeError, match='TLS'):
        dispatch.configuration()


def pubsub_env(monkeypatch):
    monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE', 'pubsub')
    monkeypatch.setenv('REPAIDO_BIKE_PUBSUB_TOPIC', 'projects/repaido/topics/repaido-bike-dispatch-v1')
    monkeypatch.setenv('REPAIDO_BIKE_PUBSUB_SUBSCRIPTION', 'projects/repaido/subscriptions/repaido-bike-dispatch-worker-v1')


def test_pubsub_default_and_configuration_reject_cross_project_and_emulator_fallback(monkeypatch):
    monkeypatch.delenv('REPAIDO_BIKE_DISPATCH_MODE', raising=False)
    monkeypatch.delenv('REPAIDO_BIKE_PUBSUB_TOPIC', raising=False)
    assert dispatch.readiness() == {'ready': False, 'mode': 'pubsub', 'production_ready': False}
    pubsub_env(monkeypatch)
    assert dispatch.configuration()['mode'] == 'pubsub'
    monkeypatch.setenv('REPAIDO_BIKE_PUBSUB_SUBSCRIPTION', 'projects/another-project/subscriptions/repaido-bike-dispatch-worker-v1')
    with pytest.raises(RuntimeError, match='same project'):
        dispatch.configuration()
    pubsub_env(monkeypatch)
    monkeypatch.setenv('PUBSUB_EMULATOR_HOST', 'localhost:8085')
    with pytest.raises(RuntimeError, match='emulator fallback'):
        dispatch.configuration()


class PubSubMessage:
    def __init__(self, event):
        self.data = json.dumps(event).encode()
        self.ordering_key = event['rider_id']
        self.acks, self.nacks = 0, 0
    def ack(self): self.acks += 1
    def nack(self): self.nacks += 1


def test_pubsub_ack_after_atomic_reservation_and_duplicate_nack_on_failure(store):
    event = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    message = PubSubMessage(event)
    calls = []
    def reserve(u, value):
        u.put('test_reservation', 'rider-a', {'id': 'rider-a', 'ride_id': value['ride_id']})
        assert message.acks == 0
        calls.append(value['id'])
        return {'reserved': True}
    dispatch.consume_pubsub_message(store, message, reserve)
    assert message.acks == 1 and message.nacks == 0
    dispatch.consume_pubsub_message(store, message, reserve)
    assert message.acks == 2 and len(calls) == 1
    second = store.run(lambda u: dispatch.enqueue(u, ride('ride-b'), 'booking_requested'))
    failed = PubSubMessage(second)
    def fail(*_): raise RuntimeError('Retryable storage failure')
    with pytest.raises(RuntimeError):
        dispatch.consume_pubsub_message(store, failed, fail)
    assert failed.acks == 0 and failed.nacks == 1
    assert store.run(lambda u: u.get('bike_dispatch_consumed', second['id'])) is None
    failed.ordering_key = 'wrong-rider'
    with pytest.raises(ValueError, match='ordering key'):
        dispatch.consume_pubsub_message(store, failed, fail)
    assert failed.acks == 0 and failed.nacks == 2


def test_actual_pubsub_client_ordering_options_region_iam_and_replay_resume(monkeypatch):
    from google.cloud import pubsub_v1
    pubsub_env(monkeypatch)
    options, messages, resumes, subscriptions = [], [], [], []
    class Future:
        fail = False
        def result(self, timeout):
            if self.fail: raise TimeoutError('Timed out after possible delivery')
            return 'actual-provider-message-id'
    future = Future()
    class Publisher:
        def __init__(self, **kwargs): options.append(('publisher', kwargs))
        def test_iam_permissions(self, request, timeout): return SimpleNamespace(permissions=request['permissions'])
        def publish(self, topic, data, **kwargs):
            messages.append((topic, data, kwargs))
            return future
        def resume_publish(self, topic, key): resumes.append((topic, key))
    class Subscriber:
        ordered = True
        def __init__(self, **kwargs): options.append(('subscriber', kwargs))
        def get_subscription(self, request, timeout):
            return SimpleNamespace(topic=dispatch.configuration()['topic'], enable_message_ordering=self.ordered)
        def test_iam_permissions(self, request, timeout): return SimpleNamespace(permissions=request['permissions'])
        def subscribe(self, name, **kwargs): subscriptions.append((name, kwargs)); return 'streaming-future'
    monkeypatch.setattr(pubsub_v1, 'PublisherClient', Publisher)
    monkeypatch.setattr(pubsub_v1, 'SubscriberClient', Subscriber)
    adapter = dispatch.PubSubAdapter()
    assert options[0][1]['publisher_options'].enable_message_ordering
    assert options[0][1]['client_options']['api_endpoint'] == 'us-central1-pubsub.googleapis.com:443'
    assert adapter.ready()
    event = {'rider_id': 'rider-a', 'sequence': 1}
    adapter.publish(event)
    assert messages[0][2]['ordering_key'] == 'rider-a'
    assert json.loads(messages[0][1]) == event
    future.fail = True
    with pytest.raises(dispatch.RetryDispatch): adapter.publish(event)
    assert resumes == [(adapter.config['topic'], 'rider-a')]
    assert adapter.subscribe(lambda *_: None) == 'streaming-future'
    assert subscriptions[0][1]['flow_control'].max_messages == 32
    assert subscriptions[0][1]['await_callbacks_on_shutdown']
    adapter.subscriber.ordered = False
    assert not adapter.ready()


def test_pubsub_cannot_reuse_recent_kafka_or_other_resource_heartbeat(store, monkeypatch):
    kafka_env(monkeypatch)
    old = dispatch.configuration()
    store.run(lambda u: u.put('bike_dispatch_health', 'engine', {'id': 'engine', 'mode': 'kafka',
        'configuration_fingerprint': dispatch._configuration_fingerprint(old), 'updated_at': 1000, 'broker_connected': True}))
    pubsub_env(monkeypatch)
    assert not store.run(lambda u: dispatch.engine_health(u, 1001))['ready']
    config = dispatch.configuration()
    store.run(lambda u: u.put('bike_dispatch_health', 'engine', {'id': 'engine', 'mode': 'pubsub',
        'configuration_fingerprint': dispatch._configuration_fingerprint(config), 'updated_at': 1000, 'broker_connected': True}))
    assert store.run(lambda u: dispatch.engine_health(u, 1001))['ready']
    monkeypatch.setenv('REPAIDO_BIKE_PUBSUB_TOPIC', 'projects/repaido/topics/different-topic')
    assert not store.run(lambda u: dispatch.engine_health(u, 1001))['ready']


def test_continuous_worker_cannot_mask_failed_rider_with_other_riders_success(store, monkeypatch):
    import bike_dispatch_worker as worker
    pubsub_env(monkeypatch)
    first = store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    other = store.run(lambda u: dispatch.enqueue(u, ride('ride-b', rider='rider-b'), 'booking_requested'))
    allowed = {'rider-a': False}
    clock = {'now': 1000}
    heartbeats = []
    original = store.run
    def tracked(callback):
        result = original(callback)
        if callback.__name__ == 'heartbeat':
            heartbeats.append(original(lambda u: u.get('bike_dispatch_health', 'engine')))
        return result
    monkeypatch.setattr(store, 'run', tracked)
    monkeypatch.setattr(worker.time, 'time', lambda: clock['now'])
    monkeypatch.setattr(worker.time, 'monotonic', lambda: clock['now'])
    class Future:
        def done(self): return False
        def cancel(self): pass
        def result(self, timeout): pass
    class Transport:
        config = dispatch.configuration()
        receive = None
        closed = False
        def subscribe(self, callback): self.receive = callback; return Future()
        def ready(self): return True
        def publish(self, event): pass
        def close(self): self.closed = True
    adapter = Transport()
    class Stop:
        stopped = False
        turn = 0
        def is_set(self): return self.stopped
        def set(self): self.stopped = True
        def wait(self, seconds):
            if self.turn == 0:
                adapter.receive(PubSubMessage(first))
                adapter.receive(PubSubMessage(other))
            elif self.turn == 1:
                allowed['rider-a'] = True
                adapter.receive(PubSubMessage(first))
            else:
                self.stopped = True
            self.turn += 1
            clock['now'] += 21
    def reserve(u, event):
        if event['rider_id'] == 'rider-a' and not allowed['rider-a']:
            raise RuntimeError('Transient transaction failure')
        return {'processed': True}
    worker.run_pubsub(store, reserve, adapter=adapter, stop=Stop())
    assert [item['broker_connected'] for item in heartbeats] == [True, False, True]
    assert all(item['mode'] == 'pubsub' for item in heartbeats)
    assert adapter.closed
    assert not original(lambda u: u.get('bike_dispatch_health', 'engine'))['broker_connected']


def test_explicit_direct_development_drains_actual_reservation_callback_and_followups(store, monkeypatch):
    monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE', 'direct')
    monkeypatch.setenv('REPAIDO_BIKE_DIRECT_DEV_ENABLED', 'true')
    monkeypatch.setenv('REPAIDO_ENV', 'test')
    monkeypatch.delenv('K_SERVICE', raising=False)
    store.run(lambda u: dispatch.enqueue(u, ride(), 'booking_requested'))
    def reserve(u, event):
        if event['event_type'] == 'booking_requested':
            u.put('test_reservation', 'rider-a', {'id': 'rider-a', 'ride_id': event['ride_id']})
            dispatch.enqueue(u, ride(version=2), 'offered')
        return {'processed': True}
    assert dispatch.drain_direct(store, reserve, 'rider-a') == 2
    assert store.run(lambda u: u.get('test_reservation', 'rider-a'))['ride_id'] == 'ride-a'
    assert store.run(lambda u: u.get('bike_dispatch_applied', 'rider-a'))['sequence'] == 2
    monkeypatch.setenv('K_SERVICE', 'production')
    with pytest.raises(RuntimeError):
        dispatch.drain_direct(store, reserve, 'rider-a')


def test_real_google_routes_shape_two_wheeler_and_truthful_failure(monkeypatch):
    monkeypatch.setenv('GOOGLE_ROUTES_API_KEY', 'test-only')
    captured = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self): return b'{"routes":[{"distanceMeters":1234,"duration":"456.2s"}]}'
    def request(value, timeout):
        captured.append((value, timeout))
        return Response()
    monkeypatch.setattr(dispatch.urllib.request, 'urlopen', request)
    route = dispatch.google_pickup_route(PIN, destination(PIN, 100, 0))
    assert route == {'distance_metres': 1234, 'duration_seconds': 457, 'provider': 'google_routes'}
    assert json.loads(captured[0][0].data)['travelMode'] == 'TWO_WHEELER'
    assert captured[0][1] == 4
