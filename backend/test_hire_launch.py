import time
import main,hiring,hire_discovery
from test_operations import api,onboard,auth
from test_hire_discovery import browse,seed_reviews

def campaign(monkeypatch):
    monkeypatch.setattr(hiring,'free_listing',lambda:True)
    monkeypatch.setattr(hire_discovery,'free_listing',lambda:True)

def test_fixed_offer_boundaries(monkeypatch):
    for instant,expected in [(hiring.FREE_START-1,False),(hiring.FREE_START,True),(hiring.FREE_END-1,True),(hiring.FREE_END,False)]:
        monkeypatch.setattr(hiring.time,'time',lambda:instant)
        assert hiring.free_listing() is expected

def test_free_approved_listing_without_payment_and_expiry(api,monkeypatch):
    campaign(monkeypatch);onboard(api)
    assert browse(api)['professionals'][0]['id']=='worker'
    r=api.post('/operations/worker/hire-membership/accept',headers=auth('worker'),json={'version':hiring.DEFAULT['version'],'radius_km':10,'consent':True})
    assert r.status_code==200,r.text
    assert api.post('/operations/worker/hire-membership/payment-order',headers=auth('worker')).json()['detail']['code']=='FREE_LISTING_ACTIVE'
    assert not main.operations_store.run(lambda u:u.all('hire_fees'))
    monkeypatch.setattr(hiring,'free_listing',lambda:False);monkeypatch.setattr(hire_discovery,'free_listing',lambda:False)
    assert not browse(api)['professionals']

def test_weekly_rank_real_work_ties_reset_and_auth(api,monkeypatch):
    campaign(monkeypatch);onboard(api);onboard(api,'worker2')
    assert api.get('/operations/hiring/my-weekly-rank').status_code==401
    assert api.get('/operations/hiring/my-weekly-rank',headers=auth('customer')).status_code==403
    get=lambda:api.get('/operations/hiring/my-weekly-rank',headers=auth('worker')).json()
    assert all(c['rank'] is None for c in get()['categories'])
    main.operations_store.run(lambda u:(seed_reviews(u,'worker',[5]),seed_reviews(u,'worker2',[5])))
    rank=next(c for c in get()['categories'] if c['category']=='ac');assert rank=={'category':'ac','rank':1,'participants':2,'completed':1,'reviews':1}
    main.operations_store.run(lambda u:seed_reviews(u,'worker2',[5]))
    assert next(c for c in get()['categories'] if c['category']=='ac')['rank']==2
    boundary=get()['starts_at']
    def old(u):
        for j in u.all('jobs'):j['completed_at']=boundary-1;u.put('jobs',j['id'],j)
    main.operations_store.run(old)
    assert all(c['rank'] is None for c in get()['categories'])

def test_unapproved_profiles_stay_private(api,monkeypatch):
    campaign(monkeypatch);onboard(api)
    def suspend(u):
        w=u.get('workers','worker');w['status']='pending';u.put('workers',w['id'],w)
    main.operations_store.run(suspend)
    assert not browse(api)['professionals']
