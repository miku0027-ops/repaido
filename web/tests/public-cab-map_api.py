"""Isolated HTTP fixture using the real consent/discovery endpoints and SQLite."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1], REPAIDO_ADMIN_KEY='test-operator-key')
import main
import uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from test_local_business import vehicle
from test_operations import onboard


def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ('worker', 'worker2', 'customer'):
        raise HTTPException(401)
    return dict(id=uid, name=uid, email=uid+'@example.test', phone='+919876543210', phone_verified=True, phone_authenticated=True)


main.app.dependency_overrides[main.current_user] = actor
with TestClient(main.app) as api:
    onboard(api)
    vehicle(api)
    vehicle(api, 'worker2')
uvicorn.run(main.app, host='127.0.0.1', port=int(sys.argv[2]))
