"""Profiles are public catalogues, never a second identity/contact directory."""
import json
import time

import main
from test_operations import api, auth, PIN
from test_market_messaging import listing, open_chat

BASE = '/operations/market/profiles/by-listing/'


def read(api, row, **params):
    response = api.get(BASE + row['id'], params=params)
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'private, no-store'
    return response.json()['profile']


def shop(sid='fixture-shop', uid='worker', **changes):
    row = dict(id=sid, owner_id=uid, name='Fixture workshop', city='Balasore', status='approved', created_at=time.time(),
               address='Private workshop address', phone='+919876543210', email='private@example.com', location=PIN,
               bank_account='private-bank-number', evidence_reference='private-reference')
    row.update(changes)
    main.operations_store.run(lambda u:u.put('shops', sid, row))
    return row


def rental(s, rid='fixture-rental', **changes):
    row = dict(id=rid, shop_id=s['id'], name='Rental drill', category='Tools', active=True, daily_paise=10000,
               weekly_paise=50000, monthly_paise=100000, total_units=2, reserved=0, image_url='/images/drill.jpg',
               private_note='secret-rental-note')
    row.update(changes)
    main.operations_store.run(lambda u:u.put('rental_inventory', rid, row))
    return row


def test_public_seller_catalogue_suppresses_identity_and_inactive_items(api):
    anchor = listing(owner_name='Alex private@example.com +91 98765 43210')
    other = listing(mode='exchange', name='Exchange laptop')
    private = listing(status='awaiting_fee', name='Private listing')
    expired = listing(expires_at=time.time()-1, name='Expired listing')
    closed = listing(status='closed', name='Closed listing')
    listing(uid='worker2', name='Someone else listing')
    value = read(api, anchor)
    assert {x['id'] for x in value['items']} == {anchor['id'], other['id']}
    assert value['counts'] == {'second_hand':1,'exchange':1,'rentals':0}
    assert value['label'] == 'Community seller' and value['counts_complete']
    assert len(value['key']) == 64 and value['key'] != 'worker'
    assert value['first_listed_at'] == min(anchor['created_at'], other['created_at'])
    text = json.dumps(value)
    for secret in ('owner_id','contact_phone','phone','email','private@example.com','98765','location','86.9135','verification','address'):
        assert secret not in text
    for row in (private,expired,closed):assert api.get(BASE + row['id']).status_code == 404
    assert api.get('/operations/market/profiles/worker').status_code == 404
    assert api.get(BASE + 'missing').status_code == 404


def test_chat_peer_profiles_resolve_only_other_participant_even_when_closed(api):
    seller = listing(name='Sold camera')
    buyer_item = listing(uid='worker2', name='Buyer laptop', mode='exchange')
    chat,_ = open_chat(api, seller)
    cid = chat['chat']['id']
    def close(u):
        u.put('market_listings', seller['id'], {**seller,'status':'closed'})
        c=u.get('market_chats',cid);c.update(buyer_name='Buyer member',seller_name='Seller member');u.put('market_chats',cid,c)
    main.operations_store.run(close)
    url = f'/operations/market/chats/{cid}/peer-profile'
    assert api.get(url).status_code == 401
    assert api.get(url,headers=auth('stranger')).status_code == 404
    assert api.get('/operations/market/chats/worker/peer-profile',headers=auth('worker')).status_code == 404
    seller_view = api.get(url,headers=auth('worker')).json()['profile']
    buyer_view = api.get(url,headers=auth('worker2')).json()['profile']
    assert [x['id'] for x in seller_view['items']] == [buyer_item['id']]
    assert buyer_view['items'] == []
    assert seller_view['key'] != buyer_view['key']
    assert 'worker' not in json.dumps(seller_view) and 'worker' not in json.dumps(buyer_view)


def test_profile_entitlement_boundary_and_paid_reactivation(api):
    now = time.time()
    row = listing(fee_status='free_trial',created_at=now-100*86400,trial_started_at=now-100*86400,expires_at=now+86400)
    assert api.get(BASE+row['id']).status_code == 404
    main.operations_store.run(lambda u:u.put('market_access_members','worker',dict(id='worker',grants=[dict(attempt_id='fixture',payment_id='fixture',starts_at=now-1,ends_at=now+86400)])))
    assert read(api,row)['counts']['second_hand'] == 1


def test_only_owner_visible_shop_rentals_and_independent_review_badges(api):
    row = listing()
    legacy = shop('legacy');rental(legacy,'drill')
    independent = dict(reviewed_by='operator',verification={'identity_checked':True,'business_checked':True,'address_checked':True})
    reviewed = shop('reviewed',**independent);rental(reviewed,'saw')
    bad = shop('self-reviewed',reviewed_by='worker',verification=independent['verification']);rental(bad,'self-rental')
    suspended = shop('suspended',status='suspended');rental(suspended,'suspended-rental')
    expired = shop('expired',created_at=time.time()-100*86400);rental(expired,'expired-rental')
    other = shop('other',uid='worker2');rental(other,'other-rental')
    rental(legacy,'inactive-rental',active=False)
    rental(legacy,'invalid-price-rental',daily_paise=0,weekly_paise=0,monthly_paise=0)
    value = read(api,row,mode='rentals')
    assert {x['id'] for x in value['items']} == {'drill','saw'}
    assert value['counts']['rentals'] == 2
    assert {s['id']:s['verified'] for s in value['shops']} == {'legacy':False,'reviewed':True}
    for secret in ('Private workshop','private@example.com','private-bank','secret-rental','location','phone','email','address','owner_id','reserved'):
        assert secret not in json.dumps(value)
    main.operations_store.run(lambda u:u.put('shop_access_members',expired['id'],dict(id=expired['id'],grants=[dict(attempt_id='fixture',payment_id='fixture',starts_at=time.time()-1,ends_at=time.time()+86400)])))
    assert 'expired-rental' in {x['id'] for x in read(api,row,mode='rentals')['items']}


def test_cursor_owner_mode_boundary_and_all_modes_pagination(api):
    anchor = listing(id='000-anchor')
    for i in range(30):listing(id=f'item-{i:03d}',mode='exchange' if i%2 else 'second_hand')
    s=shop();rental(s)
    items=[];cursor=None
    for _ in range(10):
        page=read(api,anchor,limit=7,**({'cursor':cursor} if cursor else {}))
        assert len(page['items'])<=7
        items.extend(x['id'] for x in page['items']);cursor=page['next_cursor']
        if not cursor:break
    assert len(items)==32 and len(set(items))==32
    first=read(api,anchor,limit=1)
    second=listing(uid='worker2')
    assert api.get(BASE+second['id'],params={'cursor':first['next_cursor']}).status_code==422
    assert api.get(BASE+anchor['id'],params={'cursor':first['next_cursor'],'mode':'exchange'}).status_code==422
    assert api.get(BASE+anchor['id'],params={'limit':25}).status_code==422
    assert api.get(BASE+anchor['id'],params={'mode':'private'}).status_code==422
    for bad in ('not-base64','////','eyJ2IjoxfQ','W10','dHJ1ZQ'):
        assert api.get(BASE+anchor['id'],params={'cursor':bad}).status_code==422


def test_sparse_scan_continuation_does_not_drop_published_items(api):
    anchor=listing(id='000-anchor')
    def seed(u):
        for i in range(405):u.put('market_listings',f'private-{i:04d}',{**anchor,'id':f'private-{i:04d}','status':'awaiting_fee'})
        u.put('market_listings','zz-visible',{**anchor,'id':'zz-visible'})
    main.operations_store.run(seed)
    first=read(api,anchor)
    assert first['next_cursor'] and len(first['items'])==1
    second=read(api,anchor,cursor=first['next_cursor'])
    assert [x['id'] for x in second['items']]==['zz-visible']
    assert not second['next_cursor']


def test_counts_are_explicitly_lower_bounds_for_large_catalogues(api):
    anchor=listing(id='000-anchor')
    def seed(u):
        for i in range(505):u.put('market_listings',f'listing-{i:04d}',{**anchor,'id':f'listing-{i:04d}'})
    main.operations_store.run(seed)
    value=read(api,anchor)
    assert value['counts']['second_hand']==500 and value['counts_complete'] is False
    assert value['first_listed_at'] is None
    assert value['next_cursor']
