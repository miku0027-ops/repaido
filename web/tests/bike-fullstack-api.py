"""Isolated real HTTP bike application; only identity/provider boundaries are fixtures.

Never import this module into production. All data lives in the supplied SQLite
file. Real approval, payroll, policy, availability and booking APIs are used.
"""
import math
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1], REPAIDO_ADMIN_KEY='test-operator-key',
                  REPAIDO_ENV='test', REPAIDO_BIKE_DISPATCH_MODE='direct', REPAIDO_BIKE_DIRECT_DEV_ENABLED='true',
                  GOOGLE_ROUTES_API_KEY='isolated-fixture-key-not-a-credential', REPAIDO_BIKE_PROMO_QUOTA_SECRET='fixture-bike-quota-secret-at-least-32-bytes', REPAIDO_KYC_BUCKET='test-only')

# The test explicitly uses SQLite. Avoid discovering cloud credentials or
# initializing a live Firestore client merely to import the real main app.
with patch('firebase_admin.firestore.client', return_value=None):
    import main

import bike_dispatch
import bike_payroll
import bike_rides
import uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from operations import metres
from test_local_business import vehicle
from test_operations import ADMIN, PIN, auth, onboard


def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ('customer', 'worker', 'stranger'):
        raise HTTPException(401)
    return dict(id=uid, name='Local ' + uid, email=uid+'@example.test', phone='+919876543210',
                phone_verified=True, phone_authenticated=True)


main.app.dependency_overrides[main.current_user] = actor


def fixture_route(origin, destination):
    distance = max(100, math.ceil(metres(origin, destination) * 1.1))
    return dict(distance_metres=distance, duration_seconds=max(30, math.ceil(distance / 5)),
                points=[origin, destination], provider='isolated_google_two_wheeler_boundary')


bike_rides.verified_route = fixture_route
bike_dispatch.google_pickup_route = lambda origin, destination: {
    **fixture_route(origin, destination), 'provider': 'google_routes'}

BASE = '/operations/bike-rides'
with TestClient(main.app) as api:
    onboard(api)
    identifier = vehicle(api, vehicle_kind='bike', seats=1, name='Local reviewed bike')
    payroll = api.put(BASE+'/payroll', headers=ADMIN, json=dict(
        expected_version=0, enabled=True, monthly_funding_paise=700000,
        funding_period=bike_payroll.period_at(), funding_reference='isolated-salary-reserve-001',
        funding_evidence='Isolated test salary reserve; no bank transfer or production funding.',
        funding_acknowledged=True, roster=[{'driver_id': 'worker', 'active': True}]))
    assert payroll.status_code == 200, payroll.text
    policy = dict(expected_version=0, enabled=False, cash_enabled=True, base_paise=800,
                  per_km_paise=500, per_minute_paise=0, gst_bps=0, tax_reviewed=True,
                  service_center=PIN, service_area_reviewed=True, service_area_radius_metres=8000,
                  promo_enabled=True, promo_terms_reviewed=True, promo_started_at=time.time()-86400,
                  promo_planning_budget_paise=0,
                  terms='Local fixture terms: one passenger and a helmet. Cancel before pickup without charge.',
                  evidence_reference='isolated-policy-review-001')
    saved = api.put(BASE+'/admin/policy', headers=ADMIN, json=policy)
    assert saved.status_code == 200, saved.text
    enabled = api.put(BASE+'/admin/policy', headers=ADMIN,
                      json={**policy, 'expected_version': saved.json()['version'], 'enabled': True})
    assert enabled.status_code == 200, enabled.text
    available = api.put(BASE+'/driver/availability', headers=auth('worker'), json={
        'vehicle_id': identifier, 'online': True, 'position': {**PIN, 'accuracy': 5, 'captured_at': time.time()}})
    assert available.status_code == 200, available.text
    public = api.get(BASE+'/policy')
    assert public.status_code == 200 and public.json()['bookings_available'], public.text

uvicorn.run(main.app, host='127.0.0.1', port=int(sys.argv[2]))
