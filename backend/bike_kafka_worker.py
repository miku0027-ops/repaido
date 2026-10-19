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
from bike_runtime import RelayCursor, heartbeat as record_heartbeat

LOG = logging.getLogger('repaido.bike.dispatch')


def run(store, callback, *, adapter=None, stop=None):
    adapter = adapter or KafkaAdapter()
    stop = stop or threading.Event()
    consumer = adapter.consumer()
    owner = str(uuid.uuid4())
    cursor = RelayCursor(owner)
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
                    relay_once(store, adapter, owner=owner, cursor=cursor)
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
                    record_heartbeat(u, owner, adapter.config, connected=connected, now=now,
                                     backlog=lower_bound, partial=len(streams) == 64)
                store.run(heartbeat)
                last_heartbeat = now
    finally:
        stop.set()
        consumer.close()
        thread.join(timeout=15)
        def offline(u):
            record_heartbeat(u, owner, adapter.config, connected=False, draining=True)
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
