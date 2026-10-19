"""Opt-in continuous Kafka relay/consumer. Run: python -m bike_kafka_worker.

This is a long-running worker process, not the existing minute scheduler. It
requires its own supervised runtime with CPU available between HTTP requests.
No broker, topic, infrastructure or credentials are created by this module.
"""
import logging
import os
import signal
import threading
import time
import uuid

from bike_dispatch import KafkaAdapter, _configuration_fingerprint, consume_once, relay_once

LOG = logging.getLogger('repaido.bike.dispatch')


def run(store, callback, *, adapter=None, stop=None):
    adapter = adapter or KafkaAdapter()
    stop = stop or threading.Event()
    consumer = adapter.consumer()
    owner = str(uuid.uuid4())
    status = {'relay_ok': False, 'consumer_ok': True, 'broker_connected': False}
    lock = threading.Lock()

    def relay():
        last_check, connected = 0, False
        while not stop.is_set():
            try:
                if time.monotonic() - last_check >= 10:
                    connected = adapter.ready()
                    last_check = time.monotonic()
                if connected:
                    relay_once(store, adapter, owner=owner)
                with lock:
                    status.update(relay_ok=connected, broker_connected=connected)
            except Exception:
                connected, last_check = False, 0
                with lock:
                    status.update(relay_ok=False, broker_connected=False)
                LOG.warning('Bike outbox relay deferred; durable records retained')
            stop.wait(.5)

    thread = threading.Thread(target=relay, name='bike-kafka-relay', daemon=True)
    thread.start()
    last_heartbeat = 0
    try:
        while not stop.is_set():
            try:
                result = consume_once(store, consumer, callback, timeout=.5)
                if result is not None:
                    with lock:
                        status['consumer_ok'] = True
            except Exception:
                with lock:
                    status['consumer_ok'] = False
                LOG.warning('Bike dispatch event deferred; offset retained for retry')
                stop.wait(1)
            now = time.time()
            if now - last_heartbeat >= 20:
                with lock:
                    connected = bool(status['relay_ok'] and status['consumer_ok'] and status['broker_connected'])
                # Bounded health work; unknown totals remain null, never invented.
                from repaidians_work import active_query
                def heartbeat(u):
                    streams = active_query(u, 'bike_dispatch_streams', 64)
                    lower_bound = sum(max(0, row['next_sequence'] - row['published_sequence']) for row in streams)
                    u.put('bike_dispatch_health', 'engine', {'id': 'engine', 'worker_id': owner,
                          'mode': 'kafka', 'configuration_fingerprint': _configuration_fingerprint(adapter.config),
                          'updated_at': now, 'broker_connected': connected,
                          'outbox_backlog': lower_bound, 'outbox_backlog_is_lower_bound': len(streams) == 64,
                          'consumer_lag': None})
                store.run(heartbeat)
                last_heartbeat = now
    finally:
        stop.set()
        consumer.close()
        thread.join(timeout=15)
        def offline(u):
            health = u.get('bike_dispatch_health', 'engine') or {}
            # A previous worker must not mark a newer healthy instance offline.
            if health.get('worker_id') == owner:
                health.update(updated_at=time.time(), broker_connected=False)
                u.put('bike_dispatch_health', 'engine', health)
        store.run(offline)


def main():
    if os.getenv('REPAIDO_BIKE_KAFKA_WORKER_ENABLED') != 'true':
        raise SystemExit('Set REPAIDO_BIKE_KAFKA_WORKER_ENABLED=true in the dedicated worker runtime')
    import main as core
    from bike_rides import consume_dispatch_event
    from bike_dispatch import initialize
    if os.getenv('REPAIDO_STORAGE', '').lower() == 'firestore' and not core.USE_FIRESTORE:
        raise SystemExit('Firestore unavailable; refusing ephemeral dispatch storage')
    core.operations_store.init()
    initialize(core)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    logging.basicConfig(level=logging.INFO)
    run(core.operations_store, consume_dispatch_event, stop=stop)


if __name__ == '__main__':
    main()
