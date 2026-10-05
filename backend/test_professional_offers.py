"""Own-account publication, public eligibility and exact per-visit arithmetic."""
import time
import main, home_plans
from test_operations import api, auth
from test_home_plans import setup_worker, request, quote, decision

def publish(api, **changes):
    body=dict(service_id='maid',percent=15,ends_at=time.time()+86400)
    body.update(changes)
    return api.post('/operations/worker/home-offers',headers=auth('worker'),json=body)

def test_owner_approval_expiry_and_public_visibility(api):
    setup_worker(api)
    assert api.post('/operations/worker/home-offers',headers=auth('customer'),json=dict(service_id='maid',percent=15,ends_at=time.time()+86400)).status_code==403
    for change in ({'service_id':'contractor'},{'percent':51},{'percent':1.5},{'ends_at':time.time()-1},{'ends_at':time.time()+100*86400}):
        assert publish(api,**change).status_code==422
    r=publish(api);assert r.status_code==200,r.text
    offer=r.json()
    catalog=api.get('/operations/home/catalog?city=Balasore').json()
    assert next(s for s in catalog['services'] if s['id']=='maid')['offers'][0]['bps']==1500
    assert not any(s['offers'] for s in api.get('/operations/home/catalog?city=Bhadrak').json()['services'])
    assert api.delete('/operations/worker/home-offers/'+offer['id'],headers=auth('stranger')).status_code==403
    r=publish(api,percent=10);assert r.status_code==200
    live=next(s for s in api.get('/operations/home/catalog?city=Balasore').json()['services'] if s['id']=='maid')['offers']
    assert len(live)==1 and live[0]['bps']==1000
    assert api.delete('/operations/worker/home-offers/'+r.json()['id'],headers=auth('worker')).status_code==200
    assert not any(s['offers'] for s in api.get('/operations/home/catalog?city=Balasore').json()['services'])

def test_exact_quote_invoice_and_frozen_terms(api):
    setup_worker(api);r=publish(api,percent=17);assert r.status_code==200
    p,_=request(api);p=quote(api,p,period_price_paise=70003)
    offer=p['quote']['professional_offer']
    expected=sum(v['base_paise']*1700//10000 for v in p['visits'])
    assert offer['discount_paise']==expected
    assert offer['discounted_base_paise']==70003-expected
    api.delete('/operations/worker/home-offers/'+r.json()['id'],headers=auth('worker'))
    p=decision(api,p,'accept');p=decision(api,p,'accept','worker')
    def jobs(u):
        stored=u.get('home_plans',p['id'])
        for v in stored['visits']:
            home_plans.make_job(u,stored,v,time.time())
            j=u.get('jobs',v['job_id']);j['state']='completed';j['payment_status']='verified';u.put('jobs',j['id'],j)
        u.put('home_plans',p['id'],stored)
        return [u.get('jobs',v['job_id']) for v in stored['visits']],home_plans.invoices(u,stored)
    rows,invoices=main.operations_store.run(jobs)
    assert sum(j['vendor_discount_paise'] for j in rows)==expected
    assert sum(j['total_paise'] for j in rows)==70003+(70003*1800+5000)//10000-expected
    assert invoices[0]['total_paise']==sum(j['total_paise'] for j in rows)
    assert all(j['professional_offer']['id']==offer['id'] for j in rows)
    from integrations import settlement
    payouts=main.operations_store.run(lambda u:[settlement(u,j['id']) for j in rows])
    assert sum(s['vendor_discount_paise'] for s in payouts)==expected
    assert all(s['net_paise']==s['gross_paise']-s['vendor_discount_paise'] for s in payouts)
    assert sum(s['gst_payable_paise'] for s in payouts)==(70003*1800+5000)//10000
    p2,_=request(api,start_date=(home_plans.iso_today()+home_plans.timedelta(days=10)).isoformat());p2=quote(api,p2)
    assert 'professional_offer' not in p2['quote']

def test_offer_first_period_only_and_no_coupon_stacking(api):
    setup_worker(api);assert publish(api).status_code==200
    p,_=request(api,duration='month3');p=quote(api,p)
    p=decision(api,p,'accept');p=decision(api,p,'accept','worker')
    def read(u):
        stored=u.get('home_plans',p['id']);v=next(v for v in stored['visits'] if v['period']==1)
        home_plans.make_job(u,stored,v,time.time());return u.get('jobs',v['job_id'])
    assert not main.operations_store.run(read).get('vendor_discount_paise')
    p2,_=request(api)
    main.operations_store.run(lambda u:u.put('home_plans',p2['id'],{**u.get('home_plans',p2['id']),'coupon':{'bps':500}}))
    def release(u):
        stored=u.get('home_plans',p['id']);stored['state']='cancelled';u.put('home_plans',p['id'],stored)
        for j in u.all('jobs'):
            j['state']='cancelled';u.put('jobs',j['id'],j)
    main.operations_store.run(release)
    p2=quote(api,p2);assert 'professional_offer' not in p2['quote']

def test_expired_or_unreviewed_offer_hidden(api):
    setup_worker(api);offer=publish(api).json()
    def expire(u):
        row=u.get('professional_offers',offer['id']);row['ends_at']=time.time()-1;u.put('professional_offers',offer['id'],row)
    main.operations_store.run(expire)
    assert not any(s['offers'] for s in api.get('/operations/home/catalog?city=Balasore').json()['services'])
    assert publish(api).status_code==200
    def revoke(u):
        a=u.get('home_availability','worker');a['approved_services']=[];u.put('home_availability','worker',a)
    main.operations_store.run(revoke)
    assert not any(s['offers'] for s in api.get('/operations/home/catalog?city=Balasore').json()['services'])
