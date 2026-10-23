"""Disposable catalogue and approved worker for repair discovery browser checks."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1], REPAIDO_ADMIN_KEY='test-operator-key')
import main
import uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from test_operations import onboard


def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ('customer', 'worker'):
        raise HTTPException(401)
    return dict(id=uid, name=uid, email=uid+'@example.test', phone='+919876543210',
                phone_verified=True, phone_authenticated=True)


main.app.dependency_overrides[main.current_user] = actor
with TestClient(main.app) as api:
    # These are real catalogue rows inside this disposable database only.
    with main.db() as connection:
        for index, name in enumerate(('AC filter check', 'AC wiring inspection', 'AC drain cleaning')):
            connection.execute('INSERT INTO services VALUES(?,?,?,?,?,?,?,?,?)',
                               (f'fixture-ac-{index}', 'ac', name, 'Isolated browser fixture service.',
                                (299+index*100)*100, 30+index*15, 'Fixture', '[]', '[]'))
    onboard(api)

uvicorn.run(main.app, host='127.0.0.1', port=int(sys.argv[2]))
