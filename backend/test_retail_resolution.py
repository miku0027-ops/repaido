"""Owned returns, financial holds, verified refund receipts and safe retries."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import main
import retail_resolution as resolutions
from test_operations import api, auth, ADMIN
from test_local_business import doc

BASE='/operations/retail'


def order(*,funded=False,received=True,policy=True):
    oid=uuid.uuid4().hex
    line=dict(product_id='item-'+oid,shop_id='shop-'+oid,name='Refurbished appliance',quantity=1,total_paise=10000,discount_paise=2000,condition='refurbished')
    if policy:line['return_policy']=dict(return_days=7,return_terms='Return to the shop if the disclosed condition does not match.',warranty_terms='Repair warranty for reviewed faults.',version=1,source='seller_disclosure_at_checkout')
    row=dict(id=oid,customer_id='customer',items=[line],state='paid',payment_id='pay_'+oid,order_id='order_'+oid,total_paise=8000,discount_paise=2000,created_at=time.time(),paid_at=time.time(),coupon={'funded_by':'repaido' if funded else 'shop'})
    if received:row['received_at']=time.time()
    def save(u):
        u.put('shops',line['shop_id'],dict(id=line['shop_id'],owner_id='shop',name='Actual seller',status='approved'))
        u.put('retail_orders',oid,row)
        u.put('shop_payables',oid+':'+line['product_id'],dict(id=oid+':'+line['product_id'],retail_order_id=oid,job_id='',shop_id=line['shop_id'],amount_paise=10000 if funded else 8000,status='retail_receipt_review'))
        lines=[dict(account='payment_clearing',debit=8000,credit=0),dict(account='parts_payable',debit=0,credit=10000 if funded else 8000)]
        if funded:lines.append(dict(account='community_reward_expense',debit=2000,credit=0))
        u.put('journals','retail:'+oid,dict(id='retail:'+oid,status='posted',retail_order_id=oid,lines=lines))
    main.operations_store.run(save)
    return row


def open_case(api,purchase,kind='return',status=200,**changes):
    body=dict(request_id=str(uuid.uuid4()),product_id=purchase['items'][0]['product_id'],quantity=1,kind=kind,
              reason='The delivered item does not match the condition stated when I purchased it.',document_ids=[])
    body.update(changes)
    result=api.post(BASE+'/orders/'+purchase['id']+'/resolutions',headers=auth('customer'),json=body)
    assert result.status_code==status,result.text
    return result.json(),body


def act(api,row,action,uid='shop',status=200,**changes):
    body=dict(request_id=str(uuid.uuid4()),expected_version=row['version'],action=action,note='The item condition and supporting evidence have been checked.',document_ids=[])
    body.update(changes)
    result=api.post(BASE+'/resolutions/'+row['id']+'/actions',headers=auth(uid),json=body)
    assert result.status_code==status,result.text
    return result.json(),body


def decide(api,row,decision='approve_refund',status=200,amount=8000,**changes):
    body=dict(request_id=str(uuid.uuid4()),expected_version=row['version'],decision=decision,note='The evidence confirms the discrepancy and supports this independently reviewed decision.',evidence_reference='review-case-document-123',refund_amount_paise=amount if decision=='approve_refund' else 0)
    body.update(changes)
    result=api.post(BASE+'/admin/resolutions/'+row['id']+'/decision',headers=ADMIN,json=body)
    assert result.status_code==status,result.text
    return result.json(),body


def gateway(monkeypatch,purchase,*,unknown=False,hide=False):
    state=dict(posts=0,refunds=[],amount_refunded=0)
    monkeypatch.setattr(resolutions,'payments_ready',lambda:True)
    def provider(path,body=None):
        if path=='payments/'+purchase['payment_id']:
            return dict(id=purchase['payment_id'],order_id=purchase['order_id'],amount=purchase['total_paise'],currency='INR',captured=True,status='refunded' if state['amount_refunded']==purchase['total_paise'] else 'captured',amount_refunded=state['amount_refunded'])
        if body is not None:
            state['posts']+=1
            result=dict(id='rfnd_Actual'+str(state['posts']),payment_id=purchase['payment_id'],amount=body['amount'],receipt=body['receipt'],currency='INR',status='processed')
            state['refunds'].append(result)
            state['amount_refunded']+=body['amount']
            if unknown:raise TimeoutError('Lost provider response')
            return result
        if '/refunds?' in path:return {'items':[] if hide else state['refunds']}
        if path.startswith('refunds/'):return next(row for row in state['refunds'] if row['id']==path.split('/')[1])
        raise AssertionError(path)
    monkeypatch.setattr(resolutions,'razorpay',provider)
    return state


def test_return_request_ownership_immutable_terms_and_financial_hold(api):
    purchase=order()
    row,body=open_case(api,purchase)
    assert row['policy_window']['status']=='within_window' and row['max_refund_paise']==8000
    assert row['viewer_role']=='customer' and 'reply' in row['allowed_actions']
    replay=api.post(BASE+'/orders/'+purchase['id']+'/resolutions',headers=auth('customer'),json=body)
    assert replay.json()['id']==row['id']
    assert api.get(BASE+'/orders/'+purchase['id']+'/resolutions',headers=auth('stranger')).status_code==404
    assert api.get(BASE+'/resolutions/'+row['id'],headers=auth('worker')).status_code==404
    shop=api.get(BASE+'/resolutions/'+row['id'],headers=auth('shop')).json()
    assert shop['viewer_role']=='shop' and 'authorize_return' in shop['allowed_actions']
    assert 'customer_id' not in shop
    saved,payable=main.operations_store.run(lambda u:(u.get('retail_orders',purchase['id']),u.get('shop_payables',purchase['id']+':'+body['product_id'])))
    assert saved['financial_hold'] and payable['financial_hold'] and payable['status']=='retail_resolution_hold'
    assert 'target' in row['target_note'].lower()
    historic=order(policy=False)
    assert open_case(api,historic)[0]['policy_window']['status']=='manual_review'
    late=order()
    main.operations_store.run(lambda u:u.put('retail_orders',late['id'],{**late,'received_at':time.time()-9*86400}))
    assert open_case(api,late)[0]['policy_window']['status']=='outside_window'


def test_closing_case_does_not_release_an_unrelated_financial_hold(api):
    purchase=order()
    pid=purchase['id']+':'+purchase['items'][0]['product_id']
    def hold(u):
        u.put('retail_orders',purchase['id'],{**u.get('retail_orders',purchase['id']),'financial_hold':True})
        u.put('shop_payables',pid,{**u.get('shop_payables',pid),'financial_hold':True,'status':'manual_finance_review'})
    main.operations_store.run(hold)
    row,_=open_case(api,purchase,kind='complaint')
    row,_=decide(api,row,decision='resolve')
    saved,payable=main.operations_store.run(lambda u:(u.get('retail_orders',purchase['id']),u.get('shop_payables',pid)))
    assert saved['financial_hold'] and payable['financial_hold'] and payable['status']=='manual_finance_review'


def test_return_receipt_roles_private_evidence_and_appeal(api,monkeypatch):
    purchase=order()
    row,_=open_case(api,purchase,document_ids=[doc('customer')])
    decide(api,row,status=409)
    act(api,row,'authorize_return',uid='customer',return_by=time.time()+86400,status=409)
    row,_=act(api,row,'authorize_return',return_by=time.time()+86400)
    row,_=act(api,row,'return_sent',uid='customer')
    act(api,row,'return_received',status=409)
    row,_=act(api,row,'return_received',document_ids=[doc('shop')])
    assert row['return_receipt_at']
    did=row['events'][-1]['document_ids'][0]
    monkeypatch.setattr(resolutions,'download_object',lambda _:b'private-evidence')
    assert api.get(BASE+'/resolutions/'+row['id']+'/evidence/'+did,headers=auth('customer')).content==b'private-evidence'
    assert api.get(BASE+'/resolutions/'+row['id']+'/evidence/'+did,headers=auth('stranger')).status_code==404
    row,_=decide(api,row,decision='reject')
    assert not main.operations_store.run(lambda u:u.get('retail_orders',purchase['id']))['financial_hold']
    row,_=act(api,row,'appeal',uid='customer')
    assert row['state']=='appealed' and main.operations_store.run(lambda u:u.get('retail_orders',purchase['id']))['financial_hold']
    row,_=decide(api,row,decision='reject')
    act(api,row,'appeal',uid='customer',status=409)


def test_funded_refund_reverses_exact_liability_and_subsidy_once(api,monkeypatch):
    purchase=order(funded=True)
    row,_=open_case(api,purchase,kind='refund')
    row,_=decide(api,row)
    provider=gateway(monkeypatch,purchase)
    path=BASE+'/admin/resolutions/'+row['id']+'/refund'
    result=api.post(path,headers=ADMIN,json={})
    assert result.status_code==200,result.text
    assert result.json()['state']=='resolved' and result.json()['refund_status']=='processed'
    assert api.post(path,headers=ADMIN,json={}).status_code==200
    assert provider['posts']==1
    saved,payable,journals=main.operations_store.run(lambda u:(u.get('retail_orders',purchase['id']),u.get('shop_payables',purchase['id']+':'+purchase['items'][0]['product_id']),[j for j in u.all('journals') if j['id'].startswith('retail-refund:')]))
    assert saved['state']=='refunded' and saved['amount_refunded']==8000 and not saved['financial_hold'] and not saved['refund_pending']
    assert payable['amount_paise']==0 and payable['refund_paise']==10000 and payable['status']=='refund_completed'
    assert len(journals)==1 and sum(line['debit']-line['credit'] for line in journals[0]['lines'])==0
    assert next(line for line in journals[0]['lines'] if line['account']=='community_reward_expense')['credit']==2000


def test_lost_refund_response_reconciles_without_second_post(api,monkeypatch):
    purchase=order()
    row,_=open_case(api,purchase,kind='refund')
    row,_=decide(api,row)
    provider=gateway(monkeypatch,purchase,unknown=True)
    path=BASE+'/admin/resolutions/'+row['id']+'/refund'
    assert api.post(path,headers=ADMIN,json={}).status_code==503
    assert main.operations_store.run(lambda u:u.get('retail_orders',purchase['id']))['refund_pending']
    result=api.post(path,headers=ADMIN,json={})
    assert result.status_code==200,result.text
    assert result.json()['refund_status']=='processed' and provider['posts']==1


def test_absent_receipt_never_reposts_and_transferred_allocations_block_refunds(api,monkeypatch):
    purchase=order()
    row,_=open_case(api,purchase,kind='refund')
    row,_=decide(api,row)
    provider=gateway(monkeypatch,purchase,unknown=True,hide=True)
    path=BASE+'/admin/resolutions/'+row['id']+'/refund'
    assert api.post(path,headers=ADMIN,json={}).status_code==503
    for _ in range(2):
        result=api.post(path,headers=ADMIN,json={})
        assert result.status_code==200 and 'unknown' in result.json()['recovery']
    assert provider['posts']==1
    transferred=order()
    row,_=open_case(api,transferred,kind='refund')
    pid=transferred['id']+':'+transferred['items'][0]['product_id']
    main.operations_store.run(lambda u:u.put('shop_payables',pid,{**u.get('shop_payables',pid),'batch_id':'already-transferred'}))
    decide(api,row,status=409)


def test_provider_amount_mismatch_external_refund_and_overpayment_fail_closed(api,monkeypatch):
    purchase=order()
    row,_=open_case(api,purchase,kind='refund')
    decide(api,row,amount=8001,status=422)
    row,_=decide(api,row)
    provider=gateway(monkeypatch,purchase)
    provider['amount_refunded']=100
    path=BASE+'/admin/resolutions/'+row['id']+'/refund'
    assert api.post(path,headers=ADMIN,json={}).status_code==409 and provider['posts']==0
    provider['amount_refunded']=0
    real=resolutions.razorpay
    def bad_receipt(path,body=None):
        result=real(path,body)
        if body:result={**result,'receipt':'foreign-receipt'}
        return result
    monkeypatch.setattr(resolutions,'razorpay',bad_receipt)
    assert api.post(path,headers=ADMIN,json={}).status_code==409
    saved=main.operations_store.run(lambda u:u.get('retail_orders',purchase['id']))
    assert saved['refund_pending'] and not saved.get('amount_refunded')
    assert not main.operations_store.run(lambda u:[j for j in u.all('journals') if j['id'].startswith('retail-refund:')])


def test_concurrent_same_refund_does_not_duplicate_provider_post(api,monkeypatch):
    purchase=order()
    row,_=open_case(api,purchase,kind='refund')
    row,_=decide(api,row)
    provider=gateway(monkeypatch,purchase)
    path=BASE+'/admin/resolutions/'+row['id']+'/refund'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:api.post(path,headers=ADMIN,json={}),range(2)))
    assert all(result.status_code==200 for result in results),[result.text for result in results]
    assert provider['posts']==1


def test_processed_money_reconciles_even_when_the_reply_cap_is_reached(api,monkeypatch):
    purchase=order()
    row,_=open_case(api,purchase,kind='refund')
    row,_=decide(api,row)
    def fill(u):
        saved=u.get('retail_resolution_cases',row['id'])
        saved['events']=[dict(id=str(i),role='customer',action='reply',text='Prior case correspondence',document_ids=[],at=time.time()) for i in range(149)]
        u.put('retail_resolution_cases',row['id'],saved)
    main.operations_store.run(fill)
    provider=gateway(monkeypatch,purchase)
    result=api.post(BASE+'/admin/resolutions/'+row['id']+'/refund',headers=ADMIN,json={})
    assert result.status_code==200,result.text
    assert result.json()['refund_status']=='processed' and len(result.json()['events'])==151
    assert main.operations_store.run(lambda u:u.get('retail_orders',purchase['id']))['amount_refunded']==8000
    assert provider['posts']==1


@pytest.mark.parametrize('corruption',['missing_journal','reversed','wrong_shop','wrong_source','changed_allocation','unbalanced_capture'])
def test_unproven_original_liability_blocks_provider_post(api,monkeypatch,corruption):
    purchase=order()
    row,_=open_case(api,purchase,kind='refund')
    row,_=decide(api,row)
    def corrupt(u):
        pid=purchase['id']+':'+purchase['items'][0]['product_id']
        payable=u.get('shop_payables',pid)
        journal=u.get('journals','retail:'+purchase['id'])
        if corruption=='missing_journal':journal['status']='draft'
        elif corruption=='reversed':u.put('journals','reverse_retail:'+purchase['id'],{'status':'posted'})
        elif corruption=='wrong_shop':payable['shop_id']='another-shop'
        elif corruption=='wrong_source':payable['retail_order_id']='another-order'
        elif corruption=='changed_allocation':payable['amount_paise']+=1
        else:journal['lines'][0]['debit']+=1
        u.put('journals','retail:'+purchase['id'],journal)
        u.put('shop_payables',pid,payable)
    main.operations_store.run(corrupt)
    provider=gateway(monkeypatch,purchase)
    result=api.post(BASE+'/admin/resolutions/'+row['id']+'/refund',headers=ADMIN,json={})
    assert result.status_code==409 and provider['posts']==0


def test_checkout_policy_snapshot_and_no_global_case_scans(api,monkeypatch):
    from test_retail_checkout import seed
    seed()
    main.operations_store.run(lambda u:u.put('inventory','ref',{**u.get('inventory','ref'),'refurbishment':{'return_days':7,'return_terms':'Return on a disclosed condition mismatch.','warranty_days':30,'warranty_terms':'Repair cover.'}}))
    quote=api.post(BASE+'/quote',headers=auth('customer'),json={'items':[{'product_id':'ref','quantity':1}]}).json()
    assert quote['items'][0]['return_policy']['return_days']==7
    purchase=order()
    row,_=open_case(api,purchase,kind='complaint')
    import operations
    monkeypatch.setattr(operations.Unit,'all',lambda *_:(_ for _ in ()).throw(AssertionError('No global case scan')))
    assert len(api.get(BASE+'/orders/'+purchase['id']+'/resolutions',headers=auth('customer')).json()['cases'])==1
    assert len(api.get(BASE+'/resolutions/shop?shop_id='+purchase['items'][0]['shop_id'],headers=auth('shop')).json()['cases'])==1
    assert len(api.get(BASE+'/admin/resolutions',headers=ADMIN).json()['cases'])==1


def test_actual_checkout_snapshot_survives_catalogue_edit_and_partial_refund(api,monkeypatch):
    from test_retail_checkout import seed,body,gateway as checkout_gateway
    seed()
    main.operations_store.run(lambda u:u.put('inventory','ref',{**u.get('inventory','ref'),'refurbishment':{'return_days':7,'return_terms':'Return to shop for a condition mismatch.'}}))
    checkout_gateway(monkeypatch)
    response=api.post(BASE+'/orders',headers=auth('customer'),json=body())
    assert response.status_code==201,response.text
    purchase=response.json()
    confirmed=api.post(BASE+'/orders/'+purchase['id']+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'})
    assert confirmed.status_code==200,confirmed.text
    purchase=confirmed.json()
    main.operations_store.run(lambda u:u.put('inventory','ref',{**u.get('inventory','ref'),'refurbishment':{'return_days':0,'return_terms':'Changed after this purchase.'}}))
    row,_=open_case(api,purchase,kind='refund')
    assert row['item']['return_policy']['return_days']==7
    row,_=decide(api,row,amount=10800)
    provider=gateway(monkeypatch,purchase)
    result=api.post(BASE+'/admin/resolutions/'+row['id']+'/refund',headers=ADMIN,json={})
    assert result.status_code==200,result.text
    saved=main.operations_store.run(lambda u:u.get('retail_orders',purchase['id']))
    assert saved['state']=='paid' and saved['amount_refunded']==10800 and not saved['refund_pending']
    assert provider['posts']==1


def test_unrelated_extra_refund_during_provider_processing_requires_reconciliation(api,monkeypatch):
    purchase=order()
    row,_=open_case(api,purchase,kind='refund')
    row,_=decide(api,row,amount=4000)
    provider=gateway(monkeypatch,purchase)
    original=resolutions.razorpay
    def extra(path,body=None):
        response=original(path,body)
        if body:provider['amount_refunded']+=100
        return response
    monkeypatch.setattr(resolutions,'razorpay',extra)
    response=api.post(BASE+'/admin/resolutions/'+row['id']+'/refund',headers=ADMIN,json={})
    assert response.status_code==409
    assert main.operations_store.run(lambda u:u.get('retail_orders',purchase['id']))['refund_pending']
    assert not main.operations_store.run(lambda u:[j for j in u.all('journals') if j['id'].startswith('retail-refund:')])
