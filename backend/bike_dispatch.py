"""Private, bounded H3 discovery and durable, per-rider ordered dispatch.

H3/cache entries are candidate references, never booking authority. Pub/Sub
ordering (or an explicitly selected Kafka partition) serializes rider events;
the database transaction owns reservations, quotas and
deduplication. No network provider is called inside a retried Store transaction.
"""
import copy
import hashlib
import json
import math
import os
import re
import threading
import time
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import h3

from operations import metres

RESOLUTION = 6
MAX_PICKUP_METRES = 4000
CELL_LIMIT = 24
MAX_CANDIDATES = 888
POSITION_MAX_AGE = 120
CACHE_SECONDS = 15
SCHEMA_VERSION = 1
_CACHE = OrderedDict()
_CACHE_LOCK = threading.Lock()
_RELAY_CURSORS = OrderedDict()
_RELAY_LOCK = threading.Lock()


def initialize(core):
    if not core.USE_FIRESTORE:
        with core.db() as connection:
            connection.execute("CREATE INDEX IF NOT EXISTS operation_bike_active ON operation_records(kind,json_extract(body,'$.active'),id)")


def _pin(value):
    try:
        lat, lng = float(value['lat']), float(value['lng'])
        if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
            raise ValueError()
        return {'lat': lat, 'lng': lng}
    except (TypeError, KeyError, ValueError, OverflowError):
        raise ValueError('A valid geographic pin is required') from None


def cell(pin):
    pin = _pin(pin)
    return h3.latlng_to_cell(pin['lat'], pin['lng'], RESOLUTION)


def nearby_cells(pin, radius_metres=MAX_PICKUP_METRES):
    """Conservative 37-cell cover of a launch pickup circle, including pentagons.

    Resolution 6 plus three adjacency steps intentionally overfetches near hex
    boundaries. A final native-coordinate radius check removes overfetch. The
    launch pickup radius stays bounded at 4 km; the later 8 km trip allowance
    does not expand this pickup search.
    """
    if not 0 < radius_metres <= MAX_PICKUP_METRES:
        raise ValueError('Bike pickup search is limited to 4 km')
    return sorted(h3.grid_disk(cell(pin), 3))


def _lane(hexagon):
    return 'bike_dispatch_cell_' + hexagon


def index_availability(u, vehicle_id, position, online, available_at, now, *, driver_id=None, version=None, next_pickup_origin=None):
    """Call atomically with every native heartbeat, offline or ride state change."""
    pin = _pin(position) if position is not None else None
    previous = u.get('bike_dispatch_refs', vehicle_id)
    hexagon = cell(pin) if pin is not None else (previous or {}).get('cell')
    active = bool(online and pin is not None)
    previous_cells = set((previous or {}).get('cells') or list(filter(None, [(previous or {}).get('cell')])))
    current_cells = set(filter(None, [hexagon, cell(next_pickup_origin) if active and next_pickup_origin is not None else None]))
    for old_cell in sorted(previous_cells - current_cells):
        u.put(_lane(old_cell), vehicle_id, {'id': vehicle_id, 'vehicle_id': vehicle_id, 'active': False})
    for item in sorted(current_cells):
        # Keep exact coordinates in the native private heartbeat only.
        u.put(_lane(item), vehicle_id, {'id': vehicle_id, 'vehicle_id': vehicle_id,
                                       'active': active, 'seen_at': now,
                                       'available_at': available_at,
                                       'driver_id': driver_id, 'native_version': version})
    if current_cells:
        u.put('bike_dispatch_refs', vehicle_id, {'id': vehicle_id, 'cell': hexagon,
                                               'cells': sorted(current_cells), 'active': active, 'seen_at': now})
    changed = (previous_cells != current_cells or not previous or bool(previous.get('active')) != active
               or now-previous.get('seen_at', 0) > POSITION_MAX_AGE)
    # A stationary GPS heartbeat does not change cell membership. Native GPS is
    # still rechecked at every quote; avoid a shared document write per heartbeat.
    for item in sorted(previous_cells | current_cells) if changed else []:
        row = u.get('bike_dispatch_cell_versions', item) or {'version': 0}
        u.put('bike_dispatch_cell_versions', item, {'id': item, 'version': row['version'] + 1})


def candidate_ids(u, pickup, radius_metres, now, *, policy_version=1):
    """Bounded candidate IDs; never calls all(), stores GPS in cache or reserves."""
    from repaidians_work import active_query
    cells = nearby_cells(pickup, radius_metres)
    u.prefetch([('bike_dispatch_cell_versions', item) for item in cells])
    versions = tuple((item, (u.get('bike_dispatch_cell_versions', item) or {}).get('version', 0)) for item in cells)
    namespace = (id(u.core), str(getattr(u.core, 'DB_PATH', '')), str(getattr(getattr(u.core, 'fb_db', None), 'project', '')))
    key = (namespace, SCHEMA_VERSION, policy_version, cell(pickup), versions, int(now // CACHE_SECONDS))
    # A transaction's uncommitted projections must never escape into shared cache.
    dirty = any(kind.startswith('bike_dispatch_') for kind, _ in u.pending)
    with _CACHE_LOCK:
        cached = _CACHE.get(key) if not dirty else None
        if cached is not None:
            _CACHE.move_to_end(key)
            return list(cached)
    identifiers = []
    for item, version in versions:
        if not version:
            continue  # Empty cells need no second query after the batch metadata read.
        # Rotate a bounded sample rather than permanently favoring the first
        # vehicle IDs in a crowded cell. This does not grant booking priority.
        after = hashlib.sha256(f'{item}:{int(now//CACHE_SECONDS)}'.encode()).hexdigest()[:16]
        refs = active_query(u, _lane(item), CELL_LIMIT, after)
        if len(refs) < CELL_LIMIT:
            refs = list({row['id']: row for row in refs+active_query(u, _lane(item), CELL_LIMIT-len(refs))}.values())[:CELL_LIMIT]
        identifiers.extend(row['vehicle_id'] for row in refs
                           if -10 <= now - row.get('seen_at', 0) <= POSITION_MAX_AGE)
    identifiers = tuple(sorted(set(identifiers))[:MAX_CANDIDATES])
    if not dirty:
        with _CACHE_LOCK:
            _CACHE[key] = identifiers
            while len(_CACHE) > 256:
                _CACHE.popitem(last=False)
    return list(identifiers)


def google_pickup_route(origin, destination):
    """Actual Google TWO_WHEELER road distance/time; no synthetic provider label."""
    key = os.getenv('GOOGLE_ROUTES_API_KEY', '').strip()
    if not key:
        raise RuntimeError('Bike road routing is not configured')
    point = lambda p: {'location': {'latLng': {'latitude': p['lat'], 'longitude': p['lng']}}}
    body = {'origin': point(_pin(origin)), 'destination': point(_pin(destination)),
            'travelMode': 'TWO_WHEELER'}
    request = urllib.request.Request('https://routes.googleapis.com/directions/v2:computeRoutes',
                                     data=json.dumps(body).encode(), headers={
                                         'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
                                         'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'})
    with urllib.request.urlopen(request, timeout=4) as response:
        route = json.load(response)['routes'][0]
    distance, seconds = float(route['distanceMeters']), float(str(route['duration']).removesuffix('s'))
    if not math.isfinite(distance) or not math.isfinite(seconds) or not 0 <= distance <= 100000 or not 0 <= seconds <= 7200:
        raise ValueError('Invalid bike route response')
    return {'distance_metres': math.ceil(distance), 'duration_seconds': math.ceil(seconds), 'provider': 'google_routes'}


def rank_candidates(candidates, pickup, now, *, route_provider=None):
    """Rank private native rows outside transactions, rerank at most five by road.

    available_at is the current ride's server estimate. A busy rider's next
    origin is their current destination, not their moving GPS. The callback is
    injectable for tests; a missing/failed real route stays clearly estimated.
    """
    pickup = _pin(pickup)
    ranked = []
    for candidate in candidates[:MAX_CANDIDATES]:
        try:
            origin = _pin(candidate.get('next_pickup_origin') or candidate.get('position') or candidate.get('location'))
            deadhead = metres(origin, pickup)
            if deadhead > MAX_PICKUP_METRES:
                continue
            wait = min(3600, max(0, float(candidate.get('available_at', now)) - now))
            if candidate.get('available_at', now) > now + 3600:
                continue
            # 18 km/h planning speed plus 45 s boarding allowance, never traffic telemetry.
            eta = math.ceil(deadhead / 5 + 45)
            row = copy.deepcopy(candidate)
            row.update(pickup_distance_metres=round(deadhead), pickup_eta_seconds=eta,
                       available_in_seconds=math.ceil(wait), total_eta_seconds=math.ceil(wait) + eta,
                       route_source='distance_estimate')
            row['_dispatch_origin'] = origin
            ranked.append(row)
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    ranked.sort(key=lambda row: (row['total_eta_seconds'], row['pickup_distance_metres'], row['id']))
    provider = route_provider or (google_pickup_route if os.getenv('GOOGLE_ROUTES_API_KEY', '').strip() else None)
    def rerank(row, future):
        try:
            road = future.result(timeout=max(.001, deadline-time.monotonic()))
            duration, distance = float(road['duration_seconds']), float(road['distance_metres'])
            if road['provider'] != 'google_routes' or not math.isfinite(duration) or not math.isfinite(distance) or not 0 <= duration <= 7200 or not 0 <= distance <= 100000:
                raise ValueError('Invalid road provider result')
            row.update(pickup_distance_metres=math.ceil(distance), pickup_eta_seconds=math.ceil(duration),
                       total_eta_seconds=row['available_in_seconds'] + math.ceil(duration), route_source='google_routes')
        except Exception:
            # Discovery may remain approximate. A quote/booking must separately
            # require a confirmed customer journey route and current price.
            row['route_source'] = 'distance_estimate'
    if provider and ranked:
        from routing_cache import PICKUPS, cache_key, RoutingBusy
        deadline = time.monotonic()+4.5
        futures = []
        for row in ranked[:5]:
            try:
                key = cache_key('pickup', row['_dispatch_origin'], pickup,
                                str(id(provider))+hashlib.sha256(os.getenv('GOOGLE_ROUTES_API_KEY', '').encode()).hexdigest())
                origin = row['_dispatch_origin']
                futures.append((row, PICKUPS.submit(key, lambda origin=origin: provider(origin, pickup))))
            except RoutingBusy:
                continue  # Optional ETA work falls back to its labeled estimate.
        for row, future in futures:
            rerank(row, future)
    for row in ranked:
        row.pop('_dispatch_origin', None)
        # Explicit, explainable weights; no protected traits or fabricated demand.
        row['dispatch_score'] = round(row['total_eta_seconds'] + .015 * row['pickup_distance_metres'], 3)
    return sorted(ranked, key=lambda row: (row['dispatch_score'], row['id']))


def enqueue(u, ride, event_type):
    """Metadata-only outbox, committed in the same Unit as the native mutation.

    The per-rider stream sequence is also the reservation queue's accepted order.
    Order is defined by committed server transactions, never a client's clock or
    how long they keep a page open. A booking request must enqueue before it can
    be reserved by the consumer.
    """
    rider = str(ride.get('rider_id') or ride.get('driver_id') or '')
    if not rider:
        raise ValueError('A rider is required for ordered bike dispatch')
    identifier = hashlib.sha256(json.dumps([ride['id'], ride['version'], event_type], separators=(',', ':')).encode()).hexdigest()
    previous = u.get('bike_dispatch_outbox', identifier)
    if previous:
        return {key: value for key, value in previous.items() if key not in {'active', 'published'}}
    stream = u.get('bike_dispatch_streams', rider) or {'id': rider, 'next_sequence': 0, 'published_sequence': 0}
    sequence = stream['next_sequence'] + 1
    stamp = float(ride.get('updated_at') or ride.get('created_at') or time.time())
    event = {'id': identifier, 'schema_version': SCHEMA_VERSION, 'rider_id': rider,
             'ride_id': ride['id'], 'ride_version': ride['version'], 'event_type': event_type,
             'sequence': sequence, 'created_at': stamp}
    stream.update(next_sequence=sequence, active=True)
    u.put('bike_dispatch_streams', rider, stream)
    u.put('bike_dispatch_outbox', identifier, {**event, 'active': True, 'published': False})
    u.put('bike_dispatch_stream_events_' + hashlib.sha256(rider.encode()).hexdigest()[:24], f'{sequence:020d}',
          {'id': f'{sequence:020d}', 'event_id': identifier, 'active': True})
    return event


class RetryDispatch(RuntimeError):
    """Leave the broker offset uncommitted so the same partition can retry."""


def apply_event(store, event, callback):
    """One atomic dedup + authoritative reservation callback; no external I/O."""
    required = {'id', 'schema_version', 'rider_id', 'ride_id', 'ride_version', 'event_type', 'sequence', 'created_at'}
    if not isinstance(event, dict) or set(event) != required or event['schema_version'] != SCHEMA_VERSION or type(event['sequence']) is not int or event['sequence'] < 1:
        raise ValueError('Invalid bike dispatch envelope')
    expected_id = hashlib.sha256(json.dumps([event['ride_id'], event['ride_version'], event['event_type']], separators=(',', ':')).encode()).hexdigest()
    if event['id'] != expected_id or not isinstance(event['rider_id'], str) or not event['rider_id']:
        raise ValueError('Invalid bike dispatch identity')
    def transaction(u):
        durable = u.get('bike_dispatch_outbox', event['id'])
        if not durable or any(durable.get(key) != value for key, value in event.items()):
            raise ValueError('Bike dispatch does not match its committed outbox event')
        consumed = u.get('bike_dispatch_consumed', event['id'])
        if consumed:
            from bike_runtime import clear_failure
            clear_failure(u, event['rider_id'], event['id'])
            return {'duplicate': True, 'result': consumed.get('result')}
        stream = u.get('bike_dispatch_applied', event['rider_id']) or {'sequence': 0}
        if event['sequence'] != stream['sequence'] + 1:
            raise RetryDispatch('A preceding rider event has not committed')
        result = callback(u, copy.deepcopy(event))
        # Callback runs in the same retryable Unit as quota and rider locks.
        u.put('bike_dispatch_applied', event['rider_id'], {'id': event['rider_id'], 'sequence': event['sequence']})
        u.put('bike_dispatch_consumed', event['id'], {'id': event['id'], 'rider_id': event['rider_id'],
                                                   'sequence': event['sequence'], 'result': result})
        from bike_runtime import clear_failure
        clear_failure(u, event['rider_id'], event['id'])
        return {'duplicate': False, 'result': result}
    return store.run(transaction)


def configuration():
    """Pub/Sub is the production default; direct mode is explicit/local only."""
    mode = os.getenv('REPAIDO_BIKE_DISPATCH_MODE', 'pubsub').strip().lower()
    if mode == 'direct':
        cloud_runtime = any(os.getenv(name) for name in ('K_SERVICE', 'K_REVISION', 'K_CONFIGURATION', 'CLOUD_RUN_JOB', 'CLOUD_RUN_WORKER_POOL'))
        if os.getenv('REPAIDO_BIKE_DIRECT_DEV_ENABLED') == 'true' and os.getenv('REPAIDO_ENV') in {'test', 'local', 'development'} and not cloud_runtime:
            return {'mode': 'direct'}
        raise RuntimeError('Direct bike dispatch is allowed only in explicitly configured local development')
    if mode == 'pubsub':
        if os.getenv('PUBSUB_EMULATOR_HOST'):
            raise RuntimeError('Pub/Sub emulator fallback is disabled; use explicit local direct mode for development')
        topic = os.getenv('REPAIDO_BIKE_PUBSUB_TOPIC', '').strip()
        subscription = os.getenv('REPAIDO_BIKE_PUBSUB_SUBSCRIPTION', '').strip()
        region = os.getenv('REPAIDO_BIKE_PUBSUB_REGION', 'us-central1').strip()
        resource = r'projects/([a-z][a-z0-9-]{4,61}[a-z0-9])/{kind}s/([A-Za-z][A-Za-z0-9._~+%-]{2,254})'
        topic_match = re.fullmatch(resource.replace('{kind}', 'topic'), topic)
        subscription_match = re.fullmatch(resource.replace('{kind}', 'subscription'), subscription)
        if not topic_match or not subscription_match or topic_match[1] != subscription_match[1]:
            raise RuntimeError('Bike dispatch Pub/Sub topic and subscription must be configured in the same project')
        if not re.fullmatch(r'[a-z]+-[a-z]+[0-9]', region):
            raise RuntimeError('Invalid bike dispatch Pub/Sub regional endpoint')
        return {'mode': 'pubsub', 'topic': topic, 'subscription': subscription, 'region': region}
    if mode != 'kafka':
        raise RuntimeError('Unknown bike dispatch mode')
    bootstrap = os.getenv('REPAIDO_BIKE_KAFKA_BOOTSTRAP_SERVERS', '').strip()
    topic = os.getenv('REPAIDO_BIKE_KAFKA_TOPIC', 'repaido.bike.dispatch.v1').strip()
    if not bootstrap or any(not re.fullmatch(r'[A-Za-z0-9.-]+:[0-9]{1,5}', address) or not 1 <= int(address.rsplit(':', 1)[1]) <= 65535 for address in bootstrap.split(',')):
        raise RuntimeError('Bike dispatch Kafka bootstrap servers are not configured')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,200}', topic):
        raise RuntimeError('Invalid bike dispatch Kafka topic')
    protocol = os.getenv('REPAIDO_BIKE_KAFKA_SECURITY_PROTOCOL', 'SASL_SSL')
    if protocol not in {'SASL_SSL', 'SSL'}:
        raise RuntimeError('Bike dispatch Kafka must use TLS')
    config = {'bootstrap.servers': bootstrap, 'security.protocol': protocol, 'socket.timeout.ms': 5000,
              'client.id': 'repaido-bike-dispatch', 'allow.auto.create.topics': False,
              'ssl.endpoint.identification.algorithm': 'https'}
    if protocol == 'SASL_SSL':
        username, password = os.getenv('REPAIDO_BIKE_KAFKA_USERNAME'), os.getenv('REPAIDO_BIKE_KAFKA_PASSWORD')
        mechanism = os.getenv('REPAIDO_BIKE_KAFKA_SASL_MECHANISM', 'SCRAM-SHA-512')
        if not username or not password or mechanism not in {'SCRAM-SHA-512', 'SCRAM-SHA-256', 'PLAIN'}:
            raise RuntimeError('Bike dispatch Kafka authentication is not configured')
        config.update({'sasl.username': username, 'sasl.password': password, 'sasl.mechanism': mechanism})
    for environment, setting in [('REPAIDO_BIKE_KAFKA_CA_FILE', 'ssl.ca.location'),
                                 ('REPAIDO_BIKE_KAFKA_CERT_FILE', 'ssl.certificate.location'),
                                 ('REPAIDO_BIKE_KAFKA_KEY_FILE', 'ssl.key.location')]:
        if os.getenv(environment):
            config[setting] = os.environ[environment]
    return {'mode': 'kafka', 'topic': topic, 'client': config}


def _configuration_fingerprint(config):
    public = {key: config.get(key) for key in ('mode', 'topic', 'subscription', 'region')}
    if config['mode'] == 'kafka':
        public['bootstrap'] = config['client']['bootstrap.servers']
    return hashlib.sha256(json.dumps(public, sort_keys=True).encode()).hexdigest()


class PubSubAdapter:
    """Google's maintained client with real ordered publishing and pull delivery."""
    def __init__(self, config=None, *, publisher=None, subscriber=None):
        self.config = config or configuration()
        if self.config['mode'] != 'pubsub':
            raise RuntimeError('A Pub/Sub adapter requires Pub/Sub mode')
        # One private callback pool per subscriber. Broker flow control bounds
        # queued + executing callbacks; the database still owns event ordering
        # and idempotency. Invalid capacity must not silently expand throughput.
        try:
            self.callback_workers = int(os.getenv('REPAIDO_BIKE_DISPATCH_CALLBACK_WORKERS', '10'))
            self.max_messages = int(os.getenv('REPAIDO_BIKE_DISPATCH_MAX_MESSAGES', '32'))
        except ValueError:
            raise RuntimeError('Dispatch capacity must use whole numbers') from None
        if not 1 <= self.callback_workers <= 32 or not self.callback_workers <= self.max_messages <= 128:
            raise RuntimeError('Dispatch needs 1–32 workers and workers–128 outstanding messages')
        self.callback_pool = None
        from google.cloud import pubsub_v1
        endpoint = {'api_endpoint': self.config['region'] + '-pubsub.googleapis.com:443'}
        self.publisher = publisher or pubsub_v1.PublisherClient(
            publisher_options=pubsub_v1.types.PublisherOptions(enable_message_ordering=True), client_options=endpoint)
        self.subscriber = subscriber or pubsub_v1.SubscriberClient(client_options=endpoint)

    def ready(self):
        try:
            subscription = self.subscriber.get_subscription(request={'subscription': self.config['subscription']}, timeout=3)
            if subscription.topic != self.config['topic'] or not subscription.enable_message_ordering:
                return False
            publish = self.publisher.test_iam_permissions(request={'resource': self.config['topic'], 'permissions': ['pubsub.topics.publish']}, timeout=3)
            consume = self.subscriber.test_iam_permissions(request={'resource': self.config['subscription'], 'permissions': ['pubsub.subscriptions.consume']}, timeout=3)
            return 'pubsub.topics.publish' in publish.permissions and 'pubsub.subscriptions.consume' in consume.permissions
        except Exception:
            return False

    def publish(self, event):
        try:
            self.publisher.publish(self.config['topic'], json.dumps(event, separators=(',', ':'), sort_keys=True).encode(),
                                   ordering_key=event['rider_id'], schema_version=str(SCHEMA_VERSION)).result(timeout=10)
        except Exception:
            # Ordered publishing pauses a key after a failure. The durable
            # outbox retries the same event before any subsequent sequence.
            try:
                self.publisher.resume_publish(self.config['topic'], event['rider_id'])
            except Exception:
                pass
            raise RetryDispatch('Pub/Sub did not acknowledge dispatch delivery') from None

    def subscribe(self, callback):
        from google.cloud import pubsub_v1
        from google.cloud.pubsub_v1.subscriber.scheduler import ThreadScheduler
        if self.callback_pool is not None:
            raise RuntimeError('A dispatch adapter may only start one subscriber')
        self.callback_pool = ThreadPoolExecutor(max_workers=self.callback_workers, thread_name_prefix='bike-dispatch')
        return self.subscriber.subscribe(self.config['subscription'], callback=callback,
                 scheduler=ThreadScheduler(self.callback_pool),
                 flow_control=pubsub_v1.types.FlowControl(max_messages=self.max_messages, max_bytes=1024 * 1024, max_lease_duration=120),
                 await_callbacks_on_shutdown=True)

    def close(self):
        try:
            self.subscriber.close()
        finally:
            try:
                self.publisher.stop()
            finally:
                if self.callback_pool is not None:
                    self.callback_pool.shutdown(wait=True, cancel_futures=True)


class KafkaAdapter:
    """Maintained librdkafka client; delivery acknowledgment precedes outbox ack."""
    def __init__(self, config=None):
        self.config = config or configuration()
        if self.config['mode'] != 'kafka':
            raise RuntimeError('A Kafka adapter requires Kafka mode')
        from confluent_kafka import Producer
        self.producer = Producer({**self.config['client'], 'enable.idempotence': True, 'acks': 'all',
                                  'max.in.flight.requests.per.connection': 1,
                                  'delivery.timeout.ms': 10000, 'message.timeout.ms': 10000})

    def ready(self):
        try:
            metadata = self.producer.list_topics(topic=self.config['topic'], timeout=3)
            topic = metadata.topics.get(self.config['topic'])
            return bool(topic and not topic.error and topic.partitions and all(not partition.error for partition in topic.partitions.values()))
        except Exception:
            return False

    def publish(self, event):
        delivered = []
        self.producer.produce(self.config['topic'], key=event['rider_id'].encode(),
                              value=json.dumps(event, separators=(',', ':'), sort_keys=True).encode(),
                              on_delivery=lambda error, message: delivered.append(error))
        self.producer.flush(11)
        if not delivered or delivered[0] is not None:
            raise RetryDispatch('Kafka did not acknowledge dispatch delivery')

    def consumer(self):
        from confluent_kafka import Consumer
        consumer = Consumer({**self.config['client'], 'group.id': 'repaido-bike-reservations-v1',
                             'enable.auto.commit': False, 'enable.auto.offset.store': False,
                             'auto.offset.reset': 'earliest', 'isolation.level': 'read_committed',
                             'max.poll.interval.ms': 300000})
        consumer.subscribe([self.config['topic']])
        return consumer


def readiness(adapter=None):
    try:
        config = configuration()
        if config['mode'] == 'direct':
            return {'ready': True, 'mode': 'direct', 'production_ready': False}
        ready = (adapter or (PubSubAdapter(config) if config['mode'] == 'pubsub' else KafkaAdapter(config))).ready()
        return {'ready': bool(ready), 'mode': config['mode'], 'production_ready': bool(ready)}
    except Exception:
        return {'ready': False, 'mode': os.getenv('REPAIDO_BIKE_DISPATCH_MODE', 'pubsub'), 'production_ready': False}


def engine_health(u, now=None):
    """Safe admin/activation health from the actual continuous worker heartbeat.

    A configured hostname is insufficient. A dead worker or disconnected broker
    makes new bookings unavailable, while already committed rides stay readable.
    """
    stamp = time.time() if now is None else now
    try:
        config = configuration()
    except Exception:
        return {'ready': False, 'mode': os.getenv('REPAIDO_BIKE_DISPATCH_MODE', 'pubsub'), 'production_ready': False, 'configured': False,
                'worker_online': False, 'heartbeat_age_seconds': None, 'broker_connected': False,
                'outbox_backlog': None, 'consumer_lag': None, 'reason': 'dispatch_not_configured'}
    if config['mode'] == 'direct':
        return {'ready': True, 'mode': 'direct', 'production_ready': False, 'configured': True,
                'worker_online': False, 'heartbeat_age_seconds': None, 'broker_connected': False,
                'outbox_backlog': 0, 'consumer_lag': 0, 'reason': 'explicit_local_development'}
    from bike_runtime import pool_health
    return pool_health(u, config, stamp)


def drain_direct(store, callback, rider_id, *, limit=32):
    """Explicit test/local adapter exercises the same consumer reservation Unit.

    It is never selected when a production broker is down. Drain follow-up
    domain events as well, preserving per-rider sequence for the next request.
    """
    if configuration()['mode'] != 'direct':
        raise RuntimeError('Direct dispatch is disabled')
    applied = 0
    for _ in range(min(64, max(1, limit))):
        def next_event(u):
            sequence = (u.get('bike_dispatch_applied', rider_id) or {}).get('sequence', 0) + 1
            lane = 'bike_dispatch_stream_events_' + hashlib.sha256(rider_id.encode()).hexdigest()[:24]
            reference = u.get(lane, f'{sequence:020d}')
            if not reference:
                return None
            row = u.get('bike_dispatch_outbox', reference['event_id'])
            return {key: value for key, value in row.items() if key not in {'active', 'published'}}
        event = store.run(next_event)
        if event is None:
            break
        apply_event(store, event, callback)
        def acknowledge(u):
            row = u.get('bike_dispatch_outbox', event['id'])
            row.update(active=False, published=True)
            u.put('bike_dispatch_outbox', event['id'], row)
            stream = u.get('bike_dispatch_streams', rider_id)
            stream.update(published_sequence=max(stream['published_sequence'], event['sequence']),
                          active=event['sequence'] < stream['next_sequence'])
            u.put('bike_dispatch_streams', rider_id, stream)
        store.run(acknowledge)
        applied += 1
    return applied


def relay_once(store, adapter, *, owner, now=None, limit=16, cursor=None, time_budget=2):
    """Lease rider streams, send in sequence; restart/replay cannot lose an event."""
    from bike_runtime import RelayCursor, clear_failure, record_failure
    stamp = time.time() if now is None else now
    if cursor is None:
        scope = (id(store.core), str(getattr(store.core, 'DB_PATH', '')), owner)
        with _RELAY_LOCK:
            cursor = _RELAY_CURSORS.setdefault(scope, RelayCursor(owner))
            _RELAY_CURSORS.move_to_end(scope)
            while len(_RELAY_CURSORS) > 128:
                _RELAY_CURSORS.popitem(last=False)
    streams = store.run(lambda u: cursor.references(u, limit))
    deadline = time.monotonic()+time_budget
    sent = 0
    for reference in streams:
        if time.monotonic() >= deadline:
            break
        # Advance only through attempted keys. Advancing to the end of the
        # prefetched page would starve its tail whenever slow I/O exhausts the
        # pass budget while the first rider keeps adding events.
        cursor.after = reference['id']
        rider = reference['id']
        def claim(u):
            stream = u.get('bike_dispatch_streams', rider)
            if not stream or not stream.get('active') or (stream.get('lease_until', 0) > stamp and stream.get('lease_owner') != owner):
                return None
            sequence = stream['published_sequence'] + 1
            lane = 'bike_dispatch_stream_events_' + hashlib.sha256(rider.encode()).hexdigest()[:24]
            ref = u.get(lane, f'{sequence:020d}')
            if not ref:
                raise RetryDispatch('The next durable rider event is missing')
            outbox = u.get('bike_dispatch_outbox', ref['event_id'])
            if not outbox:
                raise RetryDispatch('The durable bike outbox event is missing')
            stream.update(lease_owner=owner, lease_until=stamp + 30)
            u.put('bike_dispatch_streams', rider, stream)
            return {key: value for key, value in outbox.items() if key not in {'active', 'published'}}
        event = None
        try:
            event = store.run(claim)
        except RetryDispatch:
            record_failure(store, rider, 'stream:'+rider, 'stream_incomplete', stamp)
            continue
        if event is None:
            continue
        try:
            adapter.publish(event)  # External I/O is always outside Store.run.
        except Exception:
            # Keep the lease/outbox and continue other rider keys. The SDK's
            # ordered publisher resumes this same event on its next retry.
            record_failure(store, rider, event['id'], 'publish_deferred', stamp)
            continue
        def acknowledge(u):
            stream = u.get('bike_dispatch_streams', rider)
            if stream.get('lease_owner') != owner or stream['published_sequence'] >= event['sequence']:
                return False
            stream.update(published_sequence=event['sequence'], active=event['sequence'] < stream['next_sequence'], lease_until=0)
            outbox = u.get('bike_dispatch_outbox', event['id'])
            outbox.update(active=False, published=True)
            u.put('bike_dispatch_outbox', event['id'], outbox)
            u.put('bike_dispatch_streams', rider, stream)
            incident = u.get('bike_dispatch_key_health', hashlib.sha256(rider.encode()).hexdigest()) or {}
            if incident.get('error_code') in ('publish_deferred', 'stream_incomplete'):
                clear_failure(u, rider, incident['event_id'], stamp)
            return True
        sent += int(store.run(acknowledge))
    return sent


def consume_once(store, consumer, callback, *, timeout=1):
    """Offset commit only after database success; failed record remains retriable."""
    message = consumer.poll(timeout)
    if message is None:
        return None
    if message.error():
        raise RetryDispatch('Kafka consumer reported an error')
    try:
        event = json.loads(message.value())
        if message.key() != str(event.get('rider_id', '')).encode():
            raise ValueError('Bike dispatch partition key does not match the rider')
        result = apply_event(store, event, callback)
        consumer.commit(message=message, asynchronous=False)
        return result
    except Exception:
        # poll() has advanced this consumer's in-memory cursor. Seek back as well
        # as withholding commit, so a continuing worker does not skip a failure.
        from confluent_kafka import TopicPartition
        consumer.seek(TopicPartition(message.topic(), message.partition(), message.offset()))
        raise


def consume_pubsub_message(store, message, callback):
    """Commit the actual reservation transaction before acknowledging delivery."""
    event = None
    try:
        if len(message.data) > 8192:
            raise ValueError('Dispatch envelope exceeds its bounded size')
        event = json.loads(message.data)
        if message.ordering_key != str(event.get('rider_id', '')):
            raise ValueError('Pub/Sub ordering key does not match the rider')
        result = apply_event(store, event, callback)
        message.ack()
        return result
    except Exception as error:
        message.nack()
        from bike_runtime import record_failure
        try:
            event_id = event.get('id') if isinstance(event, dict) else hashlib.sha256(message.data).hexdigest()
            record_failure(store, message.ordering_key, str(event_id)[:128],
                           'sequence_wait' if isinstance(error, RetryDispatch) else 'delivery_retry')
        except Exception:
            pass  # An unavailable database must never cause acknowledgment.
        raise
