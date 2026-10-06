"""Real wholesale HTTP transactions against isolated SQLite; no external charges."""
import copy
import io
import uuid
from unittest.mock import patch

import pytest
from PIL import Image
import b2b
import main
from operations import Unit
from test_operations import api, auth, ADMIN, PIN


def setup(api):
    response = api.post('/operations/admin/shops',headers=ADMIN,json=dict(id='shop1',owner_id='shop',name='Actual test supplier',location=PIN,status='approved',evidence_reference='test-private-review'))
    assert response.status_code==200,response.text
    def seed(u):
        shop=u.get('shops','shop1')
        shop.update(city='Balasore',address='Real fixture business address',phone='+919876543210',email='shop@example.test')
        u.put('shops','shop1',shop)
    main.operations_store.run(seed)


def listing_body(**changes):
    value=dict(shop_id='shop1',request_id=str(uuid.uuid4()),title='Copper coil for commercial HVAC',category='hvac',part_number='COIL-50',hsn_code='74112100',unit='Rolls',
               moq=10,base_price_paise=145000,mrp_paise=235000,bulk_slabs=[dict(min_qty=10,max_qty=24,price_paise=145000,discount_label='Wholesale'),dict(min_qty=25,max_qty=None,price_paise=132000,discount_label='Volume rate')],
               stock=300,lead_time_days=2,supply_capacity='2000 rolls per month',description='Declared copper coil specifications',specifications={'Wall':'0.8 mm'},image=None)
    return {**value,**changes}


def create_listing(api,**changes):
    response=api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_body(**changes))
    assert response.status_code==200,response.text
    return response.json()['listing']


def rfq_body(listing,**changes):
    value=dict(request_id=str(uuid.uuid4()),listing_id=listing['id'],customer_name='Actual test buyer',customer_phone='9876543210',customer_email='buyer@example.test',
               delivery_address='Customer delivery fixture address',delivery_city='Balasore',delivery_pincode='756019',quantity_requested=35,notes='Actual inquiry notes')
    return {**value,**changes}


def create_rfq(api,listing,**changes):
    response=api.post('/operations/b2b/rfq',headers=auth('customer'),json=rfq_body(listing,**changes))
    assert response.status_code==200,response.text
    return response.json()['rfq']


def quote_body(rfq,**changes):
    value=dict(request_id=str(uuid.uuid4()),rfq_id=rfq['id'],offered_rate_paise=128000,quantity=rfq['quantity_requested'],gst_bps=1800,freight_charges_paise=65000,
               payment_terms='Payment arranged directly with supplier',delivery_timeline='Supplier proposes two business days',warranty_terms='Supplier declares one year replacement',
               validity_days=15,authorized_signatory='Supplier Signatory',signatory_designation='Owner',special_notes='Buyer should confirm applicable taxes')
    return {**value,**changes}


def create_quote(api,rfq,**changes):
    response=api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_body(rfq,**changes))
    assert response.status_code==200,response.text
    return response.json()['quotation']


def decide(api,rfq,quote,action='accept',uid='customer'):
    return api.post('/operations/b2b/rfq/'+rfq['id']+'/decision',headers=auth(uid),json={'quote_number':quote['quote_number'],'action':action})


def test_canonical_lifecycle_integer_totals_private_pdf_and_no_payment(api):
    setup(api);listing=create_listing(api);rfq=create_rfq(api,listing);quote=create_quote(api,rfq)
    assert (rfq['item_title'],rfq['shop_name'],rfq['listed_rate_paise'])==(listing['title'],'Actual test supplier',132000)
    assert rfq['listed_subtotal_paise']==35*132000
    assert quote['taxable_paise']==35*128000
    assert quote['gst_paise']==806400
    assert quote['grand_total_paise']==5351400
    assert quote['valid_until']==quote['created_at']+15*86400
    assert quote['distributor_gstin']==''
    assert quote['shop_phone']=='+919876543210'
    assert 'owner_id' not in quote and 'customer_id' not in quote
    response=decide(api,rfq,quote);assert response.status_code==200,response.text
    accepted=response.json()['rfq']
    assert accepted['status']=='accepted' and accepted['payment_status']=='not_collected'
    assert accepted['quotation']['status']=='accepted'
    assert main.operations_store.run(lambda u:u.get('b2b_listings',listing['id']))['stock']==300
    assert not main.operations_store.run(lambda u:u.all('retail_orders'))
    pdf=api.get('/operations/b2b/quotation/'+quote['quote_number']+'/pdf',headers=auth('customer'))
    assert pdf.status_code==200 and pdf.content.startswith(b'%PDF-')
    assert 'no-store' in pdf.headers['cache-control']
    assert api.get('/operations/b2b/quotation/'+quote['quote_number']+'/pdf',headers=auth('shop')).status_code==200
    policy=api.get('/operations/b2b/policy').json()
    assert not policy['payments_ready'] and not policy['escrow_available']
    assert 'does not collect' in policy['acceptance_note']


def test_no_anonymous_mutations_or_private_inquiry_pdf_reads(api):
    setup(api);listing=create_listing(api);rfq=create_rfq(api,listing);quote=create_quote(api,rfq)
    endpoints=[('post','/listings',listing_body()),('put','/listings/'+listing['id'],{}),('delete','/listings/'+listing['id'],{'expected_version':1}),
               ('post','/rfq',rfq_body(listing)),('post','/quotation',quote_body(rfq)),('post','/rfq/'+rfq['id']+'/decision',{'quote_number':quote['quote_number'],'action':'accept'})]
    for method,path,body in endpoints:
        response=api.request(method,'/operations/b2b'+path,json=body)
        assert response.status_code==401,(path,response.text)
    for path in ['/rfq','/rfq/'+rfq['id'],'/quotation/'+quote['quote_number']+'/pdf']:
        assert api.get('/operations/b2b'+path).status_code==401
    assert api.get('/operations/b2b/listings?shop_id=shop1').status_code==401
    assert api.get('/operations/b2b/listings').status_code==200


def test_inquiry_owner_scope_unknown_pdf_and_public_projection(api):
    setup(api);listing=create_listing(api);rfq=create_rfq(api,listing);quote=create_quote(api,rfq)
    public=api.get('/operations/b2b/listings').json()['listings'][0]
    assert public['verified_distributor'] and public['prime']['active'] is False
    assert not any(k in public for k in ['owner_id','phone','address','email','request_id'])
    assert api.get('/operations/b2b/rfq',headers=auth('stranger')).json()['rfqs']==[]
    assert api.get('/operations/b2b/rfq?shop_id=shop1',headers=auth('worker')).status_code==403
    assert api.get('/operations/b2b/rfq/'+rfq['id'],headers=auth('stranger')).status_code==404
    assert api.get('/operations/b2b/quotation/'+quote['quote_number']+'/pdf',headers=auth('stranger')).status_code==404
    assert api.get('/operations/b2b/quotation/unknown/pdf',headers=auth('customer')).status_code==404
    assert len(api.get('/operations/b2b/rfq?shop_id=shop1',headers=auth('shop')).json()['rfqs'])==1


def test_owner_mobile_approval_and_typed_fields_block_forgery(api):
    setup(api)
    for uid in ['customer','worker','stranger']:
        assert api.post('/operations/b2b/listings',headers=auth(uid),json=listing_body()).status_code==403
    for field,value in [('shop_name','Fake identity'),('owner_id','customer'),('status','approved'),('prime',{'active':True})]:
        assert api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_body(**{field:value})).status_code==422
    listing=create_listing(api)
    for field,value in [('shop_id','shop1'),('item_title','Forged item'),('status','accepted'),('payment_status','paid')]:
        assert api.post('/operations/b2b/rfq',headers=auth('customer'),json=rfq_body(listing,**{field:value})).status_code==422
    def suspend(u):
        shop=u.get('shops','shop1');shop['status']='suspended';u.put('shops','shop1',shop)
    main.operations_store.run(suspend)
    assert api.get('/operations/b2b/listings').json()['listings']==[]
    assert api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_body()).status_code==403


@pytest.mark.parametrize('change',[{'bulk_slabs':[{'min_qty':10,'max_qty':30,'price_paise':140000},{'min_qty':25,'max_qty':None,'price_paise':130000}]},
                                   {'bulk_slabs':[{'min_qty':5,'price_paise':140000}]},{'bulk_slabs':[{'min_qty':10,'max_qty':9,'price_paise':140000}]},
                                   {'bulk_slabs':[{'min_qty':10,'price_paise':150000}]},{'mrp_paise':140000},{'stock':True},{'base_price_paise':1.5}])
def test_invalid_slab_and_money_fields_rejected(api,change):
    setup(api)
    assert api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_body(**change)).status_code==422


def test_quantity_moq_stock_self_inquiry_and_quote_owner(api):
    setup(api);listing=create_listing(api)
    assert api.post('/operations/b2b/rfq',headers=auth('shop'),json=rfq_body(listing)).status_code==409
    for quantity,status in [(1,422),(301,409),(True,422)]:
        assert api.post('/operations/b2b/rfq',headers=auth('customer'),json=rfq_body(listing,quantity_requested=quantity)).status_code==status
    rfq=create_rfq(api,listing)
    assert api.post('/operations/b2b/quotation',headers=auth('worker'),json=quote_body(rfq)).status_code==404
    assert api.post('/operations/b2b/quotation',headers=auth('customer'),json=quote_body(rfq)).status_code==403
    assert api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_body(rfq,quantity=34)).status_code==422
    for changes in [{'gst_bps':-1},{'gst_bps':10001},{'gst_bps':1800.5},{'gst_bps':True},{'freight_charges_paise':-1},{'gst_rate':.18},{'grand_total_paise':1},{'payment_status':'paid'}]:
        assert api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_body(rfq,**changes)).status_code==422


def test_rounding_half_paise_is_deterministic_and_freight_not_hidden_tax(api):
    setup(api);listing=create_listing(api,moq=1,base_price_paise=1,mrp_paise=1,bulk_slabs=[],stock=4)
    rfq=create_rfq(api,listing,quantity_requested=1)
    quote=create_quote(api,rfq,offered_rate_paise=1,gst_bps=5000,freight_charges_paise=1)
    assert (quote['taxable_paise'],quote['gst_paise'],quote['grand_total_paise'])==(1,1,3)


def test_idempotent_listing_inquiry_quote_and_reused_request_payload(api):
    setup(api)
    listing_input=listing_body()
    first=api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_input).json()['listing']
    again=api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_input).json()['listing'];assert first==again
    assert api.post('/operations/b2b/listings',headers=auth('shop'),json={**listing_input,'title':'Different product'}).status_code==409
    rfq_input=rfq_body(first)
    rfq=api.post('/operations/b2b/rfq',headers=auth('customer'),json=rfq_input).json()['rfq']
    assert api.post('/operations/b2b/rfq',headers=auth('customer'),json=rfq_input).json()['rfq']['id']==rfq['id']
    assert api.post('/operations/b2b/rfq',headers=auth('customer'),json={**rfq_input,'quantity_requested':36}).status_code==409
    quote_input=quote_body(rfq)
    quote=api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_input).json()['quotation']
    assert api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_input).json()['quotation']['quote_number']==quote['quote_number']
    assert api.post('/operations/b2b/quotation',headers=auth('shop'),json={**quote_input,'offered_rate_paise':1}).status_code==409
    assert decide(api,rfq,quote).status_code==200
    first_decision=main.operations_store.run(lambda u:u.get('b2b_rfqs',rfq['id']))
    assert decide(api,rfq,quote).status_code==200
    assert main.operations_store.run(lambda u:u.get('b2b_rfqs',rfq['id']))==first_decision
    assert decide(api,rfq,quote,action='decline').status_code==409
    assert api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_body(rfq)).status_code==409
    assert api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_input).json()['quotation']['quote_number']==quote['quote_number']


def test_quote_replacement_expiry_boundary_and_fresh_source_before_acceptance(api):
    setup(api);listing=create_listing(api);rfq=create_rfq(api,listing);quote=create_quote(api,rfq);new_quote=create_quote(api,rfq,offered_rate_paise=120000)
    assert decide(api,rfq,quote).status_code==409
    assert decide(api,rfq,new_quote,uid='shop').status_code==403
    with patch('b2b.time.time',return_value=new_quote['valid_until']):
        response=decide(api,rfq,new_quote);assert response.status_code==409 and response.json()['detail']['code']=='QUOTE_EXPIRED'
    with patch('b2b.time.time',return_value=new_quote['valid_until']-.001):
        assert decide(api,rfq,new_quote).status_code==200
    rfq2=create_rfq(api,listing);quote2=create_quote(api,rfq2)
    assert api.post('/operations/b2b/listings/'+listing['id']+'/status',headers=auth('shop'),json={'status':'paused','expected_version':1}).status_code==200
    assert decide(api,rfq2,quote2).status_code==409
    assert api.post('/operations/b2b/rfq',headers=auth('customer'),json=rfq_body(listing)).status_code==409
    # Historical inquiry and saved quotation remain visible to their two parties.
    assert api.get('/operations/b2b/rfq/'+rfq2['id'],headers=auth('customer')).status_code==200


def test_typed_listing_update_version_archive_and_snapshot_immutability(api):
    setup(api);listing=create_listing(api);rfq=create_rfq(api,listing)
    draft=listing_body(title='Changed current copper title',base_price_paise=130000,bulk_slabs=[])
    draft.pop('shop_id');draft.pop('request_id');draft['expected_version']=1
    path='/operations/b2b/listings/'+listing['id']
    assert api.put(path,headers=auth('worker'),json=draft).status_code==403
    result=api.put(path,headers=auth('shop'),json=draft);assert result.status_code==200,result.text
    assert result.json()['listing']['version']==2
    assert api.put(path,headers=auth('shop'),json=draft).status_code==409
    assert api.put(path,headers=auth('shop'),json={'status':'accepted'}).status_code==422
    assert api.get('/operations/b2b/rfq/'+rfq['id'],headers=auth('customer')).json()['rfq']['item_title']==listing['title']
    response=api.request('DELETE',path,headers=auth('shop'),json={'expected_version':2});assert response.status_code==200,response.text
    assert response.json()['listing']['status']=='archived'
    assert api.get(path).status_code==404
    assert api.post(path+'/status',headers=auth('shop'),json={'status':'active','expected_version':3}).status_code==409
    assert len(api.get('/operations/b2b/listings?shop_id=shop1',headers=auth('shop')).json()['listings'])==1


def test_pagination_search_filter_binding_legacy_exclusion_and_no_all_scan(api,monkeypatch):
    setup(api);listing=create_listing(api)
    def seed(u):
        native=u.get('b2b_listings',listing['id'])
        for number in range(175):
            row={**native,'id':f'item-{number:03d}','title':f'Native fixture product {number:03d}'}
            if number==174:row['title']='Rare matching product'
            u.put('b2b_listings',row['id'],row)
        u.put('b2b_listings','legacy',{'id':'legacy','shop_id':'shop1','title':'Forged legacy product','status':'active'})
    main.operations_store.run(seed)
    monkeypatch.setattr(Unit,'all',lambda *args: (_ for _ in ()).throw(AssertionError('unbounded collection read')))
    cursor='';found=[]
    for _ in range(5):
        response=api.get('/operations/b2b/listings',params={'search':'Rare matching','cursor':cursor,'limit':2})
        assert response.status_code==200,response.text
        data=response.json();found+=data['listings'];cursor=data['next_cursor']
        if not cursor:break
    assert [row['title'] for row in found]==['Rare matching product']
    first=api.get('/operations/b2b/listings?limit=2').json()
    assert len(first['listings'])==2 and first['next_cursor']
    assert api.get('/operations/b2b/listings',params={'cursor':first['next_cursor'],'category':'tools'}).status_code==422
    assert api.get('/operations/b2b/listings',params={'cursor':'bad'}).status_code==422
    assert api.get('/operations/b2b/listings?category=wrong').status_code==422
    assert api.get('/operations/b2b/listings/legacy').status_code==404


def test_private_inquiry_pagination_cursor_cannot_change_user_or_shop(api):
    setup(api);listing=create_listing(api)
    for _ in range(3):create_rfq(api,listing)
    first=api.get('/operations/b2b/rfq?limit=2',headers=auth('customer')).json()
    assert len(first['rfqs'])==2 and first['next_cursor']
    second=api.get('/operations/b2b/rfq',headers=auth('customer'),params={'cursor':first['next_cursor'],'limit':2}).json()
    assert len(second['rfqs'])==1 and not second['next_cursor']
    assert api.get('/operations/b2b/rfq',headers=auth('stranger'),params={'cursor':first['next_cursor']}).status_code==422
    assert api.get('/operations/b2b/rfq?shop_id=shop1',headers=auth('shop'),params={'cursor':first['next_cursor']}).status_code==422


def test_pdf_escapes_declared_markup_uses_saved_totals_and_no_invented_claims(api,monkeypatch):
    setup(api);listing=create_listing(api,title='Copper <b>coil</b> & fittings');rfq=create_rfq(api,listing,customer_name='Buyer <i>name</i>')
    quote=create_quote(api,rfq,payment_terms='Do not parse <img src="https://example.test/private"/>',authorized_signatory='Owner <b>name</b>')
    from reportlab import platypus
    original=platypus.Paragraph;captured=[]
    def capture(text,*args,**kwargs):
        captured.append(text)
        return original(text,*args,**kwargs)
    monkeypatch.setattr(platypus,'Paragraph',capture)
    result=api.get('/operations/b2b/quotation/'+quote['quote_number']+'/pdf',headers=auth('customer'))
    assert result.status_code==200,result.text
    text=' '.join(captured)
    assert 'Copper &lt;b&gt;coil&lt;/b&gt; &amp; fittings' in text
    assert '&lt;img src=' in text and '<img src=' not in text
    assert '21ABCDE1234F1Z5' not in text and '94370 00000' not in text
    assert 'REPAIDO VERIFICATION SEAL' not in text and 'funds deposited' not in text
    assert 'INR 53,514.00' in text and 'does not collect B2B payments' in text


def test_real_photo_ownership_publication_pause_and_invalid_input(api,monkeypatch):
    setup(api);objects={}
    monkeypatch.setattr(b2b,'upload_object',lambda key,data:objects.setdefault(key,data))
    monkeypatch.setattr(b2b,'download_object',lambda key:objects[key])
    image=io.BytesIO();Image.new('RGB',(24,24),'blue').save(image,format='PNG');data=image.getvalue()
    url='/operations/b2b/photos?shop_id=shop1'
    assert api.post(url,headers={'Content-Type':'image/png'},content=data).status_code==401
    assert api.post(url,headers={**auth('worker'),'Content-Type':'image/png'},content=data).status_code==403
    assert api.post(url,headers={**auth('shop'),'Content-Type':'image/png'},content=b'not an image').status_code==422
    upload=api.post(url,headers={**auth('shop'),'Content-Type':'image/png'},content=data)
    assert upload.status_code==200,upload.text
    image_url=upload.json()['image_url'];public_url=image_url.removeprefix('/api')
    assert api.get(public_url).status_code==404
    assert api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_body(image='https://external.test/photo.jpg')).status_code==422
    def foreign(u):
        u.put('b2b_media','other',dict(id='other',shop_id='another-shop',owner_id='worker',object_key='private',listing_ids=[]))
    main.operations_store.run(foreign)
    assert api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_body(image=b2b.PHOTO_PREFIX+'other')).status_code==422
    listing=create_listing(api,image=image_url)
    published=api.get(public_url);assert published.status_code==200 and published.headers['content-type']=='image/jpeg'
    assert published.content.startswith(b'\xff\xd8')
    api.post('/operations/b2b/listings/'+listing['id']+'/status',headers=auth('shop'),json={'status':'paused','expected_version':1})
    assert api.get(public_url).status_code==404


def test_photo_storage_failure_cannot_fake_success(api,monkeypatch):
    setup(api)
    def unavailable(*args):raise RuntimeError('storage disabled')
    monkeypatch.setattr(b2b,'upload_object',unavailable)
    image=io.BytesIO();Image.new('RGB',(24,24)).save(image,format='JPEG')
    result=api.post('/operations/b2b/photos?shop_id=shop1',headers={**auth('shop'),'Content-Type':'image/jpeg'},content=image.getvalue())
    assert result.status_code==503
    assert main.operations_store.run(lambda u:u.all('b2b_media'))==[]


def test_current_shop_owner_change_revokes_supplier_access_not_buyers_saved_records(api):
    setup(api);listing=create_listing(api);rfq=create_rfq(api,listing);quote=create_quote(api,rfq)
    def transfer(u):
        shop=u.get('shops','shop1');shop['owner_id']='worker';u.put('shops','shop1',shop)
    main.operations_store.run(transfer)
    assert api.get('/operations/b2b/listings').json()['listings']==[]
    assert api.get('/operations/b2b/rfq/'+rfq['id'],headers=auth('shop')).status_code==403
    assert api.get('/operations/b2b/rfq?shop_id=shop1',headers=auth('worker')).json()['rfqs']==[]
    assert api.get('/operations/b2b/quotation/'+quote['quote_number']+'/pdf',headers=auth('worker')).status_code==404
    assert api.get('/operations/b2b/quotation/'+quote['quote_number']+'/pdf',headers=auth('customer')).status_code==200
    assert decide(api,rfq,quote).status_code==409


def test_whitespace_fields_and_changed_stock_reject_unfulfillable_quote(api):
    setup(api)
    assert api.post('/operations/b2b/listings',headers=auth('shop'),json=listing_body(title='   ')).status_code==422
    listing=create_listing(api);rfq=create_rfq(api,listing)
    def decrease(u):
        row=u.get('b2b_listings',listing['id']);row['stock']=34;u.put('b2b_listings',row['id'],row)
    main.operations_store.run(decrease)
    response=api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_body(rfq))
    assert response.status_code==409 and response.json()['detail']['code']=='STOCK_UNAVAILABLE'


def test_requested_item_and_unit_cannot_be_replaced_under_a_saved_inquiry(api):
    setup(api);listing=create_listing(api);rfq=create_rfq(api,listing);quote=create_quote(api,rfq)
    def replace(u):
        row=u.get('b2b_listings',listing['id']);row.update(part_number='NEW-PART',unit='Pieces');u.put('b2b_listings',row['id'],row)
    main.operations_store.run(replace)
    response=decide(api,rfq,quote)
    assert response.status_code==409 and response.json()['detail']['code']=='LISTING_CHANGED'
    assert api.post('/operations/b2b/quotation',headers=auth('shop'),json=quote_body(rfq)).status_code==409
    saved=api.get('/operations/b2b/rfq/'+rfq['id'],headers=auth('customer')).json()['rfq']
    assert saved['part_number']=='COIL-50' and saved['unit']=='Rolls'


def test_missing_mrp_remains_absent_and_search_uses_current_real_supplier_name(api):
    setup(api);listing=create_listing(api,mrp_paise=None)
    assert listing['mrp_paise'] is None
    result=api.get('/operations/b2b/listings?search=Actual%20test%20supplier').json()['listings']
    assert [row['id'] for row in result]==[listing['id']]
    assert result[0]['mrp_paise'] is None
    assert api.get('/operations/b2b/listings?search=Imaginary%20supplier').json()['listings']==[]
