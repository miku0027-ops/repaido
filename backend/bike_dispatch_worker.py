"""Supervised, restartable pull workers with independent pool membership."""
import logging
import os
import random
import signal
import threading
import time
import uuid

from bike_dispatch import PubSubAdapter, configuration, consume_pubsub_message, relay_once
from bike_runtime import RelayCursor, heartbeat, maintenance
from bike_worker_health import WorkerPulse, health_server, load_quota_secret

LOG = logging.getLogger('repaido.bike.dispatch')


def run_pubsub(store, callback, *, adapter=None, stop=None, owner=None, pulse=None):
    adapter = adapter or PubSubAdapter()
    stop = stop or threading.Event()
    owner = owner or str(uuid.uuid4())
    pulse = pulse or WorkerPulse()
    cursor, stream = RelayCursor(owner), None

    def receive(message):
        try:
            consume_pubsub_message(store, message, callback)
        except Exception:
            LOG.warning('Bike event deferred; ordered native record retained')

    last_probe, last_heartbeat, last_maintenance = None, None, None
    connected, idle = False, .25
    try:
        stream = adapter.subscribe(receive)
        while not stop.is_set():
            now = time.time()
            pulse.touch()
            if stream.done():
                raise RuntimeError('The Pub/Sub streaming subscriber stopped')
            if last_probe is None or time.monotonic()-last_probe >= 30:
                connected = bool(adapter.ready())
                last_probe = time.monotonic()
            try:
                sent = relay_once(store, adapter, owner=owner, cursor=cursor) if connected else 0
            except Exception:
                connected, last_probe, sent = False, None, 0
                LOG.warning('Bike relay unavailable; durable outbox retained')
            if last_heartbeat is None or now-last_heartbeat >= 20:
                from repaidians_work import active_query
                def write_health(u):
                    streams = active_query(u, 'bike_dispatch_streams', 64)
                    backlog = sum(max(0, row['next_sequence']-row['published_sequence']) for row in streams)
                    heartbeat(u, owner, adapter.config, connected=connected, now=now,
                              backlog=backlog, partial=len(streams) == 64)
                store.run(write_health)
                last_heartbeat = now
            pulse.touch(ready=connected)
            if last_maintenance is None or now-last_maintenance >= 15:
                try:
                    maintenance(store.core, owner, now)
                except Exception:
                    LOG.warning('Bike maintenance deferred; native deadlines retained')
                last_maintenance = now
            idle = .25 if sent else min(2, idle*1.4)
            stop.wait(idle)
    finally:
        pulse.touch(ready=False)
        try:
            store.run(lambda u: heartbeat(u, owner, adapter.config, connected=False, draining=True))
        except Exception:
            LOG.warning('Worker membership will expire naturally')
        if stream is not None:
            stream.cancel()
            try:
                stream.result(timeout=30)
            except Exception:
                pass
        adapter.close()


def supervise(store, callback, *, stop=None, pulse=None, adapter_factory=PubSubAdapter, jitter=None):
    stop, pulse = stop or threading.Event(), pulse or WorkerPulse()
    owner, failures = str(uuid.uuid4()), 0
    jitter = jitter or random.SystemRandom().uniform
    while not stop.is_set():
        pulse.touch(ready=False)
        try:
            run_pubsub(store, callback, adapter=adapter_factory(), stop=stop, owner=owner, pulse=pulse)
            failures = 0
        except Exception:
            failures = min(6, failures+1)
            LOG.warning('Restarting dispatch connection; durable work is preserved')
        if not stop.is_set():
            pulse.touch(ready=False)
            stop.wait(jitter(.5, min(30, 2**failures)))


def main():
    if os.getenv('REPAIDO_BIKE_DISPATCH_WORKER_ENABLED') != 'true':
        raise SystemExit('Enable this entry point only in the dedicated worker runtime')
    load_quota_secret()
    import main as core
    from bike_rides import consume_dispatch_event
    from bike_dispatch import initialize
    if os.getenv('REPAIDO_STORAGE', '').lower() != 'firestore' or not core.USE_FIRESTORE:
        raise SystemExit('The deployed dispatch worker requires shared Firestore storage')
    core.operations_store.init()
    initialize(core)
    stop, pulse = threading.Event(), WorkerPulse()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    logging.basicConfig(level=logging.INFO)
    port = int(os.getenv('REPAIDO_BIKE_HEALTH_PORT', '9118'))
    if not 1 <= port <= 65535:
        raise SystemExit('Invalid private health port')
    server = health_server(pulse, port)
    try:
        if configuration()['mode'] == 'pubsub':
            supervise(core.operations_store, consume_dispatch_event, stop=stop, pulse=pulse)
        elif configuration()['mode'] == 'kafka':
            from bike_kafka_worker import run
            run(core.operations_store, consume_dispatch_event, stop=stop)
        else:
            raise SystemExit('The continuous worker requires an explicit production transport')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
