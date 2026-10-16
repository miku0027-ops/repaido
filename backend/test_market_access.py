"""Native access/billing regression tests; provider calls are local fixtures only."""
import hashlib
import io
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from PIL import Image

import main
import market_access
import marketplace
from test_operations import api, auth, ADMIN, PIN
from test_marketplace import draft

BASE = '/operations/market/access'


def checkout(api,uid='worker',request_id=None):
    return api.post(BASE+'/order',headers=auth(uid),json={'request_id':request_id or str(uuid.uuid4())})


def read(uid='worker'):
    return main.operations_store.run(lambda u: market_access.access_status(u, uid))


def expire(uid='worker'):
    main.operations_store.run(lambda u: u.put('market_access_trials', uid,
        dict(id=uid, starts_at=time.time() - 91 * 86400, policy=market_access.POLICY)))


def gateway(monkeypatch):
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED', 'true')
    for key in ('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'):
        monkeypatch.setenv(key, 'test-only')
    orders, payments, calls = {}, {}, []
    def provider(path, body=None):
        calls.append((path, body))
        if path == 'orders':
            oid = 'order_fixture' + str(len(orders) + 1)
            orders[oid] = {**body, 'id': oid}
            return orders[oid]
        if path.startswith('orders?receipt='):
            return {'items': [row for row in orders.values() if row['receipt'] == path.split('=', 1)[1]]}
        if path.startswith('orders/') and path.endswith('/payments'):
            oid = path.split('/')[1]
            return {'items': [{'id': row['id']} for row in payments.values() if row['order_id'] == oid]}
        if path.startswith('payments/'):
            return payments[path.split('/')[1]]
        raise AssertionError(path)
    monkeypatch.setattr(market_access, 'razorpay', provider)
    return provider, orders, payments, calls


def captured(order, payments, *, suffix='1', **changes):
    pid = 'pay_fixture' + suffix
    payments[pid] = {**dict(id=pid, order_id=order['order_id'], status='captured', captured=True,
                           amount=9900, currency='INR', amount_refunded=0), **changes}
    return payments[pid]


def test_status_read_never_starts_trial_and_explicit_activation_is_idempotent(api):
    before = main.operations_store.run(lambda u: u.all('market_access_trials'))
    for _ in range(2):
        state = api.get(BASE, headers=auth('worker')).json()
        assert not state['active'] and state['status'] == 'not_started'
        assert state['trial_started_at'] is None and state['trial_ends_at'] is None
        assert state['amount_paise'] == 9900 and state['trial_days'] == 90 and not state['auto_renew']
    assert main.operations_store.run(lambda u: u.all('market_access_trials')) == before
    a = api.post(BASE + '/trial', headers=auth('worker')).json()
    b = api.post(BASE + '/trial', headers=auth('worker')).json()
    assert a['status'] == 'trial' and a['trial_started_at'] == b['trial_started_at']
    assert a['trial_ends_at'] - a['trial_started_at'] == 90 * 86400
    assert api.get(BASE).status_code == 401


def test_trial_is_shared_between_exchange_and_secondhand_not_reset_by_close(api):
    a, _ = draft(api, trial=True)
    b, _ = draft(api, trial=True, mode='second_hand')
    assert a['fee_paise'] == b['fee_paise'] == 0
    assert a['expires_at'] == b['expires_at'] == read()['trial_ends_at']
    assert a['access_policy'] == market_access.POLICY
    api.post('/operations/market/' + a['id'] + '/close', headers=auth('worker'))
    c, _ = draft(api, trial=True)
    assert c['expires_at'] == a['expires_at']


def test_photo_trial_starts_only_after_valid_photo_is_acknowledged_and_saved(api,monkeypatch):
    headers={**auth('worker'),'Content-Type':'image/jpeg'}
    monkeypatch.delenv('REPAIDO_KYC_BUCKET',raising=False)
    assert api.post('/operations/market/photos',headers=headers,content=b'invalid').status_code==503
    assert read()['status']=='not_started'
    monkeypatch.setenv('REPAIDO_KYC_BUCKET','test-only-local-bucket')
    assert api.post('/operations/market/photos',headers=headers,content=b'invalid').status_code==422
    assert read()['status']=='not_started'
    data=io.BytesIO();Image.new('RGB',(20,20),'blue').save(data,format='JPEG')
    def failed(key,content):
        raise RuntimeError('Test provider unavailable')
    monkeypatch.setattr(marketplace,'upload_object',failed)
    assert api.post('/operations/market/photos',headers=headers,content=data.getvalue()).status_code==503
    assert read()['status']=='not_started'
    saved=[]
    monkeypatch.setattr(marketplace,'upload_object',lambda key,content:saved.append(key))
    a=api.post('/operations/market/photos',headers=headers,content=data.getvalue())
    assert a.status_code==200 and len(saved)==1
    state=read();assert state['status']=='trial' and state['trial_ends_at']-state['trial_started_at']==90*86400
    assert main.operations_store.run(lambda u:u.get('market_photos',a.json()['id']))['owner_id']=='worker'
    assert api.post('/operations/market/photos',headers=headers,content=data.getvalue()).status_code==200
    assert read()['trial_started_at']==state['trial_started_at']
    assert api.post('/operations/market/photos',headers={**auth('customer'),'Content-Type':'image/jpeg'},content=data.getvalue()).status_code==403
    assert read('customer')['status']=='not_started'


def test_legacy_earliest_trial_is_derived_readonly_and_extended_to90_without_restart(api):
    now = time.time()
    starts = now - 45 * 86400
    def seed(u):
        for mode, start in (('exchange', starts), ('second_hand', now - 10 * 86400)):
            key = hashlib.sha256(('worker:' + mode).encode()).hexdigest()
            u.put('market_trials', key, dict(id=key, claimed_at=start))
    main.operations_store.run(seed)
    state = api.get(BASE, headers=auth('worker')).json()
    assert state['status'] == 'trial' and state['trial_started_at'] == starts
    assert state['trial_ends_at'] == starts + 90 * 86400
    assert main.operations_store.run(lambda u: u.get('market_access_trials', 'worker')) is None
    state = api.post(BASE + '/trial', headers=auth('worker')).json()
    assert state['trial_started_at'] == starts
    expire()
    assert api.post(BASE + '/trial', headers=auth('worker')).json()['status'] == 'expired'


def test_expiry_blocks_new_upload_create_contact_and_publish_but_keeps_browse_history(api, monkeypatch):
    a, body = draft(api, trial=True, mode='second_hand')
    b, _ = draft(api, uid='worker2', trial=True, mode='second_hand')
    expire()
    assert api.post('/operations/market/photos', headers=auth('worker'), content=b'photo').status_code == 402
    assert api.post('/operations/market/listings', headers=auth('worker'), json={**body, 'request_id':'new-listing-id-12345'}).status_code == 402
    assert api.post('/operations/market/' + a['id'] + '/publish-free', headers=auth('worker')).status_code == 402
    assert api.post('/operations/market/' + a['id'] + '/radius', headers=auth('worker'),json={'radius_km':20}).status_code == 402
    assert api.get('/operations/market/' + b['id'] + '/contact', headers=auth('worker')).status_code == 402
    # Exact replay of an existing command is recovery, never another publish.
    assert api.post('/operations/market/listings', headers=auth('worker'), json=body).json()['id'] == a['id']
    own = api.get('/operations/market/mine', headers=auth('worker')).json()['listings']
    assert own[0]['status'] == 'expired'
    public = api.post('/operations/market/search', json={'mode':'second_hand','location':PIN}).json()['items']
    assert [x['id'] for x in public] == [b['id']]


def test_paid_order_provider_get_exact_amount_calendar_period_and_no_capture_replay(api, monkeypatch):
    _, orders, payments, calls = gateway(monkeypatch)
    assert checkout(api).status_code == 409
    api.post(BASE + '/trial', headers=auth('worker'))
    expire()
    a = checkout(api).json()
    b = checkout(api).json()
    assert a == b and len(orders) == 1 and a['amount'] == 9900
    assert next(iter(orders.values()))['receipt'].startswith('ma_')
    p = captured(a, payments)
    assert api.post(BASE + '/check', headers=auth('worker2'), json={'attempt_id':a['attempt_id']}).status_code == 404
    state = api.post(BASE + '/check', headers=auth('worker')).json()
    assert state['active'] and state['status'] == 'paid'
    member = main.operations_store.run(lambda u: u.get('market_access_members','worker'))
    grant = member['grants'][0]
    assert grant['ends_at'] == market_access.month_after(grant['starts_at'])
    for _ in range(2):
        assert api.post(BASE + '/check', headers=auth('worker')).json()['current_period_ends_at'] == grant['ends_at']
    assert len(main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']) == 1
    assert any(path == 'payments/' + p['id'] for path, _ in calls)


def test_early_paid_month_starts_after90_day_trial_and_calendar_clamps_month_end(api, monkeypatch):
    _, _, payments, _ = gateway(monkeypatch)
    trial = api.post(BASE + '/trial', headers=auth('worker')).json()
    order = checkout(api).json()
    captured(order, payments)
    state = api.post(BASE + '/check', headers=auth('worker')).json()
    grant = main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants'][0]
    assert state['status'] == 'trial' and grant['starts_at'] == trial['trial_ends_at']
    assert state['current_period_ends_at'] == grant['ends_at']
    jan31 = datetime(2027, 1, 31, 9, 30, tzinfo=ZoneInfo('Asia/Kolkata')).timestamp()
    end = datetime.fromtimestamp(market_access.month_after(jan31), ZoneInfo('Asia/Kolkata'))
    assert (end.month, end.day, end.hour, end.minute) == (2, 28, 9, 30)


@pytest.mark.parametrize('changes', [dict(amount=9899),dict(currency='USD'),dict(captured=False)])
def test_amount_currency_or_uncaptured_payment_never_grants_access(api, monkeypatch, changes):
    _, _, payments, _ = gateway(monkeypatch)
    api.post(BASE + '/trial', headers=auth('worker'));expire()
    order = checkout(api).json()
    p = captured(order, payments);p.update(changes)
    response = api.post(BASE + '/check', headers=auth('worker'))
    assert response.status_code in (200,409)
    assert not read()['active']
    assert main.operations_store.run(lambda u:u.get('market_access_members','worker')) is None


def test_lost_order_response_reuses_reserved_receipt_without_second_post(api, monkeypatch):
    provider, orders, payments, calls = gateway(monkeypatch)
    api.post(BASE + '/trial', headers=auth('worker'));expire()
    def lost(path, body=None):
        result = provider(path, body)
        if path == 'orders':
            marketplace.fail('PROVIDER_OUTCOME_UNKNOWN', 'Check payment status.',503)
        return result
    monkeypatch.setattr(market_access,'razorpay',lost)
    assert checkout(api).status_code == 503
    order = checkout(api).json()
    assert order['order_id'] in orders and len([c for c in calls if c[0] == 'orders']) == 1
    captured(order,payments)
    assert api.post(BASE + '/check',headers=auth('worker')).json()['status'] == 'paid'


def test_scheduler_recovers_lost_paid_order_and_throttles_before_network(api, monkeypatch):
    provider, orders, payments, calls = gateway(monkeypatch)
    api.post(BASE + '/trial', headers=auth('worker'));expire()
    def lost(path, body=None):
        result = provider(path, body)
        if path == 'orders':
            marketplace.fail('PROVIDER_OUTCOME_UNKNOWN', 'Check payment status.',503)
        return result
    monkeypatch.setattr(market_access,'razorpay',lost)
    assert checkout(api).status_code == 503
    captured({'order_id':next(iter(orders))},payments)
    assert main.market_access_tick() == {'attempted':1,'errors':0}
    assert read()['status'] == 'paid'
    assert main.market_access_tick() == {'attempted':0,'errors':0}
    assert len([c for c in calls if c[0]=='orders']) == 1


def test_scheduler_cursor_reaches_later_pending_pages_without_repolling_first_page(api, monkeypatch):
    gateway(monkeypatch)
    def seed(u):
        for number in range(40):
            aid=str(uuid.uuid4())
            u.put('market_access_payments',aid,dict(id=aid,user_id='worker',status='created',
                  order_id='order_page'+str(number),kind='market_access',receipt='ma_'+aid.replace('-',''),created_at=time.time()))
    main.operations_store.run(seed)
    seen=[]
    def provider(path,body=None):
        assert path.endswith('/payments')
        seen.append(path)
        return {'items':[]}
    monkeypatch.setattr(market_access,'razorpay',provider)
    results=[main.market_access_tick() for _ in range(4)]
    assert sum(x['attempted'] for x in results)==40 and all(x['attempted']<=25 for x in results)
    assert len(set(seen))==len(seen)==40
    for _ in range(4):
        assert main.market_access_tick()['attempted']==0
    assert len(seen)==40


def test_concurrent_checkout_reserves_only_one_provider_order(api, monkeypatch):
    _, orders, _, calls = gateway(monkeypatch)
    api.post(BASE + '/trial', headers=auth('worker'));expire()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _:checkout(api),range(2)))
    assert all(r.status_code in (200,503) for r in responses)
    assert len(orders) == 1 and len([c for c in calls if c[0] == 'orders']) == 1


def test_purchase_request_survives_committed_capture_response_loss_without_another_charge(api,monkeypatch):
    provider,orders,payments,calls=gateway(monkeypatch)
    api.post(BASE+'/trial',headers=auth('worker'));expire()
    request_id=str(uuid.uuid4())
    alias_id=str(uuid.uuid4())
    a=checkout(api,request_id=request_id).json()
    # A newly generated browser intent while checkout is pending aliases the
    # original attempt, rather than opening a second order.
    assert checkout(api,request_id=alias_id).json()['order_id']==a['order_id']
    captured(a,payments)
    assert api.post(BASE+'/check',headers=auth('worker')).json()['status']=='paid'
    # Treat that successful HTTP reply as lost at the browser. Even when the
    # provider is temporarily offline, either original key is already settled.
    def unavailable(path,body=None):
        raise AssertionError('A captured purchase replay must not call the provider.')
    monkeypatch.setattr(market_access,'razorpay',unavailable)
    for key in (request_id,alias_id):
        result=checkout(api,request_id=key)
        assert result.status_code==200 and result.json()['settled'] is True and result.json()['status']=='paid'
    assert len(orders)==1 and len([c for c in calls if c[0]=='orders'])==1
    monkeypatch.setattr(market_access,'razorpay',provider)
    later=checkout(api,request_id=str(uuid.uuid4())).json()
    assert later['order_id']!=a['order_id'] and len(orders)==2
    assert api.post(BASE+'/order',headers=auth('worker'),json={}).status_code==422


def test_refund_tombstone_no_stale_capture_replay_and_later_grant_preserved(api, monkeypatch):
    _, _, payments, _ = gateway(monkeypatch)
    api.post(BASE + '/trial',headers=auth('worker'));expire()
    a = checkout(api).json();pa = captured(a,payments)
    assert api.post(BASE + '/check',headers=auth('worker')).json()['status'] == 'paid'
    b = checkout(api).json();captured(b,payments,suffix='2')
    api.post(BASE + '/check',headers=auth('worker'))
    pa.update(status='refunded',amount_refunded=9900)
    assert api.post(BASE + '/check',headers=auth('worker'),json={'attempt_id':a['attempt_id']}).json()['status'] == 'expired'
    grants = main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']
    assert len(grants) == 1 and grants[0]['attempt_id'] == b['attempt_id']
    pa.update(status='captured',captured=True,amount_refunded=0)
    assert api.post(BASE + '/check',headers=auth('worker'),json={'attempt_id':a['attempt_id']}).json()['status'] == 'expired'
    assert len(main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']) == 1


def test_new_purchase_fills_refund_gap_now_and_keeps_later_full_prepaid_month(api,monkeypatch):
    _,_,payments,_=gateway(monkeypatch)
    api.post(BASE+'/trial',headers=auth('worker'));expire()
    a=checkout(api).json();pa=captured(a,payments)
    api.post(BASE+'/check',headers=auth('worker'))
    b=checkout(api).json();captured(b,payments,suffix='2')
    api.post(BASE+'/check',headers=auth('worker'))
    before=main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']
    future=next(g for g in before if g['attempt_id']==b['attempt_id'])
    pa.update(status='refunded',amount_refunded=9900)
    assert api.post(BASE+'/check',headers=auth('worker'),json={'attempt_id':a['attempt_id']}).json()['status']=='expired'
    remaining=main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']
    assert remaining==[future], 'A refund alone must not move another paid month.'
    c=checkout(api).json();captured(c,payments,suffix='3')
    assert api.post(BASE+'/check',headers=auth('worker')).json()['status']=='paid'
    after=main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']
    new=next(g for g in after if g['attempt_id']==c['attempt_id'])
    moved=next(g for g in after if g['attempt_id']==b['attempt_id'])
    assert new['starts_at']<=time.time()<new['ends_at']
    assert new['ends_at']==market_access.month_after(new['starts_at'])
    assert moved['starts_at']==new['ends_at'] and moved['starts_at']>future['starts_at']
    assert moved['ends_at']==market_access.month_after(moved['starts_at'])
    attempt=main.operations_store.run(lambda u:u.get('market_access_payments',b['attempt_id']))
    assert attempt['grant_starts_at']==moved['starts_at'] and attempt['grant_ends_at']==moved['ends_at']
    assert main.operations_store.run(lambda u:any(row['action']=='MarketplacePrepaidMonthMoved' for row in u.all('audit')))


def test_partial_refund_before_capture_revokes_month_and_never_regrants(api,monkeypatch):
    _,_,payments,_=gateway(monkeypatch)
    api.post(BASE+'/trial',headers=auth('worker'));expire()
    order=checkout(api).json()
    p=captured(order,payments,amount_refunded=1)
    state=api.post(BASE+'/check',headers=auth('worker')).json()
    assert state['status']=='expired' and state['payment_status']=='refunded'
    p['amount_refunded']=0
    state=api.post(BASE+'/check',headers=auth('worker')).json()
    assert state['status']=='expired' and state['payment_status']=='refunded'
    assert not main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']


def test_receipt_cannot_cross_payment_namespaces_and_bad_order_notes_are_held(api, monkeypatch):
    provider, _, payments, _ = gateway(monkeypatch)
    api.post(BASE + '/trial',headers=auth('worker'));expire()
    order = checkout(api).json();p = captured(order,payments)
    main.operations_store.run(lambda u:u.put('receipts',p['id'],dict(id=p['id'],kind='repaidians_pro',userId='worker')))
    assert api.post(BASE + '/check',headers=auth('worker')).status_code == 409
    assert not read()['active']
    api.post(BASE + '/trial',headers=auth('worker2'))
    def mismatch(path,body=None):
        result = provider(path,body)
        return {**result,'notes':{'kind':'repaidians_pro','user_id':'worker2'}} if path=='orders' else result
    monkeypatch.setattr(market_access,'razorpay',mismatch)
    assert checkout(api,'worker2').status_code == 409
    assert not main.operations_store.run(lambda u:u.get('market_access_orders','order_fixture2'))


def test_renewal_restores_only_expired_access_rows_not_closed_moderated_or_legacy_refunds(api, monkeypatch):
    _, _, payments, _ = gateway(monkeypatch)
    a, _ = draft(api,trial=True,mode='second_hand')
    b, _ = draft(api,trial=True,mode='second_hand')
    c, _ = draft(api,trial=True,mode='second_hand')
    d, _ = draft(api,trial=True,mode='second_hand')
    api.post('/operations/market/'+b['id']+'/close',headers=auth('worker'))
    api.post('/operations/admin/market/'+c['id']+'/hide',headers=ADMIN,json={'reason':'Test review must remain hidden'})
    def refund(u):
        row=u.get('market_listings',d['id']);row.update(status='closed',fee_status='refunded');u.put('market_listings',row['id'],row)
    main.operations_store.run(refund);expire();main.market_tick()
    order=checkout(api).json();captured(order,payments)
    state=api.post(BASE+'/check',headers=auth('worker')).json();assert state['status']=='paid'
    rows={x['id']:x for x in api.get('/operations/market/mine',headers=auth('worker')).json()['listings']}
    assert rows[a['id']]['status']=='published' and rows[a['id']]['expires_at']==state['current_period_ends_at']
    assert rows[b['id']]['status']=='closed' and rows[c['id']]['status']=='suspended' and rows[d['id']]['status']=='closed'


def test_twelve_future_months_limit_and_shared_provider_dispatcher(api, monkeypatch):
    _, _, payments, _ = gateway(monkeypatch)
    api.post(BASE+'/trial',headers=auth('worker'));expire()
    for number in range(12):
        order=checkout(api).json()
        payment=captured(order,payments,suffix=str(number))
        main.operations_store.run(lambda u:main.integrations_apply_payment(u,payment))
        grants=main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants']
        assert all(a['ends_at']==b['starts_at'] for a,b in zip(grants,grants[1:]))
        assert all(g['ends_at']==market_access.month_after(g['starts_at']) for g in grants)
    assert checkout(api).status_code==409
    assert len(main.operations_store.run(lambda u:u.get('market_access_members','worker'))['grants'])==12
