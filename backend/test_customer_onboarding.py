"""Real HTTP setup, verified phone gating and recommendation boundaries."""
import uuid
import pytest
import main
from test_api import client
from test_promotions import campaign


@pytest.fixture
def identities(client, monkeypatch):
    claims = {}

    class Firebase:
        def verify_id_token(self, token, check_revoked=True):
            assert check_revoked
            return claims.get(token)

    monkeypatch.setattr(main, 'fb_auth_module', Firebase())
    def identity(uid='new-google', phone=False):
        claims[uid] = dict(uid=uid, name='A real customer', email=uid+'@example.com',
                           email_verified=True, auth_time=123456, firebase={'sign_in_provider':'google.com'})
        if phone:
            claims[uid]['phone_number'] = '+919876543210'
        return {'Authorization':'Bearer '+uid}
    return client, identity


def setup(**overrides):
    return dict(request_id=str(uuid.uuid4()), name='Customer Name', email='customer@example.com',
                categories=['ac','plumber'], primary_category='ac', adapt_suggestions=False,
                city='Balasore', **overrides)


def test_guest_browsing_and_new_google_phone_cannot_be_bypassed(identities):
    api, identity = identities
    assert api.get('/catalog').status_code == 200
    assert api.get('/operations/discovery/feed').status_code == 200
    assert api.get('/account/onboarding').status_code == 401
    headers = identity()
    state = api.get('/account/onboarding', headers=headers).json()
    assert state['required'] and not state['phone_verified'] and not state['completed']
    for method,path,body in [('put','/account/onboarding',setup()),
                             ('post','/auth/session',dict(mode='register',email='new@example.com',request_id=str(uuid.uuid4()))),
                             ('put','/operations/discovery/preferences',dict(enabled=True,consent_version=2))]:
        result = getattr(api,method)(path,headers=headers,json=body)
        assert result.status_code == 403, result.text
        assert result.json()['detail']['code'] == 'PHONE_VERIFICATION_REQUIRED'
    assert api.put('/account/onboarding',headers=headers,json={**setup(),'phone_verified':True}).status_code==422
    headers = identity(phone=True)  # Trusted refreshed Firebase claim after linking OTP.
    result = api.put('/account/onboarding',headers=headers,json=setup())
    assert result.status_code == 200, result.text
    assert result.json()['completed'] and not result.json()['required'] and result.json()['phone_verified']
    assert api.put('/operations/discovery/preferences',headers=headers,json={'enabled':True,'consent_version':2}).status_code==200


def test_existing_google_login_stays_available_and_new_setup_is_private(identities):
    api, identity = identities
    with main.db() as db:
        db.execute('INSERT INTO users VALUES(?,?,?,?,?)',('existing','Returning customer','existing@example.com','firebase_auth_token',1))
    existing = identity('existing')
    assert not api.get('/account/onboarding',headers=existing).json()['required']
    assert api.post('/auth/session',headers=existing,json={'mode':'login','request_id':str(uuid.uuid4())}).status_code==200
    verified = identity('new',phone=True)
    body=setup()
    saved=api.put('/account/onboarding',headers=verified,json=body)
    assert saved.status_code==200,saved.text
    assert api.put('/account/onboarding',headers=verified,json=body).json()==saved.json()
    assert api.put('/account/onboarding',headers=verified,json={**body,'categories':[],'primary_category':''}).status_code==409
    other=api.get('/account/onboarding',headers=identity('other',phone=True)).json()
    assert not other['completed'] and not other['categories'] and other['email']!='customer@example.com'
    assert api.put('/account/onboarding',headers=verified,json={**setup(),'id':'other'}).status_code==422
    assert api.put('/account/onboarding',headers=verified,json={**setup(),'categories':['made-up-service'],'primary_category':'made-up-service'}).status_code==422


def test_chosen_interests_rank_without_fabricated_behaviour_or_opt_in(identities):
    api, identity = identities
    headers=identity(phone=True)
    assert api.put('/account/onboarding',headers=headers,json=setup()).status_code==200
    feed=api.get('/operations/discovery/feed/personal',headers=headers).json()
    assert feed['cards'][0]['category']=='ac'
    assert feed['cards'][0]['reason']=='One of your chosen services'
    assert not feed['personalised']  # Behavioural adaptation is independently optional.
    preferences=main.operations_store.run(lambda u:u.get('discovery_preferences','new-google'))
    assert not preferences.get('signals') and not preferences.get('categories')
    assert not preferences['enabled']
    assert api.post('/operations/discovery/events',headers=headers,json={'event_id':str(uuid.uuid4()),'kind':'category_view','category':'ac'}).status_code==403
    prefs=api.get('/operations/campaigns/preferences',headers=headers).json()
    assert not prefs['push'] and not prefs['personalised']
    campaign(api)
    offers=api.post('/operations/campaigns/feed/personal',headers=headers,json={'city':'Balasore','placement':'launch'}).json()['cards']
    assert offers and offers[0]['reason']=='Based on your saved interests'
    assert offers[0]['price_paise']==59900 and offers[0]['offer_price_paise']==57900
    assert api.put('/account/onboarding',headers=headers,json={**setup(),'adapt_suggestions':True}).status_code==200
    assert api.post('/operations/discovery/events',headers=headers,json={'event_id':str(uuid.uuid4()),'kind':'category_view','category':'ac'}).json()['recorded']
    assert not api.get('/operations/campaigns/preferences',headers=headers).json()['push']
    assert api.put('/account/onboarding',headers=headers,json=setup()).status_code==200
    assert not main.operations_store.run(lambda u:u.get('discovery_preferences','new-google')).get('signals')


def test_pending_account_policy_survives_reload_and_changed_phone_claim(identities):
    api, identity=identities
    headers=identity()
    assert api.get('/account/onboarding',headers=headers).json()['required']
    assert api.get('/account/onboarding',headers=headers).json()['required']
    identity(phone=True)
    assert api.put('/account/onboarding',headers=headers,json=setup()).status_code==200
    identity(phone=False)
    denied=api.put('/operations/discovery/preferences',headers=headers,json={'enabled':False})
    assert denied.status_code==403
