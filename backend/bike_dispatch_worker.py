"""Continuous ordered Pub/Sub dispatch runtime: python -m bike_dispatch_worker.

Needs a supervised worker with CPU available continuously. It never creates a
topic/subscription, grants IAM or starts a cloud resource. Infrastructure and
runtime activation are separate, explicit release operations.
"""
import logging
import os
import signal
import threading
import time
import uuid

from bike_dispatch import (PubSubAdapter, _configuration_fingerprint, configuration,
                           consume_pubsub_message, relay_once)

LOG = logging.getLogger('repaido.bike.dispatch')


def run_pubsub(store, callback, *, adapter=None, stop=None):
    adapter = adapter or PubSubAdapter()
    stop = stop or threading.Event()
    owner = str(uuid.uuid4())
    failed_rider_keys = set()
    lock = threading.Lock()

    def receive(message):
        try:
            consume_pubsub_message(store, message, callback)
            with lock:
                failed_rider_keys.discard(message.ordering_key)
        except Exception:
            with lock:
                failed_rider_keys.add(message.ordering_key)
            LOG.warning('Bike reservation deferred; Pub/Sub delivery was not acknowledged')

    stream = adapter.subscribe(receive)
    last_probe, last_heartbeat, connected = 0, 0, False
    try:
        while not stop.is_set():
            now = time.time()
            if stream.done():
                raise RuntimeError('The Pub/Sub streaming subscriber stopped')
            if time.monotonic() - last_probe >= 10:
                connected = adapter.ready()
                last_probe = time.monotonic()
            try:
                if connected:
                    relay_once(store, adapter, owner=owner)
            except Exception:
                connected, last_probe = False, 0
                LOG.warning('Bike outbox delivery deferred; durable events retained')
            if now - last_heartbeat >= 20:
                with lock:
                    healthy = connected and not failed_rider_keys
                from repaidians_work import active_query
                def heartbeat(u):
                    streams = active_query(u, 'bike_dispatch_streams', 64)
                    backlog = sum(max(0, row['next_sequence'] - row['published_sequence']) for row in streams)
                    u.put('bike_dispatch_health', 'engine', {'id': 'engine', 'worker_id': owner,
                          'mode': 'pubsub', 'configuration_fingerprint': _configuration_fingerprint(adapter.config),
                          'updated_at': now, 'broker_connected': bool(healthy),
                          'outbox_backlog': backlog, 'outbox_backlog_is_lower_bound': len(streams) == 64,
                          'consumer_lag': None})
                store.run(heartbeat)
                last_heartbeat = now
            stop.wait(.5)
    finally:
        stop.set()
        stream.cancel()
        try:
            stream.result(timeout=15)
        except Exception:
            pass
        adapter.close()
        def offline(u):
            health = u.get('bike_dispatch_health', 'engine') or {}
            if health.get('worker_id') == owner:
                health.update(updated_at=time.time(), broker_connected=False)
                u.put('bike_dispatch_health', 'engine', health)
        store.run(offline)


def main():
    if os.getenv('REPAIDO_BIKE_DISPATCH_WORKER_ENABLED') != 'true':
        raise SystemExit('Set REPAIDO_BIKE_DISPATCH_WORKER_ENABLED=true in the dedicated continuous worker runtime')
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
    if configuration()['mode'] == 'pubsub':
        run_pubsub(core.operations_store, consume_dispatch_event, stop=stop)
    elif configuration()['mode'] == 'kafka':
        # Compatibility adapter is explicit; production defaults to Pub/Sub.
        from bike_kafka_worker import run
        run(core.operations_store, consume_dispatch_event, stop=stop)
    else:
        raise SystemExit('The continuous worker requires Pub/Sub or explicitly configured Kafka')


if __name__ == '__main__':
    main()
