"""Native registration/access tests. All payment providers are local fixtures."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
import main,shop_access
from test_operations import api,auth
BASE='/operations/shop/access'


def seed(*,days=1,uid='shop',sid='access-shop',approved=True,dated=True):
    s=dict(id=sid,owner_id=uid,name='Access fixture shop',status='approved' if approved else 'pending_verification',
           reviewed_by='independent-reviewer',verification=dict(identity_checked=True,business_checked=True,address_checked=True))
    if dated:s.update(created_at=time.time()-days*86400,submitted_at=time.time()-days*86400)
    main.operations_store.run(lambda u:u.put('shops',sid,s));return s


def gateway(monkeypatch):
    for key in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(key,'local-test')
    monkeypatch.setattr(shop_access,'payments_ready',lambda:True)
    orders={};payments={};calls=[]
    def send(path,body=None):
        calls.append((path,body))
        if path=='orders':
            oid='order_shop'+str(len(orders)+1);orders[oid]={**body,'id':oid};return orders[oid]
        if path.startswith('orders?receipt='):return {'items':[o for o in orders.values() if o['receipt']==path.split('=',1)[1]]}
        if path.startswith('orders/') and path.endswith('/payments'):return {'items':[{'id':p['id']} for p in payments.values() if p['order_id']==path.split('/')[1]]}
        if path.startswith('payments/'):return payments[path.split('/')[1]]
        raise AssertionError(path)
    monkeypatch.setattr(shop_access,'razorpay',send);return send,orders,payments,calls


def purchase(api,key=None):return api.post(BASE+'/order',headers=auth('shop'),json={'request_id':key or str(uuid.uuid4())})
def capture(o,payments,**changes):
    p=dict(id='pay_shop'+str(len(payments)+1),order_id=o['order_id'],amount=49900,currency='INR',status='captured',captured=True,amount_refunded=0)
    p.update(changes);payments[p['id']]=p;return p


def test_registration_trial_is_read_only_and_never_verifies_shop(api):
    s=seed(approved=False)
    a=api.get(BASE,headers=auth('shop')).json();b=api.get(BASE,headers=auth('shop')).json()
    assert a['active'] and a['status']=='trial' and a['trial_started_at']==b['trial_started_at']==s['created_at']
    assert a['trial_ends_at']-a['trial_started_at']==90*86400 and a['amount_paise']==49900 and not a['auto_renew']
    assert not main.operations_store.run(lambda u:shop_access.visible(u,s))
    assert not shop_access.verified(s)
    assert main.operations_store.run(lambda u:u.all('shop_access_members'))==[]
    assert api.get(BASE).status_code==401
    assert api.get(BASE,headers=auth('customer')).status_code==403


def test_fixed_legacy_migration_has_no_discount_and_no_badge(api):
    s=dict(id='legacy',owner_id='shop',status='approved',name='Historical shop')
    main.operations_store.run(lambda u:u.put('shops','legacy',s))
    a=api.get(BASE,headers=auth('shop')).json()
    assert a['trial_started_at']==shop_access.LEGACY_MIGRATION_AT and a['trial_source']=='legacy_migration'
    assert not a['default_offer_enabled'] and not shop_access.verified(s)
    assert main.operations_store.run(lambda u:shop_access.visible(u,s,shop_access.LEGACY_MIGRATION_AT+1))
    assert not main.operations_store.run(lambda u:shop_access.visible(u,s,shop_access.LEGACY_MIGRATION_AT+90*86400))


def test_default_offer_cannot_be_disabled_during_trial_but_can_after(api):
    seed()
    r=api.put(BASE+'/settings',headers=auth('shop'),json={'expected_version':0,'default_offer_enabled':False})
    assert r.status_code==409
    seed(days=91)
    r=api.put(BASE+'/settings',headers=auth('shop'),json={'expected_version':0,'default_offer_enabled':False})
    assert r.status_code==200 and not r.json()['default_offer_enabled'] and r.json()['settings_version']==1
    assert api.put(BASE+'/settings',headers=auth('shop'),json={'expected_version':0,'default_offer_enabled':True}).status_code==409


def test_approval_and_ownership_gate_payment(api,monkeypatch):
    gateway(monkeypatch);seed(approved=False)
    assert purchase(api).status_code==403
    assert api.post(BASE+'/check',headers=auth('worker'),json={'attempt_id':str(uuid.uuid4())}).status_code==403


def test_exact_provider_capture_grants_one_month_after_trial_and_durable_replay(api,monkeypatch):
    _,orders,payments,calls=gateway(monkeypatch);seed();key=str(uuid.uuid4())
    a=purchase(api,key).json();b=purchase(api).json()
    assert a==b and len(orders)==1 and a['amount']==49900
    p=capture(a,payments)
    r=api.post(BASE+'/check',headers=auth('shop'));assert r.status_code==200,r.text
    state=r.json();member=main.operations_store.run(lambda u:u.get('shop_access_members','access-shop'));g=member['grants'][0]
    assert g['starts_at']==state['trial_ends_at'] and g['ends_at']==shop_access.month_after(g['starts_at'])
    assert api.post(BASE+'/check',headers=auth('shop')).json()['current_period_ends_at']==g['ends_at']
    assert purchase(api,key).json()['settled'] and len(orders)==1
    assert any(path=='payments/'+p['id'] for path,_ in calls)
    assert main.operations_store.run(lambda u:u.get('receipts',p['id']))['kind']=='shop_access'


@pytest.mark.parametrize('change',[{'amount':49899},{'currency':'USD'},{'captured':False},{'amount_refunded':True}])
def test_invalid_capture_does_not_grant(api,monkeypatch,change):
    _,_,payments,_=gateway(monkeypatch);seed(days=91);a=purchase(api).json();capture(a,payments,**change)
    r=api.post(BASE+'/check',headers=auth('shop'))
    assert r.status_code in (200,409)
    assert not api.get(BASE,headers=auth('shop')).json()['active']
    assert main.operations_store.run(lambda u:u.get('shop_access_members','access-shop')) is None


def test_lost_order_response_reconciles_same_receipt_without_second_post(api,monkeypatch):
    send,orders,payments,calls=gateway(monkeypatch);seed(days=91);key=str(uuid.uuid4())
    def lost(path,body=None):
        result=send(path,body)
        if path=='orders':raise RuntimeError('local fixture: reply lost after provider commit')
        return result
    monkeypatch.setattr(shop_access,'razorpay',lost)
    with pytest.raises(RuntimeError):purchase(api,key)
    monkeypatch.setattr(shop_access,'razorpay',send)
    result=purchase(api,key);assert result.status_code==200,result.text
    assert len(orders)==1 and len([p for p,_ in calls if p=='orders'])==1
    capture(result.json(),payments)
    assert api.post(BASE+'/check',headers=auth('shop')).json()['active']


def test_refund_revokes_only_affected_grant_and_cannot_be_resurrected(api,monkeypatch):
    _,_,payments,_=gateway(monkeypatch);seed(days=91)
    first=purchase(api).json();p=capture(first,payments)
    api.post(BASE+'/check',headers=auth('shop'))
    second=purchase(api).json();capture(second,payments);api.post(BASE+'/check',headers=auth('shop'))
    member=main.operations_store.run(lambda u:u.get('shop_access_members','access-shop'));assert len(member['grants'])==2
    p.update(amount_refunded=1)
    api.post(BASE+'/check',headers=auth('shop'),json={'attempt_id':first['attempt_id']})
    assert len(main.operations_store.run(lambda u:u.get('shop_access_members','access-shop'))['grants'])==1
    p.update(amount_refunded=0,status='captured')
    api.post(BASE+'/check',headers=auth('shop'),json={'attempt_id':first['attempt_id']})
    assert len(main.operations_store.run(lambda u:u.get('shop_access_members','access-shop'))['grants'])==1
    assert main.operations_store.run(lambda u:u.get('shop_access_payments',first['attempt_id']))['status']=='refunded'


def test_prime_remains_separate_and_never_grants_verification(api):
    s=seed(days=91);now=time.time()
    main.operations_store.run(lambda u:u.put('shop_prime',s['id'],dict(status='active',starts_at=now-1,ends_at=now+100)))
    state=api.get(BASE,headers=auth('shop')).json()
    assert state['active'] and state['current_period_ends_at']==now+100
    assert main.operations_store.run(lambda u:u.get('shop_access_members',s['id'])) is None


def test_captured_request_replay_precedes_twelve_month_purchase_cap(api,monkeypatch):
    _,orders,payments,_=gateway(monkeypatch);seed(days=91);key=str(uuid.uuid4());first=purchase(api,key).json()
    capture(first,payments);api.post(BASE+'/check',headers=auth('shop'))
    def cap(u):
        member=u.get('shop_access_members','access-shop');g=member['grants'][0]
        member['grants'] += [dict(attempt_id=str(uuid.uuid4()),payment_id='pay_fixture'+str(i),starts_at=g['ends_at']+i*4000000,ends_at=g['ends_at']+(i+1)*4000000) for i in range(11)]
        u.put('shop_access_members','access-shop',member)
    main.operations_store.run(cap)
    assert purchase(api,key).json()['settled'] and len(orders)==1
    assert purchase(api).status_code==409


def test_receipt_reuse_across_financial_namespaces_is_rejected(api,monkeypatch):
    _,_,payments,_=gateway(monkeypatch);seed(days=91);first=purchase(api).json();p=capture(first,payments)
    main.operations_store.run(lambda u:u.put('receipts',p['id'],dict(id=p['id'],kind='retail')))
    assert api.post(BASE+'/check',headers=auth('shop')).status_code==409
    assert not api.get(BASE,headers=auth('shop')).json()['active']


def test_suspended_shop_keeps_financial_access_but_never_public_visibility(api,monkeypatch):
    _,_,payments,_=gateway(monkeypatch);s=seed(days=91);first=purchase(api).json();capture(first,payments)
    api.post(BASE+'/check',headers=auth('shop'))
    def suspend(u):
        row=u.get('shops',s['id']);row['status']='suspended';u.put('shops',s['id'],row);return row
    suspended=main.operations_store.run(suspend)
    assert api.get(BASE,headers=auth('shop')).json()['active']
    assert not main.operations_store.run(lambda u:shop_access.visible(u,suspended))
    assert purchase(api).status_code==403


def test_concurrent_checkout_reserves_only_one_order(api,monkeypatch):
    _,orders,_,calls=gateway(monkeypatch);seed(days=91)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:purchase(api),range(2)))
    assert all(r.status_code in (200,503) for r in results)
    assert len(orders)==1 and len([p for p,_ in calls if p=='orders'])==1


def test_new_purchase_fills_refund_gap_without_losing_prepaid_month(api,monkeypatch):
    _,_,payments,_=gateway(monkeypatch);seed(days=91)
    first=purchase(api).json();p=capture(first,payments);api.post(BASE+'/check',headers=auth('shop'))
    second=purchase(api).json();capture(second,payments);api.post(BASE+'/check',headers=auth('shop'))
    before=main.operations_store.run(lambda u:u.get('shop_access_members','access-shop'))['grants']
    future=next(g for g in before if g['attempt_id']==second['attempt_id'])
    p.update(amount_refunded=49900,status='refunded');api.post(BASE+'/check',headers=auth('shop'),json={'attempt_id':first['attempt_id']})
    assert main.operations_store.run(lambda u:u.get('shop_access_members','access-shop'))['grants']==[future]
    third=purchase(api).json();capture(third,payments);api.post(BASE+'/check',headers=auth('shop'))
    after=main.operations_store.run(lambda u:u.get('shop_access_members','access-shop'))['grants']
    added=next(g for g in after if g['attempt_id']==third['attempt_id']);moved=next(g for g in after if g['attempt_id']==second['attempt_id'])
    assert added['starts_at'] <= time.time() < added['ends_at']
    assert added['ends_at']==shop_access.month_after(added['starts_at'])
    assert moved['starts_at']==added['ends_at'] and moved['ends_at']==shop_access.month_after(moved['starts_at'])
    assert main.operations_store.run(lambda u:any(a['action']=='ShopPrepaidMonthMoved' for a in u.all('audit')))


def test_tick_recovers_lost_order_once_and_throttles_pending_attempt(api,monkeypatch):
    send,orders,payments,calls=gateway(monkeypatch);seed(days=91)
    def lost(path,body=None):
        result=send(path,body)
        if path=='orders':raise RuntimeError('fixture lost reply')
        return result
    monkeypatch.setattr(shop_access,'razorpay',lost)
    with pytest.raises(RuntimeError):purchase(api)
    monkeypatch.setattr(shop_access,'razorpay',send)
    first=main.shop_access_tick();assert first=={'attempted':1,'errors':0}
    assert main.shop_access_tick()=={'attempted':0,'errors':0}
    attempt=main.operations_store.run(lambda u:u.all('shop_access_payments'))[0]
    assert attempt['order_id']==next(iter(orders)) and len(orders)==1


def test_public_visibility_uses_only_entitlement_intervals_not_owner_payment_status(api):
    now=time.time();shop=seed(days=1)
    class PublicReads:
        def __init__(self,rows=None):self.rows=rows or {};self.calls=[]
        def get(self,kind,key):
            assert kind in ('shop_access_members','shop_prime'),'Public visibility accessed private billing metadata: '+kind
            self.calls.append((kind,key));return self.rows.get((kind,key))
    trial=PublicReads();assert shop_access.visible(trial,shop,now) and trial.calls==[]
    expired={**shop,'created_at':now-91*86400}
    inactive=PublicReads();assert not shop_access.visible(inactive,expired,now)
    assert len(inactive.calls)==2
    paid=PublicReads({('shop_access_members',shop['id']):{'grants':[dict(starts_at=now-1,ends_at=now+100)]}})
    assert shop_access.visible(paid,expired,now) and paid.calls==[('shop_access_members',shop['id'])]
    prime=PublicReads({('shop_prime',shop['id']):dict(status='active',starts_at=now-1,ends_at=now+100)})
    assert shop_access.visible(prime,expired,now)
    assert not shop_access.visible(PublicReads(),{**shop,'status':'suspended'},now)


def test_public_shop_profile_does_not_read_private_owner_payment_records(api,monkeypatch):
    import operations
    from test_shop_discovery import seed as seed_discovery
    seed_discovery()
    forbidden={'shop_access_accounts','shop_access_payments','shop_access_requests','shop_access_orders',
               'receipts','payments','retail_orders','rental_payments'}
    original_get=operations.Unit.get;original_prefetch=operations.Unit.prefetch
    def public_get(self,kind,key):
        assert kind not in forbidden,'Public profile read private billing namespace: '+kind
        return original_get(self,kind,key)
    def public_prefetch(self,pairs):
        rows=list(pairs)
        assert not any(kind in forbidden for kind,_ in rows),'Public profile prefetched private billing records'
        return original_prefetch(self,rows)
    monkeypatch.setattr(operations.Unit,'get',public_get)
    monkeypatch.setattr(operations.Unit,'prefetch',public_prefetch)
    result=api.get('/operations/shops/s1/profile')
    assert result.status_code==200,result.text
    assert result.json()['shop']['verified']
    assert {p['id']:p['price_paise'] for p in result.json()['catalogue']}=={'switch':4750,'wire':9500}
