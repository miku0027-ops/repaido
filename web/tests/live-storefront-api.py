"""Native SQLite QA app. Only identities/media/gateway are local substitutes."""
import io
import os
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1], REPAIDO_ADMIN_KEY='test-operator-key',
                  REPAIDO_KYC_BUCKET='local-memory-only', REPAIDO_PAYMENTS_ENABLED='true', REPAIDO_COMMERCE_RANKING_URL='',
                  RAZORPAY_KEY_ID='rzp_test_local', RAZORPAY_KEY_SECRET='fixture-not-a-secret',
                  RAZORPAY_WEBHOOK_SECRET='fixture-not-a-secret')
import main
import marketplace
import shop_access
import market_access
import uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
ACTORS = ('buyer', 'seller', 'stranger', 'shop2', 'legacy', 'expired', 'admin')
PIN = {'lat': 21.4934, 'lng': 86.9135}
photos = {}
image = io.BytesIO(); Image.new('RGB', (48, 48), '#22478a').save(image, format='JPEG')
photos['fixture'] = image.getvalue()
marketplace.upload_object = lambda key, data: photos.__setitem__(key, data)
marketplace.download_object = lambda key: photos[key]
def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ACTORS: raise HTTPException(401)
    return dict(id=uid, name=uid.title()+' Fixture', email=uid+'@private.example.test', phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user] = actor

def operator(authorization: str = Header(default='')):
    if authorization != 'Bearer admin': raise HTTPException(403)
    return {'id':'fixture-company-admin'}
main.app.dependency_overrides[main.operator] = operator
orders = {}; states = {}
def provider(path, body=None):
    if path == 'orders' and body:
        oid = 'order_Storefront'+str(len(orders)+1)
        orders[oid] = {**body,'id':oid}; states[oid] = 'created'; return orders[oid]
    if path.startswith('orders?receipt='):
        return {'items':[row for row in orders.values() if row['receipt']==path.partition('=')[2]]}
    if path.startswith('orders/') and path.endswith('/payments'):
        oid=path.split('/')[1]
        return {'items':[] if states[oid]=='created' else [payment('pay_'+oid.removeprefix('order_'))]}
    if path.startswith('payments/'):return payment(path.split('/')[1])
    raise AssertionError('Unexpected local provider path: '+path)
def payment(pid):
    oid='order_'+pid.removeprefix('pay_'); amount=orders[oid]['amount']
    return dict(id=pid,order_id=oid,status=states[oid],amount=amount,currency='INR',captured=states[oid]=='captured',amount_refunded=amount if states[oid]=='refunded' else 0)
shop_access.razorpay=provider
market_access.razorpay=provider

@main.app.get('/__fixture')
def snapshot():
    def read(u):
        namespaces=('shop_access_payments','shop_access_members','shop_access_accounts','shop_access_settings','market_access_trials','market_chat_presence','shop_presence_month','discovery_preferences','shop_discovery_events','discovery_events','commerce_interest','commerce_event_dedup','commerce_events','shop_reviews')
        return {'counts':{name:len(u.all(name)) for name in namespaces},'payments':u.all('shop_access_payments'),'interest':u.all('commerce_interest'),'event_dedup':u.all('commerce_event_dedup')}
    return {**main.operations_store.run(read),'orders':orders,'payment_states':states}
@main.app.post('/__fixture/payment/{oid}/{state}')
def state(oid:str,state:str):
    assert oid in orders and state in ('created','captured','refunded'); states[oid]=state; return {'ok':True}
@main.app.post('/__fixture/expire-shop/{sid}')
def expire(sid:str):
    assert sid in ('seller-shop','related-shop','expired-shop')
    def save(u):
        shop=u.get('shops',sid);shop['created_at']=time.time()-91*86400;shop['submitted_at']=shop['created_at'];u.put('shops',sid,shop)
        u.put('shop_access_members',sid,dict(id=sid,grants=[]))
    main.operations_store.run(save);return {'ok':True}
@main.app.post('/__fixture/expire-shop-presence/{sid}')
def expire_shop_presence(sid:str):
    def save(u):
        row=u.get('shop_public_presence',sid)
        if row:
            for session in row.get('sessions',{}).values():session['expires_at']=time.time()-1;session['online_until']=time.time()-1
            row['expires_at']=time.time()-1;u.put('shop_public_presence',sid,row)
    main.operations_store.run(save);return {'ok':True}
@main.app.post('/__fixture/expire-presence/{cid}')
def expire_presence(cid:str):
    def save(u):
        for row in u.all('market_chat_presence'):
            if row['id'] in [__import__('market_presence')._key(cid,uid) for uid in ACTORS]:
                for session in row['sessions'].values():session.update(online_until=time.time()-1,typing_until=time.time()-1)
                u.put('market_chat_presence',row['id'],row)
    main.operations_store.run(save);return {'ok':True}

def seed(u):
    now=time.time()
    u.put('market_photos','fixture-photo',dict(id='fixture-photo',owner_id='seller',object='fixture',created_at=now))
    for uid in ('seller','buyer'):u.put('market_access_trials',uid,dict(id=uid,starts_at=now,policy=market_access.POLICY))
    for lid,mode,name,status in [('seller-used','second_hand','Fixture used phone','published'),('seller-swap','exchange','Fixture swap laptop','published'),('seller-private','second_hand','Private hidden fixture','draft'),('seller-closed','exchange','Closed hidden fixture','closed')]:
        row=dict(id=lid,owner_id='seller',owner_name='Seller Fixture',contact_phone='+919876543210',mode=mode,name=name,brand='Fixture Brand',product_type='phone' if mode=='second_hand' else 'computer',desired_type='phone',desired_product='Fixture phone',value_paise=500000,purchase_paise=1200000,age_months=12,manufacture_year=2025,warranty='No warranty',condition='Working item with scratches and cable.',reason='Changing to a different model.',photo_id='fixture-photo',city='Balasore',location=PIN,radius_km=10,share_contact=True,status=status,created_at=now,trial_started_at=now,expires_at=now+90*86400,fee_paise=0,fee_status='free_trial',access_policy=market_access.POLICY)
        u.put('market_listings',lid,row)
    for sid,owner,name,verified,days in [('seller-shop','seller','Fixture Precision Spares',True,5),('related-shop','shop2','Fixture Related Spares',True,10),('legacy-shop','legacy','Fixture Legacy Unverified',False,2),('expired-shop','expired','Fixture Expired Spares',True,91)]:
        row=dict(id=sid,owner_id=owner,name=name,owner_name=owner+' private owner',phone='+919876543210',email=owner+'@private.example.test',address='Public business address 42',city='Balasore',postal_code='756001',location=PIN,categories='Electrical, Appliances',business_reference='PRIVATE-GST-123',status='approved',version=1,created_at=now-days*86400)
        if verified:row.update(submitted_at=row['created_at'],reviewed_at=row['created_at']+60,reviewed_by='independent-admin',verification=dict(identity_checked=True,business_checked=True,address_checked=True,evidence_reference='PRIVATE-KYC-REFERENCE'))
        u.put('shops',sid,row)
    for pid,sid,name,category,base in [('spare-motor','seller-shop','Fixture Washing Motor','Appliances',100000),('spare-belt','seller-shop','Fixture Motor Belt','Appliances',20000),('spare-wire','seller-shop','Fixture Electrical Cable','Electrical',10000),('related-motor','related-shop','Fixture Compatible Motor','Appliances',90000),('legacy-plug','legacy-shop','Fixture Legacy Plug','Electrical',10000),('expired-part','expired-shop','Fixture Expired Motor','Appliances',10000)]:
        u.put('inventory',pid,dict(id=pid,shop_id=sid,name=name,sku=pid.upper(),category=category,compatibility='Universal fixture appliances',condition='new',status='approved',stock=8,reserved=0,stock_confirmed_at=now,price_paise=base,gst_bps=1800,version=1,image_url='/images/service-photos.png',warranty='12 month manufacturer warranty'))
    u.put('rental_inventory','seller-rental',dict(id='seller-rental',shop_id='seller-shop',name='Fixture rental drill',category='Power Tools',image_url='/images/service-photos.png',active=True,total_units=2,reserved=0,quarantined=0,daily_paise=10000,weekly_paise=50000,monthly_paise=150000,deposit_paise=100000,delivery_fee_paise=0,description='Fixture working drill',version=1))
    # Real received order lineage, without purchaser details in public projections.
    for n in range(5):
        uid='buyer' if n==0 else 'stranger'
        items=[dict(product_id=pid,shop_id='seller-shop',name=name,quantity=1,unit_price_paise=price,total_paise=price,condition='new',category='Appliances') for pid,name,price in [('spare-motor','Fixture Washing Motor',95000),('spare-belt','Fixture Motor Belt',19000)]]
        u.put('retail_orders','received-'+str(n),dict(id='received-'+str(n),customer_id=uid,state='paid',payment_id='pay_native'+str(n),received_at=now-86400*(n+1),paid_at=now-86400*(n+1),created_at=now-86400*(n+1),items=items,total_paise=114000,recipient_name='PRIVATE CUSTOMER',recipient_phone='9876543210',delivery_address='PRIVATE HOME ADDRESS'))
with TestClient(main.app):main.operations_store.run(seed)
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
