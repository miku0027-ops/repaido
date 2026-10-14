import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import pytest
import main, captain_rewards as c
from test_operations import api, auth, PIN
from test_cleanup import report, command, submitted
from test_local_business import doc
from test_retail_checkout import seed
BASE='/operations/local-business/captain'

def grant(uid='customer',points=100,at=None):
    at=time.time() if at is None else at
    main.operations_store.run(lambda u:u.put('cleanup_points','fixture-'+uid,dict(id='fixture-'+uid,user_id=uid,points=points,created_at=at)))

def test_gold_expires_and_each_award_decays_without_resetting_old_points():
    start=1000000
    ledger=[dict(points=100,created_at=start)]
    for age,qualifying,rank,gold in [(0,100,100,True),(29,100,100,True),(30,0,100,False),(45,0,65,False),(60,0,30,False),(300,0,30,False)]:
        s=c.totals(ledger,start+age*c.DAY)
        assert (s['qualifying_points'],s['ranking_points'],s['gold'])==(qualifying,rank,gold)
        assert s['lifetime_points']==100
    ledger.append(dict(points=10,created_at=start+90*c.DAY))
    assert c.totals(ledger,start+90*c.DAY)['ranking_points']==40
    assert not c.totals(ledger,start+90*c.DAY)['gold']
    assert c.totals([dict(points=100,created_at=start+1)],start)['points']==0

def test_missing_caps_never_become_redeemable_and_repair_is_thirty(api):
    grant();data=api.get(BASE+'/me',headers=auth('customer')).json()
    assert len(data['factors'])>=20
    for offer in data['offers']:
        assert offer['available']==(offer['code']=='CAPTAINREFURB25')
        if offer['scope']=='visit':assert offer['bps']==3000
    for code,rule in c.OFFERS.items():
        if rule['cap_paise'] is None:
            with pytest.raises(Exception):main.operations_store.run(lambda u:c.reserve(u,'customer',code,rule['scope'],50000,'attempt'))
    assert main.operations_store.run(lambda u:u.all('captain_redemptions'))==[]

def test_atomic_once_per_thirty_days_cap_no_stacking_and_replay(api):
    grant();now=time.time()
    def use(reference):
        try:return main.operations_store.run(lambda u:c.reserve(u,'customer','CAPTAINREFURB25','refurbished',1000000,reference,now))
        except Exception:return None
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(use,['order-one','order-two']))
    assert sum(x is not None for x in results)==1
    snapshot=next(x for x in results if x);assert snapshot['discount_paise']==100000 and snapshot['funded_by']=='repaido'
    reference='order-one' if results[0] else 'order-two'
    assert use(reference)==snapshot
    assert not use('another')
    grant(at=now+31*c.DAY)
    renewed=main.operations_store.run(lambda u:c.reserve(u,'customer','CAPTAINREFURB25','refurbished',10000,'renewed',now+31*c.DAY))
    assert renewed['discount_paise']==2500
    assert not use('invalid-scope')

def test_profile_photo_ownership_privacy_optout_and_stale_writes(api):
    image=doc('customer')
    def save(**changes):
        body=dict(expected_version=0,name='Local Captain',photo_id=image,public=False);body.update(changes)
        return api.post(BASE+'/profile',headers=auth('customer'),json=body)
    assert save(photo_id=doc('worker')).status_code==422
    assert save().status_code==200
    public=f'{BASE}/avatar/{c.digest("public-captain:customer")}/{image}'
    assert api.get(public).status_code==404
    assert api.get(BASE+'/photo/'+image,headers=auth('stranger')).status_code==404
    assert save(public=True).status_code==409
    assert save(expected_version=1,public=True).status_code==200
    with patch('captain_rewards.download_object',return_value=b'photo'):
        assert api.get(public).content==b'photo'
        assert api.get(BASE+'/photo/'+image,headers=auth('customer')).content==b'photo'
    assert save(expected_version=2,public=False).status_code==200
    assert api.get(public).status_code==404
    assert api.post(BASE+'/profile',headers=auth('customer'),json=dict(expected_version=3,name='Name',public=True,city='Fake city')).status_code==422

def test_verified_rankings_do_not_expose_private_details(api):
    row=submitted(api);row=command(api,row,'verify',admin=True)[0].json()
    image=doc('customer')
    assert api.post(BASE+'/profile',headers=auth('customer'),json=dict(expected_version=0,name='Captain One',photo_id=image,public=True)).status_code==200
    leaderboard=api.get(BASE+'/leaderboard',headers=auth('customer')).json()
    assert leaderboard['city']=='Balasore' and leaderboard['participants']==1
    entry=leaderboard['entries'][0]
    assert entry['rank']==1 and entry['ranking_points']==10 and entry['mine']
    assert not {'customer_id','location','address','phone','document_ids','cash_received_paise'} & entry.keys()
    assert api.get(BASE+'/leaderboard',headers=auth('stranger')).json()['entries']==[]
    summary=api.get(BASE+'/me',headers=auth('customer')).json()
    assert all(x['passed'] for x in summary['awards'][0]['checks'])
    assert len(summary['awards'][0]['checks'])==18
    assert summary['cash_pending_paise']==5000 and summary['cash_received_paise']==0
    # A private before photo can never be repurposed as a public avatar.
    assert api.post(BASE+'/profile',headers=auth('customer'),json=dict(expected_version=1,name='Captain',photo_id=row['document_ids'][0],public=True)).status_code==422

def test_independent_contributor_needs_site_permission_and_independent_review(api):
    row=report(api)[0].json()
    assert command(api,row,'self_accept')[0].status_code==409
    row=command(api,row,'approve',admin=True,reference='safe-site-permission',allow_independent=True)[0].json()
    row=command(api,row,'self_accept')[0].json();assert row['owner_id']=='customer'
    row=command(api,row,'submit',document_ids=[doc('customer')],position={**PIN,'accuracy':5,'captured_at':time.time()},note='Delivered paper to authorised recycling centre')[0].json()
    assert command(api,row,'verify')[0].status_code==409
    result=command(api,row,'verify',admin=True)[0];assert result.status_code==200,result.text
    assert result.json()['points']==10

def test_refurb_reward_only_appliances_and_repaido_funds_seller(api,monkeypatch):
    import retail_checkout
    grant();seed()
    def stock(u):
        for id,cat in [('ref','appliances'),('new','appliances')]:
            p=u.get('inventory',id);p['category']=cat;u.put('inventory',id,p)
    main.operations_store.run(stock)
    basket=dict(items=[dict(product_id='ref',quantity=1),dict(product_id='new',quantity=1)],coupon_code='CAPTAINREFURB25')
    q=api.post('/operations/retail/quote',headers=auth('customer'),json=basket).json()
    assert q['discount_paise']==2500 and q['eligible_base_paise']==10000 and q['total_paise']==21100
    monkeypatch.setattr(retail_checkout,'payments_ready',lambda:True)
    def gateway(path,body=None):
        if path=='orders':return dict(id='order_captain',amount=21100,currency='INR')
        return dict(id='pay_captain',order_id='order_captain',amount=21100,currency='INR',status='captured',captured=True)
    monkeypatch.setattr(retail_checkout,'razorpay',gateway)
    body={**basket,'expected_total_paise':21100,'recipient_name':'Fixture Buyer','recipient_phone':'9876543210','delivery_address':'Fixture address near park','request_id':'captain-checkout-fixture'}
    created=api.post('/operations/retail/orders',headers=auth('customer'),json=body);assert created.status_code==201,created.text
    result=api.post('/operations/retail/orders/'+created.json()['id']+'/verify',headers=auth('customer'),json=dict(payment_id='pay_captain'));assert result.status_code==200,result.text
    payables=main.operations_store.run(lambda u:u.all('shop_payables'))
    assert sum(x['amount_paise'] for x in payables)==23600  # seller receives full amount
    assert api.post('/operations/retail/quote',headers=auth('customer'),json=basket).status_code==409

def test_wrong_category_and_expired_gold_cannot_use_appliance_reward(api):
    grant();seed()
    basket=dict(items=[dict(product_id='ref',quantity=1)],coupon_code='CAPTAINREFURB25')
    assert api.post('/operations/retail/quote',headers=auth('customer'),json=basket).status_code==422
    main.operations_store.run(lambda u:u.put('inventory','ref',{**u.get('inventory','ref'),'category':'appliances'}))
    grant(at=time.time()-30*c.DAY)
    assert api.post('/operations/retail/quote',headers=auth('customer'),json=basket).status_code==409
