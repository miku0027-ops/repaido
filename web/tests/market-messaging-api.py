"""Disposable native marketplace chat/access API; external providers stay local."""
import io
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1], REPAIDO_ADMIN_KEY='test-operator-key',
                  REPAIDO_KYC_BUCKET='local-memory-only', REPAIDO_PAYMENTS_ENABLED='true',
                  RAZORPAY_KEY_ID='rzp_test_local', RAZORPAY_KEY_SECRET='fixture-not-a-secret',
                  RAZORPAY_WEBHOOK_SECRET='fixture-not-a-secret')
import main
import market_access
import marketplace
import uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

ACTORS = ('buyer', 'seller', 'stranger', 'expired', 'admin')
PIN = {'lat': 21.4934, 'lng': 86.9135}
photos = {}
image = io.BytesIO()
Image.new('RGB', (48, 48), '#22478a').save(image, format='JPEG')
photos['fixture'] = image.getvalue()
marketplace.upload_object = lambda key, data: photos.__setitem__(key, data)
marketplace.download_object = lambda key: photos[key]


def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ACTORS:
        raise HTTPException(401)
    return dict(id=uid, name=uid.title() + ' Fixture', email=uid+'@example.test', phone='+919876543210',
                phone_verified=True, phone_authenticated=True)


main.app.dependency_overrides[main.current_user] = actor


def operator(authorization: str = Header(default='')):
    if authorization != 'Bearer admin':
        raise HTTPException(403)
    return {'id': 'fixture-company-admin'}


main.app.dependency_overrides[main.operator] = operator
orders = {}
states = {}


def provider(path, body=None):
    if path == 'orders' and body:
        oid = 'order_Fixture' + str(len(orders) + 1)
        orders[oid] = {**body, 'id': oid}
        states[oid] = 'created'
        return orders[oid]
    if path.startswith('orders?receipt='):
        receipt = path.partition('=')[2]
        return {'items': [row for row in orders.values() if row['receipt'] == receipt]}
    if path.startswith('orders/') and path.endswith('/payments'):
        oid = path.split('/')[1]
        return {'items': [] if states[oid] == 'created' else [{'id': 'pay_' + oid.removeprefix('order_')}]}
    if path.startswith('payments/'):
        pid = path.split('/')[1]
        oid = 'order_' + pid.removeprefix('pay_')
        return dict(id=pid, order_id=oid, status=states[oid], amount=9900, currency='INR',
                    captured=states[oid] == 'captured', amount_refunded=9900 if states[oid] == 'refunded' else 0)
    raise AssertionError('Unexpected local provider path: ' + path)


market_access.razorpay = provider


@main.app.get('/__fixture')
def fixture():
    attempts = main.operations_store.run(lambda u: [{key: row.get(key) for key in ('id', 'user_id', 'order_id', 'status')} for row in u.all('market_access_payments')])
    return {'actors': ACTORS, 'orders': orders, 'payment_states': states, 'attempts': attempts}


@main.app.post('/__fixture/payment/{order_id}/{state}')
def payment_state(order_id: str, state: str):
    assert order_id in orders and state in ('created', 'captured', 'refunded')
    states[order_id] = state
    return {'ok': True}


@main.app.post('/__fixture/expire/{uid}')
def expire(uid: str):
    assert uid in ACTORS
    def update(u):
        u.put('market_access_trials', uid, dict(id=uid, starts_at=time.time()-91*86400, policy=market_access.POLICY))
        u.put('market_access_members', uid, dict(id=uid, grants=[], policy=market_access.POLICY, updated_at=time.time()))
    main.operations_store.run(update)
    return {'ok': True}


def seed(u):
    now = time.time()
    u.put('market_photos', 'fixture-photo', dict(id='fixture-photo', owner_id='seller', object='fixture', created_at=now))
    for uid in ('seller', 'buyer'):
        u.put('market_access_trials', uid, dict(id=uid, starts_at=now, policy=market_access.POLICY))
    for lid, uid, mode, name in [('seller-used', 'seller', 'second_hand', 'Fixture used phone'),
                                 ('seller-swap', 'seller', 'exchange', 'Fixture swap laptop'),
                                 ('buyer-swap', 'buyer', 'exchange', 'Fixture buyer phone')]:
        row = dict(id=lid, owner_id=uid, owner_name=uid.title()+' Fixture', contact_phone='+919876543210',
                   mode=mode, name=name, brand='Fixture Brand', product_type='phone' if uid == 'buyer' or mode == 'second_hand' else 'computer',
                   desired_type='computer' if uid == 'buyer' else 'phone', desired_product='Fixture laptop' if uid == 'buyer' else 'Fixture phone',
                   value_paise=500000, purchase_paise=1200000, age_months=12, manufacture_year=2025,
                   warranty='No warranty', condition='Working item with a few scratches and charging cable.',
                   reason='Changing to a different model.', photo_id='fixture-photo', city='Balasore', location=PIN,
                   radius_km=10, share_contact=True, status='published', created_at=now,
                   trial_started_at=now, expires_at=now+90*86400, fee_paise=0, fee_status='free_trial', access_policy=market_access.POLICY)
        u.put('market_listings', lid, row)


with TestClient(main.app):
    main.operations_store.run(seed)
uvicorn.run(main.app, host='127.0.0.1', port=int(sys.argv[2]))
