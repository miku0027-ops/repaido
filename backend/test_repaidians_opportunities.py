"""Native listing references, bounded historical discovery and real purchase gates."""
import json
import time
from types import SimpleNamespace

import pytest
import main
import operations
import repaidians
import repaidians_opportunities as bridge
from test_operations import api, auth


def native_rows(now=None):
    now = now or time.time()
    tender = dict(id='tender1', owner_id='customer', owner_name='Client member', title='Electrical project', sector='Electrical', city='Balasore',
                  status='open', opens_at=now - 10, deadline=now + 1000, ends_at=now + 5000, budget_paise=250000, manpower_needed=3,
                  scope='PRIVATE CONTRACTOR SCOPE', site='PRIVATE SITE', terms='PRIVATE CONTRACT TERMS', bids=[{'private': True}], registrations=['private'], events=['private'])
    hiring = dict(status='open', city='Balasore', area='Public neighbourhood', sector='Electrical', summary='Published crew hiring description.',
                  skills=['Electrical work'], openings=2, daily_rate_paise=80000, deadline=now + 1000, terms='Published hiring terms.', updated_by='private')
    career = dict(id='career1', owner_id='worker', owner_name='Approved contractor', title='Build the installation team', status='planning',
                  starts_at=now + 2000, ends_at=now + 5000, team=[], goals=[], hiring=hiring, site='PRIVATE ADDRESS', scope='PRIVATE PROJECT SCOPE', budget_paise=99999999, payroll=['private'])
    shop = dict(id='shop1', owner_id='shop', status='approved', name='Approved local shop', city='Balasore', address='PRIVATE SHOP ADDRESS', phone='private')
    product = dict(id='product1', shop_id='shop1', name='Refurbished drill', category='Electrical tools', compatibility='Listed compatible drill bits',
                   price_paise=199900, stock=10, stock_confirmed_at=now, status='approved', condition='refurbished', image_url='/images/drill.jpg',
                   refurbishment={'grade': 'B', 'known_defects': 'Minor casing wear', 'warranty_days': 90, 'contact': 'PRIVATE REFURB CONTACT'})
    peer = dict(id='peer1', owner_id='worker2', owner_name='Local seller', mode='second_hand', status='published', expires_at=now + 5000,
                name='Pre-owned desk', product_type='tools', city='Balasore', value_paise=100000, condition='Used desk with disclosed surface wear',
                photo_id='peer-photo', contact_phone='PRIVATE PHONE', location={'lat': 1, 'lng': 2}, purchase_paise=120000)
    return tender, career, shop, product, peer


@pytest.fixture
def listings(api):
    rows = native_rows()
    def seed(u):
        tender, career, shop, product, peer = rows
        u.put('workers', 'worker', {'id': 'worker', 'name': 'Approved contractor', 'status': 'approved', 'contractor_verified': True, 'categories': ['electrician'], 'home_address': 'PRIVATE HOME'})
        for kind, row in zip(('contract_tenders', 'contract_projects', 'shops', 'inventory', 'market_listings'), rows):
            u.put(kind, row['id'], row)
        u.put('jobs', 'private-task', {'id': 'private-task', 'state': 'searching', 'customer_id': 'customer', 'address': 'PRIVATE TASK ADDRESS'})
        u.put('hires', 'private-hire', {'id': 'private-hire', 'state': 'offered', 'customer_id': 'customer', 'phone': 'PRIVATE HIRE PHONE'})
    main.operations_store.run(seed)
    return rows


def board(api, **filters):
    response = api.get('/repaidians/opportunities', headers=auth('customer'), params=filters)
    assert response.status_code == 200, response.text
    return response.json()


def test_cards_use_live_native_rows_only_and_exclude_private_data(api, listings, monkeypatch):
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Global collection scan')))
    page = board(api)
    assert {r['source'] for r in page['items']} == set(bridge.SOURCE_KINDS)
    encoded = json.dumps(page)
    assert 'PRIVATE' not in encoded and 'private-task' not in encoded and 'private-hire' not in encoded
    assert all(c['available'] and isinstance(c['saved'], bool) and isinstance(c['shareable'], bool) for c in page['items'])
    product = next(c for c in page['items'] if c['source'] == 'inventory')
    assert product['pricePaise'] == 199900 and product['condition'] == 'refurbished'
    assert product['refurbishment'] == {'grade': 'B', 'known_defects': 'Minor casing wear', 'warranty_days': 90}
    career = next(c for c in page['items'] if c['source'] == 'career')
    assert career['details']['hiring']['terms'] == 'Published hiring terms.'
    assert career['details']['team'] == {'total': 0, 'supervisors': 0, 'members': 0}
    assert api.get('/repaidians/opportunities/task/private-task', headers=auth('customer')).status_code == 404


def test_filters_owner_and_share_authorization_use_server_ownership(api, listings):
    assert {c['source'] for c in board(api, kind='products')['items']} == {'inventory', 'second_hand'}
    assert {c['source'] for c in board(api, trade='electrician', city='balasore')['items']} == {'contract', 'career', 'inventory'}
    assert board(api, city='Another city')['items'] == []
    assert [c['id'] for c in board(api, mode='mine')['items']] == ['tender1']
    assert [c['id'] for c in board(api, mode='shareable')['items']] == ['tender1']
    actor = {'user': {'id': 'customer'}}
    assert main.operations_store.run(lambda u: bridge.validate_reference(u, {'source': 'contract', 'id': 'tender1'}, actor))['shareable']
    with pytest.raises(Exception) as denied:
        main.operations_store.run(lambda u: bridge.authorizepublish(u, {'id': 'customer'}, {'source': 'inventory', 'id': 'product1'}))
    assert denied.value.status_code == 403
    assert main.operations_store.run(lambda u: bridge.authorizepublish(u, {'id': 'shop'}, {'source': 'inventory', 'id': 'product1'}))['shareable']
    assert main.operations_store.run(lambda u: bridge.authorizepublish(u, {'id': 'worker'}, {'source': 'career', 'id': 'career1'}))['shareable']


def test_purchased_listing_requires_current_verified_native_order(api, listings):
    def purchase(u):
        u.put('retail_orders', 'order1', {'id': 'order1', 'customer_id': 'customer', 'state': 'paid', 'payment_id': 'pay_confirmed',
            'items': [{'product_id': 'product1', 'quantity': 1}], 'recipient_phone': 'PRIVATE RECEIPT PHONE', 'delivery_address': 'PRIVATE RECEIPT ADDRESS'})
    main.operations_store.run(purchase)
    page = board(api, mode='shareable', kind='products')
    assert [c['id'] for c in page['items']] == ['product1']
    assert 'PRIVATE' not in json.dumps(page)
    actor = {'user': {'id': 'customer'}}
    assert main.operations_store.run(lambda u: bridge.validate_reference(u, {'source': 'inventory', 'id': 'product1'}, actor))['shareable']
    def refund(u):
        order = u.get('retail_orders', 'order1'); order['state'] = 'refunded'; u.put('retail_orders', 'order1', order)
    main.operations_store.run(refund)
    assert not api.get('/repaidians/opportunities/inventory/product1', headers=auth('customer')).json()['shareable']
    assert board(api, mode='shareable', kind='products')['items'] == []
    with pytest.raises(Exception) as denied:
        main.operations_store.run(lambda u: bridge.validate_reference(u, {'source': 'inventory', 'id': 'product1'}, actor))
    assert denied.value.status_code == 403


@pytest.mark.parametrize('changes', [ {'customer_id': 'stranger'}, {'state': 'creating'}, {'payment_id': ''}, {'items': [{'product_id': 'other', 'quantity': 1}]}, {'items': [{'product_id': 'product1', 'quantity': 0}]} ])
def test_forged_purchase_index_cannot_authorize_an_unrelated_receipt(api, listings, changes):
    def forged(u):
        order = {'id': 'order1', 'customer_id': 'customer', 'state': 'paid', 'payment_id': 'pay_confirmed', 'items': [{'product_id': 'product1', 'quantity': 1}], **changes}
        u.put('retail_orders', 'order1', order)
        u.put('rp_purchase_' + bridge.digest('customer:product1'), 'order1', {'id': 'order1', 'sortKey': 'order1', 'orderId': 'order1', 'active': True})
    main.operations_store.run(forged)
    card = api.get('/repaidians/opportunities/inventory/product1', headers=auth('customer')).json()
    assert card['shareable'] is False


def test_saved_references_are_real_per_uid_and_refresh_current_prices(api, listings):
    path = '/repaidians/opportunities/inventory/product1/saved'
    assert api.put(path, headers=auth('customer'), json={'active': True}).json() == {'saved': True}
    assert api.put(path, headers=auth('customer'), json={'active': True}).json() == {'saved': True}
    assert [c['id'] for c in board(api, mode='saved')['items']] == ['product1']
    other = api.get('/repaidians/opportunities?mode=saved', headers=auth('stranger')).json()
    assert other['items'] == []
    def change(u):
        product = u.get('inventory', 'product1'); product['price_paise'] = 209900; u.put('inventory', 'product1', product)
    main.operations_store.run(change)
    assert board(api, mode='saved')['items'][0]['pricePaise'] == 209900
    assert api.put(path, headers=auth('customer'), json={'active': False}).json() == {'saved': False}
    assert board(api, mode='saved')['items'] == []
    assert api.put('/repaidians/opportunities/inventory/missing/saved', headers=auth('customer'), json={'active': True}).status_code == 404


@pytest.mark.parametrize('kind,key,changes', [('contract_tenders', 'tender1', {'status': 'closed'}), ('contract_projects', 'career1', {'status': 'cancelled'}),
    ('inventory', 'product1', {'stock': 0}), ('market_listings', 'peer1', {'status': 'suspended'})])
def test_withdrawal_is_resolved_on_every_detail_and_attachment(api, listings, kind, key, changes):
    source = bridge.NATIVE_SOURCES[kind]
    def withdraw(u):
        row = u.get(kind, key); row.update(changes); u.put(kind, key, row)
    main.operations_store.run(withdraw)
    assert api.get(f'/repaidians/opportunities/{source}/{key}', headers=auth('customer')).status_code == 404
    assert main.operations_store.run(lambda u: bridge.hydrate(u, {'source': source, 'id': key}, {'user': {'id': 'customer'}})) is None
    assert all(c['id'] != key for c in board(api)['items'])


@pytest.mark.parametrize('system', ['community', 'network'])
def test_both_directional_block_systems_hide_source_cards(api, listings, system):
    def block(u):
        if system == 'community':
            u.put('rp_blocks', repaidians.digest('customer:shop'), {'active': True})
        else:
            u.put('network_blocks', 'shop:customer', {'active': True})
    main.operations_store.run(block)
    assert api.get('/repaidians/opportunities/inventory/product1', headers=auth('customer')).status_code == 404
    assert all(c['source'] != 'inventory' for c in board(api)['items'])


def test_old_native_records_backfill_with_bounded_keysets_and_no_global_scans(api, monkeypatch):
    now = time.time()
    with main.db() as connection:
        for index in range(37):
            row = {**native_rows(now)[0], 'id': f'legacy{index:03}'}
            connection.execute('INSERT INTO operation_records VALUES(?,?,?)', ('contract_tenders', row['id'], json.dumps(row)))
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Global scan')))
    ids, cursor, attempts = [], None, 0
    while True:
        result = board(api, kind='tenders', limit=5, **({'cursor': cursor} if cursor else {}))
        assert len(result['items']) <= 5
        ids.extend(c['id'] for c in result['items'])
        cursor = result['nextCursor']
        attempts += 1
        assert attempts < 30
        if not cursor:
            break
    assert len(ids) == len(set(ids)) == 37
    marker = main.operations_store.run(lambda u: u.get('rp_opportunity_backfill', bridge.backfill_key('contract')))
    assert marker['done'] and marker['after'] == 'legacy036'
    assert [c['id'] for c in board(api, kind='tenders', limit=5)['items']] == ids[:5]


def test_historical_paid_orders_discover_each_purchase_without_cursor_skips(api, listings):
    now = time.time()
    def products(u):
        for index in range(3):
            row = {**native_rows(now)[3], 'id': 'bought' + str(index)}
            u.put('inventory', row['id'], row)
    main.operations_store.run(products)
    with main.db() as c:
        for index in range(3):
            row = {'id': f'oldorder{index}', 'customer_id': 'customer', 'state': 'paid', 'payment_id': 'pay_verified' + str(index),
                   'items': [{'product_id': 'bought' + str(2 - index), 'quantity': 1}]}
            c.execute('INSERT INTO operation_records VALUES(?,?,?)', ('retail_orders', row['id'], json.dumps(row)))
    cursor, ids = None, []
    for _ in range(15):
        result = board(api, kind='products', mode='shareable', limit=1, **({'cursor': cursor} if cursor else {}))
        assert len(result['items']) <= 1
        ids.extend(c['id'] for c in result['items'])
        cursor = result['nextCursor']
        if not cursor:
            break
    assert cursor is None and len(ids) == len(set(ids)) == 3
    assert set(ids) == {'bought0', 'bought1', 'bought2'}
    assert {c['id'] for c in board(api, kind='products', mode='shareable')['items']} == set(ids)


def test_native_hundred_item_stock_change_does_not_amplify_index_writes(api, listings):
    template = listings[3]
    for start in range(0, 100, 20):
        main.operations_store.run(lambda u: [u.put('inventory', f'bulk{index:03}', {**template, 'id': f'bulk{index:03}'}) for index in range(start, start + 20)])
    def checkout(u):
        for index in range(100):
            key = f'bulk{index:03}'
            row = u.get('inventory', key)
            row['stock'] -= 1
            u.put('inventory', key, row)
        u.put('retail_orders', 'bulk-order', {'id': 'bulk-order', 'customer_id': 'customer', 'state': 'paid', 'payment_id': 'pay_bulk',
            'items': [{'product_id': f'bulk{index:03}', 'quantity': 1} for index in range(100)]})
        assert sum(kind == 'inventory' for kind, _ in u.pending) == 100
        assert len(u.pending) == 301  # 100 products + order + 100 proof references + 100 per-user references.
    main.operations_store.run(checkout)


def test_firestore_native_keyset_uses_real_sdk_cursor_and_bounded_query(monkeypatch):
    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1 import Client, Query
    client = Client(project='repaidians-test-only', credentials=AnonymousCredentials())
    captured = []
    def stream(query, transaction=None):
        captured.append(query._to_protobuf())
        return iter([])
    monkeypatch.setattr(Query, 'stream', stream)
    core = SimpleNamespace(fs_collection=lambda name: client.collection(name),
                           fs_doc=lambda name, key: client.collection(name).document(key))
    unit = SimpleNamespace(core=core, tx=object(), pending={}, fetched={})
    assert bridge.native_scan(unit, 'retail_orders', 'saved-order', limit=2, customer='customer') == []
    query = captured[0]
    assert query.limit == 2 and query.order_by[0].field.field_path == '__name__'
    assert query.start_at.values[0].reference_value.endswith('/ops_retail_orders/saved-order')
    assert query.where.field_filter.field.field_path == 'customer_id'
    assert query.where.field_filter.value.string_value == 'customer'


def test_invalid_cursor_and_filters_and_trial_expiry_are_enforced(api, listings):
    assert api.get('/repaidians/opportunities?cursor=ImJhZCI=', headers=auth('customer')).status_code == 422
    assert api.get('/repaidians/opportunities?trade=unknown', headers=auth('customer')).status_code == 422
    assert api.get('/repaidians/opportunities?limit=51', headers=auth('customer')).status_code == 422
    page = board(api, kind='products', limit=1)
    assert api.get('/repaidians/opportunities?kind=tenders&cursor=' + page['nextCursor'], headers=auth('customer')).status_code == 422
    main.operations_store.run(lambda u: u.put('rp_trials', 'customer', {'userId': 'customer', 'startsAt': 0, 'endsAt': 1}))
    assert api.get('/repaidians/opportunities', headers=auth('customer')).status_code == 402
    assert api.put('/repaidians/opportunities/inventory/product1/saved', headers=auth('customer'), json={'active': True}).status_code == 402
    assert api.put('/repaidians/opportunities/inventory/product1/saved', json={'active': True}).status_code == 401


def test_native_marketplace_detail_is_safe_and_not_subject_to_social_paywall(api, listings):
    response = api.get('/operations/market/listings/peer1')
    assert response.status_code == 200
    assert response.json()['id'] == 'peer1'
    assert 'PRIVATE' not in json.dumps(response.json())
    def expired(u):
        peer = u.get('market_listings', 'peer1'); peer['expires_at'] = 1; u.put('market_listings', 'peer1', peer)
    main.operations_store.run(expired)
    assert api.get('/operations/market/listings/peer1').status_code == 404
