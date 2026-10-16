"""Disposable real API for lifecycle browser checks; no live storage/providers."""
import io
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1], REPAIDO_ADMIN_KEY='local-browser-operator', REPAIDO_KYC_BUCKET='local-memory-only',
                  REPAIDO_TRANSACTIONAL_EMAIL_ENABLED='false', REPAIDO_PAYMENTS_ENABLED='false', REPAIDO_PAYOUTS_ENABLED='false', REPAIDO_PUSH_ENABLED='false')
import main
import local_business
import marketplace
import market_access
import uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

objects = {}
local_business.upload_object = lambda key, data: objects.__setitem__(key, data)
local_business.download_object = lambda key: objects[key]
marketplace.upload_object = local_business.upload_object
marketplace.download_object = local_business.download_object


def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ('buyer', 'seller', 'contributor', 'outsider', 'admin'):
        raise HTTPException(401)
    return dict(id=uid, name=uid.title() + ' Browser', email=uid + '@example.test', phone='+919876543210', phone_verified=True, phone_authenticated=True)


def operator(authorization: str = Header(default='')):
    if authorization != 'Bearer admin':
        raise HTTPException(403)
    return {'id': 'independent-browser-operator'}


main.app.dependency_overrides[main.current_user] = actor
main.app.dependency_overrides[main.operator] = operator


def seed(u):
    now = time.time()
    image = io.BytesIO()
    Image.new('RGB', (64, 64), '#245b45').save(image, format='JPEG')
    objects['fixture-listing-photo'] = image.getvalue()
    u.put('market_photos', 'lifecycle-photo', dict(id='lifecycle-photo', owner_id='seller', object='fixture-listing-photo', created_at=now))
    for uid in ('buyer', 'seller'):
        u.put('market_access_trials', uid, dict(id=uid, starts_at=now, policy=market_access.POLICY))
    u.put('market_listings', 'lifecycle-listing', dict(id='lifecycle-listing', owner_id='seller', owner_name='Seller Browser', mode='second_hand',
          status='published', expires_at=now + 30 * 86400, created_at=now, photo_id='lifecycle-photo', name='Browser handover camera',
          value_paise=100000, city='Balasore', contact_phone='+919876543210', location={'lat': 21.4934, 'lng': 86.9135},
          product_type='camera', brand='Test', fee_status='free_trial', trial_started_at=now, access_policy=market_access.POLICY))


@main.app.get('/__fixture/state')
def state():
    def read(u):
        return dict(listing=u.get('market_listings', 'lifecycle-listing'), transactions=u.all('market_transactions'),
                    contributions=u.all('community_contributions'), awards=u.all('cleanup_points'), documents=u.all('business_documents'),
                    payments=u.all('payments'), retail_orders=u.all('retail_orders'))
    return main.operations_store.run(read)


@main.app.post('/__fixture/meeting-elapsed/{cid}')
def meeting_elapsed(cid: str):
    # Only this isolated fixture advances an already mutually agreed meeting.
    # All agreement/completion mutations still use the real production endpoints.
    def write(u):
        row = u.get('market_transactions', cid)
        if not row or row['state'] != 'agreed':
            raise HTTPException(409)
        row['meeting']['starts_at'] = time.time() - 2
        u.put('market_transactions', cid, row)
    main.operations_store.run(write)
    return {'ok': True}


with TestClient(main.app):
    main.operations_store.run(seed)
uvicorn.run(main.app, host='127.0.0.1', port=int(sys.argv[2]))
