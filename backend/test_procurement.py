import time,uuid,copy
from datetime import datetime,timezone
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import main,procurement
from test_operations import api,auth,ADMIN,PIN,onboard,command
SHOP_PIN={'lat':PIN['lat']+.004,'lng':PIN['lng']}
STOCK=dict(expected_version=0,name='Capacitor 35uF',sku='CAP35',category='AC parts',compatibility='35uF 440V',price_paise=5000,on_hand=4,low_stock=1,status='approved')

def setup_shop(api):
    assert api.post('/operations/admin/shops',headers=ADMIN,json=dict(id='shop1',owner_id='shop',name='Test verified parts shop',location=SHOP_PIN,status='approved',evidence_reference='private-case-fixture')).status_code==200
    r=api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json=STOCK);assert r.status_code==200,r.text
    return r.json()

def visit(api):
    onboard(api)
    r=api.post('/operations/bookings',headers=auth('customer'),json=dict(service_id='ac-service',city='Balasore',address='Customer test location 123',phone='9876543210',location=PIN,starts_at=datetime.fromtimestamp(time.time()+4000,timezone.utc).isoformat(),idempotency_key=str(uuid.uuid4())))
    assert r.status_code==201,r.text;j=r.json();assert j['procurement_version']==3
    def legacy(u):
        row=u.get('jobs',j['id']);row['procurement_version']=2;u.put('jobs',j['id'],row)
    main.operations_store.run(legacy)
    for a in ('accept','ack_reminder','depart'):j=command(api,j,a)
    return command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
def get(api,j):return api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()
def start(api,j):
    url='/operations/jobs/'+j['id']
    code=api.get(url+'/arrival-code',headers=auth('customer')).json()['code']
    r=api.post(url+'/verify-arrival',headers=auth('worker'),json={'code':code});assert r.status_code==200,r.text
    return command(api,get(api,j),'start')
def approved_parts(api,j,qty=2):
    j=command(api,j,'propose_parts',payload={'items':[{'product_id':'cap35','quantity':qty}]})
    return command(api,j,'approve_parts','customer',{'proposal_id':j['proposal']['id']})
def accept_shop(api,j):
    oid=j['proposal']['id'];r=api.post('/operations/shop/purchase-orders/'+oid+'/decision',headers=auth('shop'),json={'expected_version':1,'decision':'accept'});assert r.status_code==200,r.text
    return get(api,j),oid

def test_inventory_versions_reservation_and_freshness(api):
    p=setup_shop(api)
    assert api.put('/operations/shop/inventory/cap35',headers=auth('worker'),json=STOCK).status_code==403
    assert api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json=STOCK).status_code==409
    assert api.put('/operations/shop/inventory/duplicate',headers=auth('shop'),json=STOCK).status_code==409
    assert api.get('/operations/inventory',headers=auth('worker')).json()['items'][0]['stock']==4
    with patch('time.time',return_value=time.time()+86401):assert api.get('/operations/inventory',headers=auth('worker')).json()['items']==[]
    j=start(api,visit(api));j=approved_parts(api,j)
    p=api.get('/operations/shop/inventory',headers=auth('shop')).json()['items'][0];assert (p['stock'],p['reserved'])==(2,2)
    assert api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json={**STOCK,'expected_version':p['version'],'on_hand':1}).status_code==409
    assert api.post('/operations/admin/inventory',headers=ADMIN,json=dict(id='cap35',name='Capacitor',shop_id='shop1',stock=1,price_paise=5000,status='approved')).status_code==409

def test_arrival_codes_private_locked_and_mandatory(api):
    j=visit(api);url='/operations/jobs/'+j['id'];command(api,j,'start',status=409)
    assert api.get(url+'/arrival-code',headers=auth('worker')).status_code==403
    code=api.get(url+'/arrival-code',headers=auth('customer')).json()['code'];assert len(code)==6
    assert code not in str(get(api,j))
    wrong='000000' if code!='000000' else '111111'
    for _ in range(5):assert api.post(url+'/verify-arrival',headers=auth('worker'),json={'code':wrong}).status_code==422
    assert api.get(url+'/arrival-code',headers=auth('customer')).status_code==429
    assert api.post(url+'/verify-arrival',headers=auth('worker'),json={'code':code}).status_code==422
    assert api.post(url+'/verify-arrival',headers=auth('stranger'),json={'code':code}).status_code==404

def test_end_to_end_pickup_timer_bill_privacy_and_payables(api):
    setup_shop(api);j=start(api,visit(api));base=j['total_paise'];j=approved_parts(api,j);assert j['total_paise']==base+10000
    command(api,j,'collect_parts',payload={'return_policy':'pickup-return-v1'},status=409)
    j,oid=accept_shop(api,j);command(api,j,'collect_parts',status=409)
    j=command(api,j,'collect_parts',payload={'return_policy':'pickup-return-v1'})
    assert not api.get('/operations/jobs/'+j['id']+'/procurement',headers=auth('worker')).json()['timer_running']
    assert api.get(f'/operations/shop/purchase-orders/{oid}/otp',headers=auth('shop')).status_code==409
    j=command(api,j,'position',payload={**SHOP_PIN,'accuracy':5,'captured_at':time.time()})
    o=api.get('/operations/shop/purchase-orders',headers=auth('shop')).json()['orders'][0];assert o['pickup_nearby'] and 'worker_location' in o
    assert 'customer_id' not in o and 'address' not in o and 'location' not in o
    code=api.get(f'/operations/shop/purchase-orders/{oid}/otp',headers=auth('shop')).json()['code']
    path=f"/operations/jobs/{j['id']}/purchase-orders/{oid}/verify-pickup"
    assert api.post(path,headers=auth('worker2'),json={'code':code}).status_code==404
    assert api.post(path,headers=auth('worker'),json={'code':code}).status_code==200
    assert api.post(path,headers=auth('worker'),json={'code':code}).status_code==200
    assert 'worker_location' not in api.get('/operations/shop/purchase-orders',headers=auth('shop')).json()['orders'][0]
    assert api.get('/operations/shop/inventory',headers=auth('shop')).json()['items'][0]['reserved']==0
    j=command(api,get(api,j),'position',payload={**PIN,'accuracy':5,'captured_at':time.time()});j=command(api,j,'return_to_site');j=command(api,j,'install_parts')
    assert api.get('/operations/jobs/'+j['id']+'/procurement',headers=auth('customer')).json()['timer_running']
    j=command(api,j,'submit_completion',payload={'notes':'Replaced capacitor and tested cooling'});j=command(api,j,'accept_completion','customer')
    main.procurement_tick();assert api.get('/operations/shop/payables',headers=auth('shop')).json()['payables'][0]['status'].startswith('held')
    def payment_fixture(u):
        row=u.get('jobs',j['id']);row['payment_status']='verified';u.put('jobs',j['id'],row)
    main.operations_store.run(payment_fixture);main.procurement_tick();main.procurement_tick()
    p=api.get('/operations/shop/payables',headers=auth('shop')).json()['payables'];assert len(p)==1 and p[0]['amount_paise']==10000 and p[0]['status']=='eligible_for_weekly_review' and p[0]['transfer_status']=='not_sent'
    def refund_fixture(u):
        row=u.get('jobs',j['id']);row['payment_status']='refunded';u.put('jobs',j['id'],row)
    main.operations_store.run(refund_fixture);main.procurement_tick();assert api.get('/operations/shop/payables',headers=auth('shop')).json()['payables'][0]['status'].startswith('held')

def test_rejection_expiry_restock_and_price_credit(api):
    setup_shop(api);j=start(api,visit(api));base=j['total_paise'];j=approved_parts(api,j);oid=j['proposal']['id']
    assert api.post(f'/operations/shop/purchase-orders/{oid}/decision',headers=auth('shop'),json={'expected_version':1,'decision':'reject','reason':'Physical stock damaged'}).status_code==200
    assert get(api,j)['total_paise']==base
    assert api.get('/operations/shop/inventory',headers=auth('shop')).json()['items'][0]['stock']==4
    assert api.post(f'/operations/shop/purchase-orders/{oid}/decision',headers=auth('shop'),json={'expected_version':1,'decision':'accept'}).status_code==409
    p=api.get('/operations/shop/inventory',headers=auth('shop')).json()['items'][0]
    assert api.get('/operations/inventory',headers=auth('worker')).json()['items']==[]
    assert api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json={**STOCK,'expected_version':p['version']}).status_code==200
    j=approved_parts(api,get(api,j))
    with patch('time.time',return_value=time.time()+1801):main.procurement_tick();main.procurement_tick()
    assert get(api,j)['total_paise']==base
    assert api.get('/operations/shop/inventory',headers=auth('shop')).json()['items'][0]['stock']==4

def test_concurrent_stock_cannot_be_oversold(api):
    setup_shop(api);j=start(api,visit(api));j=command(api,j,'propose_parts',payload={'items':[{'product_id':'cap35','quantity':3}]})
    other=copy.deepcopy(main.operations_store.run(lambda u:u.get('jobs',j['id'])));other['id']=str(uuid.uuid4());other['proposal']['id']=str(uuid.uuid4());main.operations_store.run(lambda u:u.put('jobs',other['id'],other))
    def buy(job):return api.post('/operations/jobs/'+job['id']+'/commands',headers=auth('customer'),json={'action':'approve_parts','command_id':str(uuid.uuid4()),'expected_version':job['version'],'payload':{'proposal_id':job['proposal']['id']}}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(buy,[j,other]))
    assert sorted(results)==[200,409]
    p=api.get('/operations/shop/inventory',headers=auth('shop')).json()['items'][0];assert (p['stock'],p['reserved'])==(1,3)

def test_measured_stillness_no_missing_gps_penalty(api):
    setup_shop(api);j=start(api,visit(api));j=approved_parts(api,j);j,oid=accept_shop(api,j);j=command(api,j,'collect_parts',payload={'return_policy':'pickup-return-v1'});j=command(api,j,'position',payload={**SHOP_PIN,'accuracy':5,'captured_at':time.time()})
    code=api.get(f'/operations/shop/purchase-orders/{oid}/otp',headers=auth('shop')).json()['code'];api.post(f"/operations/jobs/{j['id']}/purchase-orders/{oid}/verify-pickup",headers=auth('worker'),json={'code':code})
    start_at=time.time()
    for delta in range(15,736,15):
        with patch('time.time',return_value=start_at+delta):j=command(api,get(api,j),'position',payload={**SHOP_PIN,'accuracy':5,'captured_at':start_at+delta})
    order=main.operations_store.run(lambda u:u.get('parts_orders',oid));assert order['assessment_paise']==1000
    with patch('time.time',return_value=start_at+1100):j=command(api,get(api,j),'position',payload={**SHOP_PIN,'accuracy':5,'captured_at':start_at+1100})
    assert main.operations_store.run(lambda u:u.get('parts_orders',oid))['assessment_paise']==1000
    with patch('time.time',return_value=start_at+1115):j=command(api,get(api,j),'position',payload={'lat':SHOP_PIN['lat']-.0006,'lng':SHOP_PIN['lng'],'accuracy':5,'captured_at':start_at+1115})
    assert main.operations_store.run(lambda u:u.get('parts_orders',oid))['return_monitor_ended']
    assert api.post(f'/operations/admin/purchase-orders/{oid}/assessment',headers=auth('worker'),json={'decision':'approved','expected_amount_paise':1000,'reason':'Trying to approve own assessment'}).status_code==403
    assert api.post(f'/operations/admin/purchase-orders/{oid}/assessment',headers=ADMIN,json={'decision':'waived','expected_amount_paise':1000,'reason':'Traffic obstruction verified in support case'}).status_code==200

def test_reviewed_return_deduction_is_highest_and_capped(api):
    from test_integrations import completed,payment_fixture
    import integrations
    j=completed(api);payment=payment_fixture(j)
    def seed(u):
        integrations.apply_payment(u,payment);row=u.get('jobs',j['id']);row['settlement_policy']=dict(version='return-test',worker_share_bps=7500,bonus_reserve_bps=1000,penalty_cap_bps=5000,stack_penalties=False,penalty_mode='highest_single');row['parts_order_ids']=['assessment'];row['penalties']=[];u.put('jobs',j['id'],row)
        u.put('parts_orders','assessment',dict(id='assessment',job_id=j['id'],worker_id='worker',assessment_paise=999999,assessment_status='review_required',return_monitor_ended=time.time()))
    main.operations_store.run(seed)
    url='/operations/admin/settlements/'+j['id']+'/calculate'
    assert api.post(url,headers=ADMIN).status_code==409
    assert api.post('/operations/admin/purchase-orders/assessment/assessment',headers=ADMIN,json={'decision':'approved','expected_amount_paise':999999,'reason':'Verified test assessment with supporting evidence'}).status_code==200
    s=api.post(url,headers=ADMIN).json();assert s['net_paise']==0 and s['deduction_paise']==s['gross_paise']
    assert s['company_earnings_paise']==s['company_base_commission_paise']+s['deduction_paise']

def test_expired_quote_can_be_declined_and_replaced(api):
    setup_shop(api);j=start(api,visit(api));j=command(api,j,'propose_parts',payload={'items':[{'product_id':'cap35','quantity':1}]})
    with patch('time.time',return_value=time.time()+3601):
        command(api,j,'approve_parts','customer',{'proposal_id':j['proposal']['id']},status=409)
        j=command(api,j,'reject_parts','customer',{'proposal_id':j['proposal']['id']})
    assert 'propose_parts' in get(api,j)['allowed_actions']
    assert api.get('/operations/shop/inventory',headers=auth('shop')).json()['items'][0]['reserved']==0

def test_continuous_walking_is_not_stationary(api):
    start_at=time.time()
    def simulate(u):
        j={'id':'walking-job','customer_id':'customer','state':'collecting_parts','location':PIN,'parts_order_ids':['walking-order'],'events':[],'version':1}
        initial={**SHOP_PIN,'accuracy':5,'captured_at':start_at,'received_at':start_at}
        u.put('parts_orders','walking-order',dict(id='walking-order',status='picked_up',last_fix=initial,assessment_paise=0))
        for seconds in range(15,901,15):
            j['position']={**SHOP_PIN,'lat':SHOP_PIN['lat']+seconds/111000,'accuracy':5,'captured_at':start_at+seconds,'received_at':start_at+seconds}
            procurement.movement(u,j,start_at+seconds)
        return u.get('parts_orders','walking-order')
    assert main.operations_store.run(simulate)['assessment_paise']==0
