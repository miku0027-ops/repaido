"""Regression checks for existing SQL bindings and local sign-in throttling."""
import re
import time
from types import SimpleNamespace

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


@pytest.mark.parametrize('stored_password', ['firebase_auth_token', 'invalid:saved-hash', ''])
def test_local_login_rejects_accounts_without_a_valid_local_password(client, stored_password):
    # Firebase identities also have legacy SQLite rows, but no local password.
    # Sending their public email to local sign-in must fail closed, not crash.
    with main.db() as connection:
        connection.execute('INSERT INTO users VALUES(?,?,?,?,?)',
                           ('provider-only', 'Provider account', 'provider@example.com', stored_password, int(time.time())))
    response = client.post('/auth/login', json={'email': 'provider@example.com', 'password': 'test-password-123'})
    assert response.status_code == 401, response.text
    assert response.json()['detail'] == 'Email or password is incorrect.'
    with main.db() as connection:
        assert connection.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0


@pytest.mark.parametrize('padding', [' ', '\t', '  '])
def test_logout_revokes_the_same_normalized_bearer_token_as_authentication(client, padding):
    registered = client.post('/auth/register', json={'name': 'Logout test', 'email': 'logout@example.com',
                                                   'password': 'test-password-123'})
    assert registered.status_code == 201
    token = registered.json()['token']
    padded = {'Authorization': 'Bearer ' + padding + token + padding}
    assert client.get('/auth/me', headers=padded).status_code == 200
    assert client.post('/auth/logout', headers=padded).status_code == 204
    assert client.get('/auth/me', headers={'Authorization': 'Bearer ' + token}).status_code == 401
    with main.db() as connection:
        assert connection.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0


def test_non_ascii_operator_key_is_denied_without_server_error(client):
    response = client.get('/admin/bookings', headers=[(b'X-Admin-Key', b'\xffinvalid-key')])
    assert response.status_code == 403


@pytest.mark.parametrize('claims,expected', [
    ({'admin': True}, 200), ({'role': 'admin'}, 200),
    ({'admin': 'true'}, 403), ({'admin': 1}, 403), ({'role': 'engineer'}, 403),
    ({'email': 'firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com', 'email_verified': True}, 403),
    ({}, 403),
])
def test_operator_requires_server_verified_exact_admin_claim(client, monkeypatch, claims, expected):
    verified = []
    def verify(token, *, check_revoked):
        verified.append((token, check_revoked))
        return {'uid': 'claim-holder', **claims}
    monkeypatch.setattr(main, 'fb_auth_module', SimpleNamespace(verify_id_token=verify))
    result = client.get('/admin/bookings', headers={'Authorization': 'Bearer signed-provider-token'})
    assert result.status_code == expected
    assert verified == [('signed-provider-token', True)]


def test_revoked_provider_token_never_authorizes_operator(client, monkeypatch):
    def revoked(token, *, check_revoked):
        assert check_revoked
        raise ValueError('Provider rejected revoked token')
    monkeypatch.setattr(main, 'fb_auth_module', SimpleNamespace(verify_id_token=revoked))
    headers = {'Authorization': 'Bearer revoked-provider-token'}
    assert client.get('/admin/bookings', headers=headers).status_code == 403
    assert client.get('/auth/me', headers=headers).status_code == 401


def test_all_admin_http_routes_reject_unauthenticated_requests_before_validation(client):
    checked = []
    for route in main.app.routes:
        path = getattr(route, 'path', '')
        if '/admin/' not in path:
            continue
        path = re.sub(r'\{[^}]+\}', 'untrusted-record-id', path)
        for method in route.methods & {'GET', 'POST', 'PUT', 'PATCH', 'DELETE'}:
            response = client.request(method, path)
            assert response.status_code == 403, (method, path, response.status_code, response.text)
            checked.append((method, path))
    assert checked, 'The administrator route inventory must not be empty.'
