"""Regression checks for existing SQL bindings and local sign-in throttling."""
import time

import pytest

import main
from test_api import client


def test_sql_like_profile_and_record_values_remain_literal_data(client):
    payload = "O'Brien'); DROP TABLE users; --"
    registered = client.post('/auth/register', json={'name': payload, 'email': 'literal@example.com',
                                                   'password': 'test-password-123'})
    assert registered.status_code == 201, registered.text
    headers = {'Authorization': 'Bearer ' + registered.json()['token']}
    assert client.get('/auth/me', headers=headers).json()['name'] == payload
    assert client.post('/auth/login', json={'email': 'literal@example.com',
                                           'password': 'test-password-123'}).status_code == 200

    def seed(unit):
        unit.put('rp_members', payload, {'id': payload, 'handle': payload})
        unit.put('rp_members', 'other', {'id': 'other', 'handle': 'normal'})
        unit.put('jobs', 'literal-job', {'worker_id': payload})
        unit.put('jobs', 'other-job', {'worker_id': 'other'})
    main.operations_store.run(seed)

    def verify(unit):
        assert unit.get('rp_members', payload) == {'id': payload, 'handle': payload}
        assert unit.get("rp_members' OR 1=1 --", payload) is None
        assert unit.find('rp_members', 'handle', payload) == [{'id': payload, 'handle': payload}]
        assert unit.for_workers('jobs', [payload]) == [{'worker_id': payload}]
        with pytest.raises(ValueError, match='Unsupported indexed lookup'):
            unit.find('rp_members', "handle') OR 1=1 --", payload)
        assert len(unit.all('rp_members')) == 2
    main.operations_store.run(verify)
    with main.db() as connection:
        assert connection.execute('SELECT count(*) FROM users').fetchone()[0] == 1


def test_local_sign_in_limit_expires_and_denies_before_password_work(client, monkeypatch):
    registered = client.post('/auth/register', json={'name': 'Local throttle test',
        'email': 'throttle@example.com', 'password': 'test-password-123'})
    assert registered.status_code == 201
    now = int(time.time())
    with main.db() as connection:
        connection.execute('DELETE FROM rate_limits')
        connection.executemany('INSERT INTO rate_limits VALUES(?,?)',
                               [('testclient', now)] * 29 + [('testclient', now - 901)] * 2)
    original = main.hash_password
    hashed = []
    def observed(*args, **kwargs):
        hashed.append(True)
        return original(*args, **kwargs)
    monkeypatch.setattr(main, 'hash_password', observed)
    credentials = {'email': 'throttle@example.com', 'password': 'wrong-password-123'}
    assert client.post('/auth/login', json=credentials).status_code == 401
    hashes_before_denial = len(hashed)
    denied = client.post('/auth/login', json={**credentials, 'password': 'test-password-123'},
                         headers={'X-Forwarded-For': 'different-untrusted-address'})
    assert denied.status_code == 429
    assert len(hashed) == hashes_before_denial
    with main.db() as connection:
        assert connection.execute('SELECT count(*) FROM rate_limits').fetchone()[0] == 30
        assert connection.execute('SELECT count(*) FROM sessions').fetchone()[0] == 1
        connection.execute('UPDATE rate_limits SET happened_at=?', (now - 901,))
    assert client.post('/auth/login', json={**credentials, 'password': 'test-password-123'}).status_code == 200
