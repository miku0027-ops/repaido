import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
import main

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path / 'test.db'))
    monkeypatch.setattr(main, 'USE_FIRESTORE', False)
    monkeypatch.setattr(main, 'fb_db', None)
    monkeypatch.setattr(main, 'fb_auth_module', None)
    monkeypatch.setenv('REPAIDO_ADMIN_KEY', 'test-operator-key')
    with TestClient(main.app) as c:
        yield c

def account(client, email='customer@example.com'):
    r = client.post('/auth/register', json={'name':'Test Customer','email':email,'password':'test-password-123'})
    assert r.status_code == 201, r.text
    return {'Authorization': 'Bearer ' + r.json()['token']}

def booking_body(client, **changes):
    slot = client.get('/slots', params={'service_id':'ac-service','city':'Bengaluru'}).json()['slots'][0]['starts_at']
    return dict(service_id='ac-service',city='Bengaluru',address='Flat 12, Lake Road, Indiranagar',phone='9876543210',starts_at=slot,idempotency_key=str(uuid.uuid4()),**changes)

def test_auth_and_catalog(client):
    assert client.get('/health').json()['status'] == 'ok'
    catalog = client.get('/catalog').json()
    assert len(catalog['services']) == 12
    assert len(catalog['categories']) == 8
    assert client.get('/bookings').status_code == 401
    auth = account(client)
    assert client.get('/auth/me',headers=auth).json()['email'] == 'customer@example.com'
    assert client.post('/auth/login',json={'email':'customer@example.com','password':'wrong-password'}).status_code == 401
    assert client.post('/auth/login',json={'email':'CUSTOMER@example.com','password':'test-password-123'}).status_code == 200
    assert client.post('/auth/register',json={'name':'Test','email':'customer@example.com','password':'test-password-123'}).status_code == 409
    assert client.post('/auth/logout',headers=auth).status_code == 204
    assert client.get('/auth/me',headers=auth).status_code == 401

@pytest.mark.parametrize('origin', ['https://repaido.com', 'https://www.repaido.com', 'https://repaido.web.app'])
def test_hosted_frontend_cors_and_auth(client, origin):
    preflight = client.options('/api/operations/worker/documents/identity', headers={
        'Origin': origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-verification-consent,x-capture-metadata',
    })
    assert preflight.status_code == 200
    assert preflight.headers['access-control-allow-origin'] == origin
    response = client.get('/api/bookings', headers={'Origin': origin})
    assert response.status_code == 401
    assert response.headers['access-control-allow-origin'] == origin

def test_untrusted_origin_is_not_allowed(client):
    response = client.options('/api/bookings', headers={
        'Origin': 'https://repaido.com.attacker.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
    })
    assert response.status_code == 400
    assert 'access-control-allow-origin' not in response.headers

def test_booking_price_idempotency_ownership_and_cancel(client):
    auth = account(client)
    other = account(client,'other@example.com')
    body = booking_body(client)
    body['price_paise'] = 1
    result = client.post('/bookings',json=body,headers=auth)
    assert result.status_code == 201, result.text
    b = result.json()
    assert b['price_paise'] == 59900
    assert b['status'] == 'requested'
    assert client.post('/bookings',json=body,headers=auth).json()['id'] == b['id']
    assert len(client.get('/bookings',headers=auth).json()['bookings']) == 1
    assert client.get('/bookings',headers=other).json()['bookings'] == []
    assert client.post(f"/bookings/{b['id']}/cancel",headers=other).status_code == 404
    changed = {**body, 'address':'A different address 123'}
    assert client.post('/bookings',json=changed,headers=auth).status_code == 409
    assert client.post(f"/bookings/{b['id']}/cancel",headers=auth).json()['status'] == 'cancelled'
    assert client.post(f"/bookings/{b['id']}/cancel",headers=auth).status_code == 200

def test_concurrent_capacity_enforced(client):
    auth = account(client)
    body = booking_body(client)
    def create(_):
        return client.post('/bookings',json={**body,'idempotency_key':str(uuid.uuid4())},headers=auth).status_code
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(create, range(6)))
    assert results.count(201) == 3
    assert results.count(409) == 3
    slots = client.get('/slots',params={'service_id':'ac-service','city':'Bengaluru'}).json()['slots']
    assert body['starts_at'] not in [s['starts_at'] for s in slots]
    b = client.get('/bookings',headers=auth).json()['bookings'][0]
    client.post(f"/bookings/{b['id']}/cancel",headers=auth)
    assert create(0) == 201

def test_operator_status_transitions(client):
    auth = account(client)
    b = client.post('/bookings',json=booking_body(client),headers=auth).json()
    route = f"/admin/bookings/{b['id']}"
    admin = {'X-Admin-Key':'test-operator-key'}
    assert client.get('/admin/bookings').status_code == 403
    assert client.patch(route,headers=auth,json={'status':'confirmed','professional_name':'Test Expert'}).status_code == 403
    assert client.patch(route,headers=admin,json={'status':'completed'}).status_code == 409
    assert client.patch(route,headers=admin,json={'status':'confirmed'}).status_code == 422
    assert client.patch(route,headers=admin,json={'status':'confirmed','professional_name':'Test Expert'}).json()['professional_name'] == 'Test Expert'
    assert client.patch(route,headers=admin,json={'status':'in_progress'}).status_code == 200
    assert client.post(f"/bookings/{b['id']}/cancel",headers=auth).status_code == 409
    assert client.patch(route,headers=admin,json={'status':'completed'}).status_code == 200
    assert client.patch(route,headers=admin,json={'status':'confirmed'}).status_code == 409

def test_validation_and_stale_times(client):
    auth = account(client)
    body = booking_body(client)
    for field,value,code in [('phone','123',422),('address','short',422),('city','Unknown',422),('service_id','unknown',404),('starts_at','2020-01-01T09:00:00+05:30',409),('starts_at','2026-10-01T09:00:00',422)]:
        response=client.post('/bookings',json={**body,field:value},headers=auth)
        assert response.status_code == code, response.text
    assert client.get('/slots',params={'city':'Unknown','service_id':'ac-service'}).status_code == 422

def test_credentials_not_stored_plaintext_and_expiry(client):
    auth=account(client)
    token=auth['Authorization'][7:]
    with main.db() as c:
        user=c.execute('SELECT password FROM users').fetchone()
        session=c.execute('SELECT token_hash FROM sessions').fetchone()
        assert 'test-password-123' not in user['password']
        assert session['token_hash'] != token
        c.execute('UPDATE sessions SET expires_at=0')
    assert client.get('/auth/me',headers=auth).status_code == 401

def test_restart_preserves_booking(client):
    auth=account(client)
    b=client.post('/bookings',headers=auth,json=booking_body(client)).json()
    main.init_db()
    assert client.get('/bookings',headers=auth).json()['bookings'][0]['id'] == b['id']
