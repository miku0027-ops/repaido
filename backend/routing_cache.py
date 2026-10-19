"""Short-lived, bounded provider reads with single-flight and circuit breaking.

No fares, quotas, account records or reservation decisions are cached here.
Separate journey/ETA pools keep optional discovery work from taking every route
slot. Precise routes stay in process memory, under opaque keys, for seconds.
"""
import copy
import hashlib
import json
import threading
import time
import urllib.error
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor


class RoutingBusy(RuntimeError):
    pass


def cache_key(purpose, origin, destination, identity=''):
    return hashlib.sha256(json.dumps([purpose, origin, destination, identity], sort_keys=True,
                                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def service_failure(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code == 429 or error.code >= 500
    return isinstance(error, (OSError, TimeoutError))


class RouteReads:
    def __init__(self, *, workers=4, pending=8, entries=64, ttl=20, max_bytes=4*1024*1024, clock=time.monotonic):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='bounded-route')
        self.slots, self.lock = threading.BoundedSemaphore(pending), threading.Lock()
        self.entries, self.ttl, self.clock = entries, ttl, clock
        self.max_bytes, self.cached_bytes = max_bytes, 0
        self.cache, self.pending = OrderedDict(), {}
        self.failures, self.open_until, self.probing = 0, 0, False
        self.counters = {'hits': 0, 'coalesced': 0, 'started': 0, 'rejected': 0}

    def submit(self, key, load):
        with self.lock:
            now = self.clock()
            for expired in [name for name, entry in self.cache.items() if now-entry[0] >= self.ttl]:
                self.cached_bytes -= self.cache.pop(expired)[2]
            entry = self.cache.get(key)
            if entry and now-entry[0] < self.ttl:
                self.cache.move_to_end(key)
                self.counters['hits'] += 1
                future = Future()
                future.set_result(copy.deepcopy(entry[1]))
                return future
            if key in self.pending:
                self.counters['coalesced'] += 1
                return self.pending[key]
            if self.open_until > now or self.open_until and self.probing or not self.slots.acquire(blocking=False):
                self.counters['rejected'] += 1
                raise RoutingBusy('Routing is busy; retry shortly')
            if self.open_until:
                self.probing = True
            try:
                future = self.pool.submit(load)
            except Exception:
                self.slots.release()
                self.probing = False
                raise
            self.pending[key] = future
            self.counters['started'] += 1

        def complete(done):
            try:
                value, error = done.result(), None
            except Exception as failure:
                value, error = None, failure
            with self.lock:
                self.pending.pop(key, None)
                self.probing = False
                if error is None:
                    self.failures, self.open_until = 0, 0
                    # The provider caps point counts, and this second bound keeps
                    # a few long polylines from retaining unbounded memory.
                    try:
                        weight = len(json.dumps(value, allow_nan=False, separators=(',', ':')).encode())
                    except (TypeError, ValueError):
                        weight = self.max_bytes+1
                    if weight <= self.max_bytes:
                        previous = self.cache.pop(key, None)
                        self.cached_bytes -= previous[2] if previous else 0
                        self.cache[key] = (self.clock(), copy.deepcopy(value), weight)
                        self.cached_bytes += weight
                        while len(self.cache) > self.entries or self.cached_bytes > self.max_bytes:
                            self.cached_bytes -= self.cache.popitem(last=False)[1][2]
                elif service_failure(error):
                    self.failures += 1
                    if self.failures >= 3:
                        self.open_until = self.clock()+15
            self.slots.release()
        future.add_done_callback(complete)
        return future

    def read(self, key, load, timeout=9):
        return copy.deepcopy(self.submit(key, load).result(timeout=timeout))

    def snapshot(self):
        with self.lock:
            return {**self.counters, 'inflight': len(self.pending), 'cached': len(self.cache),
                    'cached_bytes': self.cached_bytes, 'max_cached_bytes': self.max_bytes,
                    'circuit_open': self.open_until > self.clock()}

    def close(self):
        self.pool.shutdown(wait=True, cancel_futures=True)


JOURNEYS = RouteReads(workers=4, pending=8, entries=64, ttl=20)
PICKUPS = RouteReads(workers=4, pending=8, entries=128, ttl=15)
