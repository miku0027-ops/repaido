#!/usr/bin/env python3
"""Isolated durable-dispatch contention/replay evidence; no remote target option.

Uses a temporary SQLite store and an in-memory broker with deliberate duplicate
delivery, lost publish acknowledgements and a failed rider transaction. This
checks transport invariants, not Google Pub/Sub throughput or a journey SLA.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from operations import Store
from repaidians_work import active_query
import bike_dispatch as dispatch
import bike_runtime as runtime


def positive(value):
    result=int(value)
    if not 1<=result<=512: raise argparse.ArgumentTypeError('Use 1-512')
    return result


def exercise(path,riders,workers):
    @contextmanager
    def database():
        with sqlite3.connect(path,timeout=15) as connection:
            connection.row_factory=sqlite3.Row
            connection.execute('PRAGMA journal_mode=WAL')
            yield connection
    core=SimpleNamespace(USE_FIRESTORE=False,DB_PATH=str(path),db=database)
    store=Store(core);store.init();dispatch.initialize(core)
    def seed(u):
        for rider in range(riders):
            for sequence in range(4):
                dispatch.enqueue(u,{'id':f'fixture-{rider}-{sequence}','version':1,'rider_id':f'rider-{rider:05}',
                                    'updated_at':time.time()},'booking_requested')
    store.run(seed)
    lock=threading.Lock();broker=defaultdict(list);lost=set();deferred=set();latencies=[]
    class Broker:
        def publish(self,event):
            with lock:
                broker[event['rider_id']].append(event)
                # The event reached the broker but the producer lost its ACK.
                if int(event['rider_id'].split('-')[-1])%7==0 and event['id'] not in lost:
                    lost.add(event['id'])
                    raise OSError('Fixture lost acknowledgement')
    adapter=Broker(); cursors=[runtime.RelayCursor(str(index)) for index in range(workers)]
    start=time.perf_counter()
    for turn in range(30):
        def relay(index):
            return dispatch.relay_once(store,adapter,owner=f'fixture-worker-{index}',cursor=cursors[index],
                                       now=1000+turn*31,limit=32,time_budget=10)
        with ThreadPoolExecutor(max_workers=workers) as pool: list(pool.map(relay,range(workers)))
        if not store.run(lambda u:active_query(u,'bike_dispatch_streams',1)): break
    else: raise AssertionError('Outbox did not drain within bounded passes')
    def apply(u,event):
        if event['rider_id']=='rider-00000' and event['id'] not in deferred:
            deferred.add(event['id'])
            raise OSError('Fixture transient database failure')
        row=u.get('fixture_applied',event['rider_id']) or {'count':0}
        row['count']+=1
        u.put('fixture_applied',event['rider_id'],row)
        return {'applied':True}
    def consume(pair):
        rider,events=pair
        for event in events:
            before=time.perf_counter()
            try: dispatch.apply_event(store,event,apply)
            except OSError:
                runtime.record_failure(store,rider,event['id'],'native_commit_failed')
                dispatch.apply_event(store,event,apply)
            # A lost subscriber ACK replays after commit, with no second effect.
            assert dispatch.apply_event(store,event,apply)['duplicate']
            with lock:latencies.append((time.perf_counter()-before)*1000)
    with ThreadPoolExecutor(max_workers=workers) as pool:list(pool.map(consume,list(broker.items())))
    def verify(u):
        for rider in range(riders):
            identifier=f'rider-{rider:05}'
            assert u.get('fixture_applied',identifier)['count']==4
            assert u.get('bike_dispatch_applied',identifier)['sequence']==4
            assert not runtime.rider_blocked(u,identifier)
    store.run(verify)
    ordered=sorted(latencies)
    return {'scope':'temporary SQLite; in-memory fault-injecting broker; native ordered callback transactions',
            'production_capacity_claim':False,'riders':riders,'workers':workers,'events':riders*4,
            'publish_acknowledgements_lost':len(lost),'failed_callback_replays':len(deferred),
            'elapsed_seconds':round(time.perf_counter()-start,3),
            'commit_with_duplicate_check_ms':{name:round(ordered[int((len(ordered)-1)*fraction)],3)
                                             for name,fraction in [('p50',.5),('p95',.95),('p99',.99)]},
            'correctness':'All rider sequences committed once; no lost events; no residual rider holds'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--riders',type=positive,default=128)
    parser.add_argument('--workers',type=positive,default=8)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if os.getenv('K_SERVICE'):parser.error('Never run this local harness in a deployed service')
    if args.workers>32:parser.error('Keep local workers at most 32')
    with tempfile.TemporaryDirectory(prefix='repaido-bike-load-') as directory:
        result=exercise(Path(directory)/'fixture.db',args.riders,args.workers)
    rendered=json.dumps(result,indent=2)+'\n'
    if args.output:args.output.write_text(rendered)
    print(rendered,end='')


if __name__=='__main__':main()
