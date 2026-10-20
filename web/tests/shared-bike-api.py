"""Disposable real shared-journey API; identity and road provider are fixtures.

Uses only the supplied SQLite file. No production accounts, routing or storage.
"""
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1],
                  REPAIDO_ADMIN_KEY='test-operator-key', REPAIDO_KYC_BUCKET='test-only')
with patch('firebase_admin.firestore.client', return_value=None):
    import main

import mobility_journeys
import uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from test_local_business import BASE, auth, approve, doc, register, vehicle
from local_business import Vehicle


def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ('customer', 'worker', 'shop', 'stranger'):
        raise HTTPException(401)
    return dict(id=uid, name='Local ' + uid, email=uid+'@example.test',
                phone='+919876543210', phone_verified=True, phone_authenticated=True)


main.app.dependency_overrides[main.current_user] = actor
mobility_journeys.road_route = lambda a, b, **kwargs: {
    'points': [a, b], 'distance_metres': 1500, 'provider': 'isolated-road-boundary'}

with TestClient(main.app) as api:
    bike = vehicle(api, vehicle_kind='bike', seats=1, name='Local shared bike')
    bike_data = api.get(BASE+'/partner?role=cab_owner', headers=auth('worker')).json()['vehicles'][0]
    car_data = {key: bike_data[key] for key in Vehicle.model_fields if key in bike_data}
    car_data.update(expected_version=0, vehicle_kind='car', seats=4, name='Local four-seat car', document_ids=[doc('worker')])
    car_id = str(uuid.uuid4())
    car = api.put(BASE+'/vehicles/'+car_id, headers=auth('worker'), json=car_data)
    assert car.status_code == 200, car.text
    approve(api, 'vehicle', car_id)
    register(api, 'shop', 'driver')
    invited = api.put(BASE+'/vehicles/'+bike+'/driver', headers=auth('worker'),
                      json={'driver_id': 'shop'})
    assert invited.status_code == 200, invited.text
    accepted = api.post(BASE+'/driver-invitations/'+bike, headers=auth('shop'),
                        json={'accept': True})
    assert accepted.status_code == 200, accepted.text

uvicorn.run(main.app, host='127.0.0.1', port=int(sys.argv[2]))
