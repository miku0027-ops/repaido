from test_operations import api, auth, ADMIN, PIN
import main

BODY=dict(owner_name='Test owner',name='Test supply shop',address='123 shop street Balasore',city='Balasore',postal_code='756001',location=PIN,categories='Electrical parts',business_reference='TEST-TRADE-001',consent=True)
REVIEW=dict(expected_version=1,decision='approved',reason='Manually checked private business case',evidence_reference='private-case-test-123',identity_checked=True,business_checked=True,address_checked=True)

def test_shop_application_approval_and_authorization(api):
    assert api.get('/operations/shop/me').status_code==401
    assert api.post('/operations/shop/application',headers=auth('customer'),json=BODY).status_code==403
    assert api.get('/operations/shop/me',headers=auth('shop')).json()=={'shop':None}
    r=api.post('/operations/shop/application',headers=auth('shop'),json=BODY);assert r.status_code==200,r.text
    s=r.json()['shop'];assert s['status']=='pending_verification' and s['owner_id']=='shop'
    assert api.post('/operations/shop/application',headers=auth('shop'),json=BODY).json()['shop']['version']==1
    assert api.get('/operations/shop/orders',headers=auth('shop')).status_code==403
    assert api.get('/operations/admin/shops',headers=auth('shop')).status_code==403
    url=f"/operations/admin/shops/{s['id']}/review"
    assert api.post(url,headers=auth('shop'),json=REVIEW).status_code==403
    assert api.post(url,headers=ADMIN,json={**REVIEW,'identity_checked':False}).status_code==409
    assert api.post(url,headers=ADMIN,json=REVIEW).json()['shop']['status']=='approved'
    assert api.get('/operations/shop/orders',headers=auth('shop')).status_code==200
    assert api.post(url,headers=ADMIN,json=REVIEW).status_code==409
    assert api.post('/operations/shop/application',headers=auth('shop'),json=BODY).status_code==409
    assert api.post(url,headers=ADMIN,json={**REVIEW,'expected_version':2,'decision':'suspended'}).status_code==200
    assert api.get('/operations/shop/orders',headers=auth('shop')).status_code==403
    assert api.get('/operations/shop/me',headers=auth('worker')).json()['shop'] is None
    audit=api.get('/operations/admin/audit',headers=ADMIN).json()['audit']
    assert any(a['action']=='ShopReviewed' for a in audit)

def test_shop_rejection_reapplication_and_privileged_fields(api):
    assert api.post('/operations/shop/application',headers=auth('shop'),json={**BODY,'status':'approved'}).status_code==422
    s=api.post('/operations/shop/application',headers=auth('shop'),json=BODY).json()['shop']
    url=f"/operations/admin/shops/{s['id']}/review"
    assert api.post(url,headers=ADMIN,json={**REVIEW,'decision':'rejected'}).status_code==200
    s=api.post('/operations/shop/application',headers=auth('shop'),json={**BODY,'name':'Corrected shop name'}).json()['shop']
    assert s['status']=='pending_verification' and s['version']==3 and 'verification' not in s
    assert api.post(url,headers=ADMIN,json=REVIEW).status_code==409
    assert api.post('/operations/admin/shops',headers=ADMIN,json=dict(id=s['id'],owner_id='shop',name='Bypass attempt',location=PIN,status='approved',evidence_reference='case-test')).status_code==409
    assert api.post('/operations/shop/application',headers=auth('shop'),json={**BODY,'name':'Different pending details'}).status_code==409

def test_non_phone_shop_owner_cannot_access_orders(api):
    main.operations_store.run(lambda u:u.put('shops','legacy',dict(id='legacy',owner_id='customer',name='Legacy shop',location=PIN,status='approved')))
    assert api.get('/operations/shop/orders',headers=auth('customer')).status_code==403
    assert api.post('/operations/shop/orders/missing/handover',headers=auth('customer')).status_code==403

def test_independent_reviewer_required(api):
    s=api.post('/operations/shop/application',headers=auth('shop'),json=BODY).json()['shop']
    main.app.dependency_overrides[main.operator]=lambda:{'id':'shop'}
    assert api.post(f"/operations/admin/shops/{s['id']}/review",headers=ADMIN,json=REVIEW).status_code==403
    del main.app.dependency_overrides[main.operator]

def test_linked_phone_preserves_customer_uid_but_shop_requires_phone_session(api,monkeypatch):
    class Firebase:
        def verify_id_token(self,*args,**kwargs):
            return {'uid':'linked-customer','phone_number':'+919876543210','firebase':{'sign_in_provider':'google.com'}}
    monkeypatch.setattr(main,'fb_auth_module',Firebase())
    user=main.current_user('Bearer firebase-linked-token')
    assert user['id']=='linked-customer' and user['phone_verified'] and not user['phone_authenticated']
