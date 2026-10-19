"""Exact review projection and bounded legacy migration without lifetime scans."""
import json
from concurrent.futures import ThreadPoolExecutor
import pytest
import catalog_ratings as ratings
from operations import Unit
from test_bike_dispatch import store


def job(identifier, rating=5, **values):
    return {'id':identifier, 'service_id':'cleaning', 'customer_id':'customer', 'state':'completed',
            'review':{'customer_id':'customer', 'rating':rating, 'verified_booking':True}, **values}


def test_verified_reviews_project_once_and_handle_edits_reopen_and_service_change(store):
    store.run(lambda u:u.put('jobs', 'a', job('a')))
    store.run(lambda u:u.put('jobs', 'a', job('a')))
    assert store.run(lambda u:ratings.read(u, ['cleaning'])) == {'cleaning':(5, 1)}
    store.run(lambda u:u.put('jobs', 'a', job('a', 3)))
    assert store.run(lambda u:ratings.read(u, ['cleaning'])) == {'cleaning':(3, 1)}
    store.run(lambda u:u.put('jobs', 'a', job('a', 3, service_id='plumbing')))
    assert store.run(lambda u:ratings.read(u, ['cleaning', 'plumbing'])) == {'cleaning':(0, 0), 'plumbing':(3, 1)}
    store.run(lambda u:u.put('jobs', 'a', job('a', 3, service_id='plumbing', state='disputed')))
    assert store.run(lambda u:ratings.read(u, ['plumbing'])) == {'plumbing':(0, 0)}


def test_backfill_is_bounded_and_live_updates_cannot_double_count(store, monkeypatch):
    store.core.operations_store = store
    with store.core.db() as connection:
        connection.executemany('INSERT INTO operation_records VALUES (?,?,?)',
                               [('jobs', f'{index:04}', json.dumps(job(f'{index:04}'))) for index in range(70)])
    monkeypatch.setattr(Unit, 'all', lambda *_: (_ for _ in ()).throw(AssertionError('Lifetime scan')))
    clock={'now':1000}; monkeypatch.setattr(ratings.time, 'time', lambda:clock['now'])
    state=ratings.advance(store.core, limit=32)
    assert not state['ready'] and state['processed']==32
    store.run(lambda u:u.put('jobs', '0050', job('0050', 2)))
    clock['now']+=3; state=ratings.advance(store.core, limit=32)
    assert not state['ready'] and state['processed']==64
    clock['now']+=3; state=ratings.advance(store.core, limit=32)
    assert state['ready'] and state['processed']==70
    assert store.run(lambda u:ratings.read(u, ['cleaning'])) == {'cleaning':(347, 70)}
    assert ratings.advance(store.core, limit=32)==state


def test_concurrent_reviews_and_failed_transaction_preserve_exact_counts(store):
    def write(index): store.run(lambda u:u.put('jobs', str(index), job(str(index), index%5+1)))
    with ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(write, range(80)))
    assert store.run(lambda u:ratings.read(u, ['cleaning'])) == {'cleaning':(240, 80)}
    def rollback(u):
        u.put('jobs', '0', job('0', 5))
        assert ratings.read(u, ['cleaning'])['cleaning']==(244, 80)
        raise RuntimeError('Fixture transaction rollback')
    with pytest.raises(RuntimeError): store.run(rollback)
    assert store.run(lambda u:ratings.read(u, ['cleaning'])) == {'cleaning':(240, 80)}


@pytest.mark.parametrize('review', [{'rating':5}, {'rating':5,'customer_id':'other','verified_booking':True}, {'rating':True,'customer_id':'customer','verified_booking':True}, {'rating':9,'customer_id':'customer','verified_booking':True}])
def test_unverified_wrong_customer_and_invalid_reviews_never_count(store, review):
    store.run(lambda u:u.put('jobs','a',job('a',review=review)))
    assert store.run(lambda u:ratings.read(u,['cleaning'])) == {'cleaning':(0,0)}
