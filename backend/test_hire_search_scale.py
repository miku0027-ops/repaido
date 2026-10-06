"""Search stays scoped as unrelated worker and job collections grow."""
import json
from unittest.mock import patch
import main
from operations import Unit
from test_hiring_records import setup_hire
from test_operations import api,PIN


def test_directory_and_live_hire_avoid_global_worker_job_scans(api,monkeypatch):
    setup_hire(api,monkeypatch)
    # Ten thousand other-city workers and jobs must not be materialized by these reads.
    with main.db() as conn:
        rows=[]
        for i in range(10000):
            worker=f'other-{i}'
            rows.extend((('workers',worker,json.dumps({'id':worker,'city':'Elsewhere','online':False,'status':'approved'})),
                         ('jobs','job-'+worker,json.dumps({'id':'job-'+worker,'worker_id':worker,'state':'completed'}))))
        conn.executemany('INSERT INTO operation_records(kind,id,body) VALUES(?,?,?)',rows)
        city=conn.execute("EXPLAIN QUERY PLAN SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.city')=?",('workers','Balasore')).fetchall()
        online=conn.execute("EXPLAIN QUERY PLAN SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.online')=?",('workers',1)).fetchall()
        jobs=conn.execute("EXPLAIN QUERY PLAN SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.worker_id') IN (?)",('jobs','worker')).fetchall()
        offers=conn.execute("EXPLAIN QUERY PLAN SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.worker_id')=?",('professional_offers','worker')).fetchall()
    assert 'operation_workers_city' in str([r['detail'] for r in city])
    assert 'operation_workers_online' in str([r['detail'] for r in online])
    assert 'operation_jobs_worker' in str([r['detail'] for r in jobs])
    assert 'operation_offers_worker' in str([r['detail'] for r in offers])
    original=Unit.all
    def forbid_global(self,kind):
        if kind in ('workers','jobs','hires','professional_offers'):
            raise AssertionError('Search read the whole '+kind+' collection')
        return original(self,kind)
    with patch.object(Unit,'all',forbid_global):
        ranked=api.post('/operations/hiring/leaderboard',json={'city':'Balasore','category':'ac'})
        assert ranked.status_code==200,ranked.text
        assert ranked.json()['professionals'][0]['id']=='worker'
        live=api.post('/operations/hiring/search',json={'location':PIN,'category':'ac','radius_km':6})
        assert live.status_code==200,live.text
        assert live.json()['professionals'][0]['id']=='worker'
    assert 'Elsewhere' not in ranked.text


def test_indexed_unit_reads_include_pending_writes(api,monkeypatch):
    setup_hire(api,monkeypatch)
    def check(u):
        worker=u.get('workers','worker')
        assert worker in u.find('workers','city','Balasore')
        worker['city']='Bhadrak';u.put('workers',worker['id'],worker)
        assert worker not in u.find('workers','city','Balasore')
        assert worker in u.find('workers','city','Bhadrak')
        job={'id':'future','worker_id':worker['id'],'state':'completed'}
        u.put('jobs','future',job)
        assert job in u.for_workers('jobs',[worker['id']])
    main.operations_store.run(check)


def test_public_browse_cache_coalesces_and_expires():
    from concurrent.futures import ThreadPoolExecutor
    from hire_discovery import BrowseCache
    from threading import Barrier
    import time
    cache=BrowseCache(ttl=.2,max_entries=2)
    calls=[];barrier=Barrier(8)
    def load():
        calls.append(1);time.sleep(.04);return {'professionals':[{'name':'Live professional'}]}
    def read():
        barrier.wait();return cache.get_or_load('balasore:ac',load)
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows=list(pool.map(lambda _:read(),range(8)))
    assert len(calls)==1 and all(r['professionals'][0]['name']=='Live professional' for r in rows)
    rows[0]['professionals'][0]['name']='Client mutation'
    assert cache.get_or_load('balasore:ac',load)['professionals'][0]['name']=='Live professional'
    time.sleep(.22)
    cache.get_or_load('balasore:ac',load)
    assert len(calls)==2
    cache.get_or_load('another',load);cache.get_or_load('third',load)
    assert len(cache.rows)==2


def test_firestore_profile_prefetch_batches_reads_and_preserves_pending_writes():
    class Ref:
        def __init__(self,path):self.path=path
        def get(self,transaction=None):raise AssertionError('Per-profile Firestore read escaped prefetch')
    class Snapshot:
        def __init__(self,ref):self.reference=ref;self.exists=True
        def to_dict(self):return {'id':self.reference.path.rsplit('/',1)[-1]}
    class Db:
        calls=[]
        def get_all(self,refs,transaction=None):
            self.calls.append((len(refs),transaction))
            return (Snapshot(ref) for ref in refs)
    class Core:
        fb_db=Db()
        def fs_doc(self,kind,key):return Ref(kind+'/'+key)
    tx=object();unit=Unit(Core(),transaction=tx)
    pairs=[('worker_profiles',str(i)) for i in range(201)]
    unit.prefetch(pairs+pairs[:2])
    assert unit.core.fb_db.calls==[(200,tx),(1,tx)]
    assert unit.get('worker_profiles','0')=={'id':'0'}
    unit.put('worker_profiles','0',{'id':'0','bio':'Updated'})
    assert unit.get('worker_profiles','0')['bio']=='Updated'
