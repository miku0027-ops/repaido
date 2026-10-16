"""Native owner-tool boundaries, atomic imports and honest payment evidence."""
import csv
import io
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
import main
import shop_tools
from operations import Unit
from test_operations import api,auth,ADMIN
from test_procurement import setup_shop,STOCK


@pytest.fixture
def shop_api(api):
    if not any(getattr(route,'path','')=='/operations/shop/tools/statement' for route in main.app.routes):
        shop_tools.install(main)
    setup_shop(api)
    return api


def csv_file(rows):
    stream=io.StringIO();writer=csv.DictWriter(stream,fieldnames=shop_tools.COLUMNS)
    writer.writeheader()
    for row in rows:
        values={**STOCK,'product_id':'cap35','expected_version':1,**row}
        writer.writerow(values)
    return stream.getvalue()


def request(api,rows):
    text=csv_file(rows)
    result=api.post('/operations/shop/tools/inventory/preview',headers=auth('shop'),json={'csv_text':text})
    assert result.status_code==200,result.text
    preview=result.json()
    return preview,{'csv_text':text,'expected_shop_version':preview['shop_version'],'preview_digest':preview['preview_digest'],'request_id':'fixture-import-request-01'}


def records():
    with main.db() as conn:
        return [tuple(row) for row in conn.execute('SELECT kind,id,body FROM operation_records ORDER BY kind,id')]


def test_preview_is_read_only_and_commit_reuses_native_validation(shop_api):
    before=records();view,body=request(shop_api,[{'on_hand':10,'price_paise':5100}])
    assert records()==before
    assert view['can_commit'] and view['rows'][0]['old_on_hand']==4 and view['rows'][0]['available']==10
    response=shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json=body)
    assert response.status_code==200,response.text
    item=main.operations_store.run(lambda u:u.get('inventory','cap35'))
    assert item['version']==2 and item['stock']==10 and item['price_paise']==5100
    after=records()
    assert shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json=body).json()==response.json()
    assert records()==after
    assert shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json={**body,'csv_text':csv_file([{'on_hand':8}])}).status_code==409


def test_invalid_row_does_not_write_any_valid_row(shop_api):
    before=records();view,_=request(shop_api,[{'product_id':'fresh','expected_version':0,'sku':'FRESH'}, {'on_hand':-1}])
    assert not view['can_commit'] and view['error_rows']==1 and view['preview_digest'] is None
    assert view['rows'][1]['errors'][0]['field']=='on_hand'
    body={'csv_text':csv_file([{'product_id':'fresh','expected_version':0,'sku':'FRESH'},{'on_hand':-1}]),'preview_digest':'0'*64,'expected_shop_version':1,'request_id':'bad-file-fixture-01'}
    assert shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json=body).status_code==409
    assert records()==before


def test_stale_rows_owner_shop_version_and_preview_digest_guard(shop_api):
    _,body=request(shop_api,[{'on_hand':8}])
    assert shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json={**body,'preview_digest':'0'*64}).status_code==409
    assert shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json={**body,'expected_shop_version':999}).status_code==409
    shop_api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json={**STOCK,'expected_version':1,'on_hand':6})
    response=shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json=body)
    assert response.status_code==409 and main.operations_store.run(lambda u:u.get('inventory','cap35'))['stock']==6


def test_reservations_duplicate_skus_refurbishment_and_media_use_canonical_rules(shop_api):
    main.operations_store.run(lambda u:u.put('inventory','cap35',{**u.get('inventory','cap35'),'reserved':3,'shop_offer':{'active':True,'discount_bps':1000}}))
    view,_=request(shop_api,[{'on_hand':2}]);assert view['rows'][0]['errors'][0]['code']=='RESERVED_STOCK'
    view,_=request(shop_api,[{'product_id':'new-part','expected_version':0}]);assert view['rows'][0]['errors'][0]['code']=='SKU_EXISTS'
    view,_=request(shop_api,[{'condition':'refurbished'}]);assert view['rows'][0]['errors'][0]['code']=='DETAILS_REQUIRED'
    view,_=request(shop_api,[{'image_url':'/api/operations/media/other-shop-photo'}]);assert view['rows'][0]['errors'][0]['code']=='INVALID_PHOTO'
    _,body=request(shop_api,[{'on_hand':5}]);response=shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json=body)
    assert response.status_code==200,response.text
    product=main.operations_store.run(lambda u:u.get('inventory','cap35'))
    assert product['stock']==2 and product['reserved']==3 and product['shop_offer']['discount_bps']==1000


def test_owner_boundaries_and_foreign_product_no_disclosure(shop_api):
    for uid,status in [('customer',403),('worker',403)]:
        assert shop_api.get('/operations/shop/tools/stock-alerts',headers=auth(uid)).status_code==status
    main.operations_store.run(lambda u:u.put('inventory','foreign',{'id':'foreign','shop_id':'other','name':'PRIVATE','sku':'PRIVATE','version':8}))
    view,_=request(shop_api,[{'product_id':'foreign','expected_version':8}])
    assert view['rows'][0]['errors'][0]['code']=='NOT_FOUND' and 'PRIVATE' not in str(view)
    assert shop_api.get('/operations/shop/tools/documents/foreign',headers=auth('shop')).status_code==404


def test_import_and_single_edit_cannot_undercut_existing_merchant_floor(shop_api):
    response=shop_api.put('/operations/shop/products/cap35/offer',headers=auth('shop'),json={'expected_version':1,'active':True,'discount_bps':1000,'min_price_paise':4000})
    assert response.status_code==200,response.text
    view,_=request(shop_api,[{'expected_version':2,'price_paise':3500}])
    assert view['rows'][0]['errors'][0]['code']=='INVALID_FLOOR'
    single=shop_api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json={**STOCK,'expected_version':2,'price_paise':3500})
    assert single.status_code==422 and single.json()['detail']['code']=='INVALID_FLOOR'
    assert main.operations_store.run(lambda u:u.get('inventory','cap35'))['price_paise']==5000


def test_csv_bounds_headers_duplicates_and_export_versions(shop_api):
    path='/operations/shop/tools/inventory/preview'
    for text in ['name,name\na,b\n','product_id,name\nx,Part\n',csv_file([{'product_id':str(i),'sku':str(i),'expected_version':0} for i in range(shop_tools.MAX_ROWS+1)])]:
        assert shop_api.post(path,headers=auth('shop'),json={'csv_text':text}).status_code==422
    view,_=request(shop_api,[{},{}]);assert view['rows'][1]['errors'][0]['code']=='DUPLICATE_PRODUCT'
    text=shop_api.get('/operations/shop/tools/inventory/export',headers=auth('shop')).json()['csv_text']
    row=list(csv.DictReader(io.StringIO(text)))[0]
    assert row['expected_version']=='1' and row['on_hand']=='4' and row['product_id']=='cap35'
    assert shop_tools.csv_cell('=HYPERLINK("bad")').startswith("'")


def test_concurrent_import_replay_commits_once(shop_api):
    _,body=request(shop_api,[{'on_hand':15}])
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json=body),range(2)))
    assert [r.status_code for r in responses]==[200,200]
    assert responses[0].json()==responses[1].json()
    assert main.operations_store.run(lambda u:u.get('inventory','cap35'))['version']==2


def test_largest_batch_counts_source_hooks_below_firestore_limit(shop_api,monkeypatch):
    view,body=request(shop_api,[{'product_id':'batch-'+str(i),'sku':'BATCH'+str(i),'expected_version':0} for i in range(shop_tools.MAX_ROWS)])
    assert view['can_commit'];counts=[];flush=Unit.flush
    def checked(unit):
        counts.append(len(unit.pending));assert len(unit.pending)<500
        return flush(unit)
    monkeypatch.setattr(Unit,'flush',checked)
    response=shop_api.post('/operations/shop/tools/inventory/commit',headers=auth('shop'),json=body)
    assert response.status_code==200,response.text
    assert max(counts)>shop_tools.MAX_ROWS and response.json()['count']==shop_tools.MAX_ROWS


def test_stock_alerts_use_available_stock_and_explicit_sample(shop_api):
    main.operations_store.run(lambda u:u.put('inventory','cap35',{**u.get('inventory','cap35'),'stock':1,'reserved':3,'stock_confirmed_at':0}))
    result=shop_api.get('/operations/shop/tools/stock-alerts',headers=auth('shop'))
    assert result.status_code==200,result.text
    data=result.json();assert data['scanned']==1 and data['items'][0]['reserved']==3
    assert data['items'][0]['reasons']==['low_stock','stock_confirmation_due']


def seed_finance():
    def seed(u):
        u.put('retail_orders','sale',{'id':'sale','customer_id':'customer','state':'paid','payment_id':'pay_fixture','received_at':time.time(),'created_at':time.time(),'delivery_address':'PRIVATE ADDRESS','items':[{'shop_id':'shop1','product_id':'cap35','name':'Capacitor','quantity':1,'total_paise':5000},{'shop_id':'other','product_id':'private','name':'PRIVATE PRODUCT','quantity':1,'total_paise':9000}]})
        u.put('shop_payables','sale:cap35',{'id':'sale:cap35','shop_id':'shop1','retail_order_id':'sale','amount_paise':5000,'status':'paid','batch_id':'batch'})
        u.put('shop_batches','batch',{'id':'batch','shop_id':'shop1','status':'processed','amount_paise':5000,'provider_id':'pout_fixture','fund_account_id':'PRIVATE BANK','idempotency_key':'PRIVATE KEY','order_ids':['sale:cap35']})
        u.put('journals','retail:sale',{'id':'retail:sale','status':'posted'})
        u.put('journals','shop-payout-batch',{'id':'shop-payout-batch','status':'posted','lines':[{'account':'parts_payable','debit':5000,'credit':0},{'account':'payment_clearing','debit':0,'credit':5000}]})
        u.put('shop_payables','foreign',{'id':'foreign','shop_id':'other','amount_paise':9000,'status':'paid'})
    main.operations_store.run(seed)


def test_statement_only_uses_real_allocations_transfers_and_shop_document_lines(shop_api):
    seed_finance()
    response=shop_api.get('/operations/shop/tools/statement',headers=auth('shop'))
    assert response.status_code==200,response.text
    data=response.json();assert len(data['entries'])==1 and data['page_totals']['confirmed_paid_paise']==5000
    assert data['entries'][0]['provider_id']=='pout_fixture' and data['entries'][0]['invoice_id'] is None
    assert 'PRIVATE' not in response.text
    document=shop_api.get('/operations/shop/tools/documents/sale:cap35',headers=auth('shop'))
    assert document.status_code==200 and len(document.json()['items'])==1 and 'PRIVATE' not in document.text
    main.operations_store.run(lambda u:u.put('journals','shop-payout-batch',{'id':'shop-payout-batch','status':'void'}))
    result=shop_api.get('/operations/shop/tools/statement',headers=auth('shop')).json()
    assert result['page_totals']['confirmed_paid_paise']==0 and 'payout_confirmation_missing' in result['entries'][0]['flags']


def test_statement_refuses_mismatched_or_reversed_payout_evidence(shop_api):
    seed_finance()
    main.operations_store.run(lambda u:u.put('shop_batches','batch',{**u.get('shop_batches','batch'),'amount_paise':6000}))
    result=shop_api.get('/operations/shop/tools/statement',headers=auth('shop')).json()
    assert result['page_totals']['confirmed_paid_paise']==0
    assert {'payout_amount_mismatch','payout_journal_mismatch'}<=set(result['entries'][0]['flags'])
    main.operations_store.run(lambda u:u.put('shop_batches','batch',{**u.get('shop_batches','batch'),'amount_paise':5000}))
    main.operations_store.run(lambda u:u.put('journals','reverse-shop-payout-batch',{'id':'reverse-shop-payout-batch','status':'posted'}))
    result=shop_api.get('/operations/shop/tools/statement',headers=auth('shop')).json()
    assert result['page_totals']['confirmed_paid_paise']==0 and 'payout_reversal_recorded' in result['entries'][0]['flags']


def test_statement_surfaces_missing_legacy_source_without_empty_document_read(shop_api,monkeypatch):
    main.operations_store.run(lambda u:u.put('shop_payables','legacy',{'id':'legacy','shop_id':'shop1','job_id':'','amount_paise':5000,'status':'held'}))
    get=Unit.get
    def valid_key(unit,kind,key):
        assert key,'Firestore document IDs cannot be empty'
        return get(unit,kind,key)
    monkeypatch.setattr(Unit,'get',valid_key)
    result=shop_api.get('/operations/shop/tools/statement',headers=auth('shop'))
    assert result.status_code==200,result.text
    assert {'source_missing','source_journal_missing'}<=set(result.json()['entries'][0]['flags'])


def test_invalid_product_and_cursor_fail_cleanly_before_firestore_reference(shop_api):
    view,_=request(shop_api,[{'product_id':'path/other','expected_version':0,'sku':'NEW'}])
    assert view['rows'][0]['errors'][0]['code']=='INVALID_ID'
    assert shop_api.get('/operations/shop/tools/statement?after=path/other',headers=auth('shop')).status_code==422


def test_response_times_unknown_remain_unknown_and_other_shop_excluded(shop_api):
    now=time.time()
    def seed(u):
        for key,fields in [('one',{'created_at':now-100,'accepted_at':now-40,'status':'accepted'}),('two',{'created_at':now-200,'status':'cancelled'}),('three',{'created_at':now-100,'status':'requested','expires_at':now-1})]:
            u.put('parts_orders',key,{'id':key,'shop_id':'shop1',**fields})
        u.put('parts_orders','other',{'id':'other','shop_id':'other','accepted_at':now,'created_at':now-1000})
    main.operations_store.run(seed)
    response=shop_api.get('/operations/shop/tools/response-report',headers=auth('shop'))
    assert response.status_code==200,response.text
    result=response.json();assert result['sample_size']==3 and result['median_accept_seconds']==60
    assert result['measured_acceptances']==1 and result['cancelled_count']==1 and result['expired_pending_count']==1
