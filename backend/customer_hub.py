"""Account-owned activity summaries, saved homes/searches and shopping notes."""
import hashlib
import time
import uuid
from typing import Literal
from fastapi import APIRouter,Depends,Query
from pydantic import Field,model_validator
from operations import Input,fail
from housing import public as home_view

SOURCES=(('jobs','Visits'),('hires','Hiring'),('rentals','Equipment rentals'),('retail_orders','Purchases'),('home_plans','Home plans'),('support_cases','Support'),('scrap_collections','Scrap collections'),('cleanup_reports','Contributions'),('mobility_rides','Rides'),('home_enquiries','Home viewings'),('retail_resolution_cases','Purchase returns & support'),('community_contributions','Community missions'))
DESTINATIONS={'jobs':'visits','hires':'hiring','rentals':'rentals','retail_orders':'purchases','home_plans':'home_plans','support_cases':'support','scrap_collections':'scrap','cleanup_reports':'cleanup','mobility_rides':'rides','home_enquiries':'homes','retail_resolution_cases':'purchases','community_contributions':'missions'}

def next_action(kind,row):
    state=row.get('state') or row.get('status') or ''
    if kind=='retail_resolution_cases':return 'Review the purchase resolution'
    if kind=='community_contributions':return 'Review your mission contribution'
    if kind=='support_cases':return 'Review the support conversation'
    if kind=='home_enquiries':return 'Review viewing details and messages'
    if kind=='jobs' and state=='completion_pending':return 'Review the completed work'
    if kind=='jobs' and state=='in_progress' and (row.get('proposal') or {}).get('status') in ('pending','awaiting_payment'):return 'Review the parts proposal'
    if kind=='retail_orders' and state in ('paid','ready','dispatched'):return 'Track your order and receipt'
    if kind=='rentals' and state in ('active','picked_up'):return 'Review the return schedule'
    if state in ('cancelled','completed','closed','refunded'):return 'View the record and any receipt'
    return 'Open the record to review available actions'
class Save(Input):
    kind:Literal['home','home_search','shopping_note','shop','professional','product','second_hand','exchange']
    reference:str=Field(default='',max_length=100)
    label:str=Field(min_length=1,max_length=150)
    city:str=Field(default='',max_length=80)
    max_rent:int=Field(default=0,ge=0,le=100000000)
    bedrooms:int=Field(default=-1,ge=-1,le=20)
    @model_validator(mode='after')
    def valid(self):
        self.label=self.label.strip()
        self.city=self.city.strip()
        if not self.label:raise ValueError('Add a label for this saved item.')
        if self.kind not in ('home_search','shopping_note') and (not self.reference or '/' in self.reference):
            raise ValueError('Choose a valid item to save.')
        return self
def saved_target(u,kind,reference):
    if kind in ('second_hand','exchange'):
        from marketplace import active
        from market_access import access_status
        row=u.get('market_listings',reference)
        if not row or row.get('mode')!=kind or not active(row) or row.get('fee_status') in ('refunded','review_required','unpaid'):
            return None
        if row.get('fee_status')!='paid':
            # Canonical access also supports legacy trials. Bound its historical
            # owner lookup and fail closed for an oversized unmigrated account.
            class BoundedAccess:
                def get(self,*args):return u.get(*args)
                def find(self,collection,field,value):
                    rows=u.find(collection,field,value,limit=101)
                    if len(rows)>100:raise ValueError('Legacy marketplace history needs migration.')
                    return rows
            try:
                if not access_status(BoundedAccess(),row['owner_id'])['active']:return None
            except ValueError:return None
        return {'title':row['name'],'city':row.get('city',''),'price_paise':row['value_paise'],'mode':kind}
    if kind=='shop':
        from shop_access import visible
        row=u.get('shops',reference)
        return {'title':row.get('name','Shop'),'city':row.get('city','')} if row and visible(u,row,time.time()) else None
    if kind=='professional':
        row=u.get('workers',reference)
        return {'title':row.get('name','Professional'),'city':row.get('city',''),'categories':row.get('categories',[])} if row and row.get('status')=='approved' and not (u.get('network_suspensions',reference) or {}).get('active') else None
    if kind=='product':
        from shop_access import visible
        from shop_pricing import effective_product
        row=u.get('inventory',reference)
        shop=u.get('shops',row['shop_id']) if row else None
        if row and row.get('status','approved')=='approved' and shop and visible(u,shop,time.time()):
            p=effective_product(u,row)
            return {'title':row.get('name','Part'),'price_paise':p['price_paise'],'stock':row.get('stock',0),'compatibility':row.get('compatibility','')}
    return None


def install(core):
    r=APIRouter(prefix='/operations/customer-hub');store=core.operations_store
    @r.get('/activity')
    def activity(user=Depends(core.current_user)):
        def read(u):
            items=[]
            for kind,label in SOURCES:
                rows=u.find(kind,'user_id' if kind=='community_contributions' else 'customer_id',user['id'],limit=50)
                for x in rows:
                    items.append(dict(id=x['id'],target_id=x.get('order_id',x['id']) if kind=='retail_resolution_cases' else x['id'],kind=kind,label=label,title=x.get('service_name') or x.get('title') or x.get('listing_name') or (x.get('mission') or {}).get('title') or label,state=x.get('state') or x.get('status') or 'Open record',updated_at=x.get('updated_at') or x.get('created_at') or 0,reference=x['id'],payment_status=x.get('payment_status'),refund_status=x.get('refund_status'),destination=DESTINATIONS[kind],next_action=next_action(kind,x)))
            return {'items':sorted(items,key=lambda x:x['updated_at'],reverse=True),'scope':'A bounded sample of up to 50 records per activity type, ordered by update time within this sample. Open the original section for full history.'}
        return store.run(read)
    @r.get('/saved/status')
    def saved_status(kind:Literal['shop','professional','product','second_hand','exchange'],reference:str=Query(min_length=1,max_length=100,pattern=r'^[^/]+$'),user=Depends(core.current_user)):
        sid=hashlib.sha256((kind+':'+reference).encode()).hexdigest()
        return store.run(lambda u:{'id':sid if sid in (u.get('customer_saved',user['id']) or {}).get('entries',{}) else None})
    @r.get('/saved')
    def saved(user=Depends(core.current_user)):
        def read(u):
            row=u.get('customer_saved',user['id']) or {'entries':{}}
            sources={'home':'home_listings','shop':'shops','professional':'workers','product':'inventory','second_hand':'market_listings','exchange':'market_listings'}
            u.prefetch([(sources[x['kind']],x['reference']) for x in row['entries'].values() if x['kind'] in sources])
            search_pages={}
            result=[]
            for sid,x in row['entries'].items():
                entry={**x,'id':sid}
                if x['kind']=='home':
                    home=u.get('home_listings',x['reference'])
                    entry['available']=bool(home and home['status']=='published')
                    entry['home']=home_view(home) if entry['available'] else None
                    entry['price_drop_paise']=max(0,x.get('saved_price_paise',0)-home['rent_paise']) if entry['available'] else 0
                elif x['kind']=='home_search':
                    search_key=('city_key',x['city'].strip().casefold()) if x['city'].strip() else ('status','published')
                    if search_key not in search_pages:search_pages[search_key]=u.find('home_listings',*search_key,limit=100)
                    candidates=search_pages[search_key]
                    matches=[h for h in candidates if h['status']=='published' and (not x['max_rent'] or h['rent_paise']<=x['max_rent']) and (x['bedrooms']<0 or h['bedrooms']==x['bedrooms'])]
                    entry['matches']=[home_view(h) for h in matches[:10]]
                    entry['new_matches']=sum(h['updated_at']>x['created_at'] for h in matches)
                    entry['match_scope']='Up to 10 matches from the first 100 listings in this search. Open Homes for more results.'
                elif x['kind'] in ('shop','professional','product','second_hand','exchange'):
                    entry['target']=saved_target(u,x['kind'],x['reference'])
                    entry['available']=entry['target'] is not None
                    if x['kind'] in ('product','second_hand','exchange') and entry['target']:
                        entry['price_drop_paise']=max(0,x.get('saved_price_paise',0)-entry['target']['price_paise'])
                result.append(entry)
            return {'items':result}
        return store.run(read)
    @r.post('/saved')
    def save(body:Save,user=Depends(core.current_user)):
        def write(u):
            sid=hashlib.sha256((body.kind+':'+(body.reference if body.kind in ('home','shop','professional','product','second_hand','exchange') else body.model_dump_json())).encode()).hexdigest()
            row=u.get('customer_saved',user['id']) or {'entries':{}}
            if sid in row['entries']:return {'id':sid}
            if len(row['entries'])>=30:fail('LIMIT','Remove a saved entry before adding more (maximum 30).',409)
            if body.kind=='home_search' and sum(x['kind']=='home_search' for x in row['entries'].values())>=5:fail('LIMIT','You can keep five saved home searches.',409)
            value={**body.model_dump(),'created_at':time.time(),'save_generation':uuid.uuid4().hex}
            if body.kind=='home':
                home=u.get('home_listings',body.reference)
                if not home or home['status']!='published':fail('NOT_FOUND','Home is no longer available.',404)
                value['saved_price_paise']=home['rent_paise']
            if body.kind in ('shop','professional','product','second_hand','exchange'):
                target=saved_target(u,body.kind,body.reference)
                if not target:fail('NOT_FOUND','This profile or product is unavailable.',404)
                value['label']=target['title']
                if body.kind in ('product','second_hand','exchange'):value['saved_price_paise']=target['price_paise']
            row['entries'][sid]=value;u.put('customer_saved',user['id'],row)
            from saved_alerts import sync_saved
            sync_saved(u,user['id'],sid,value)
            return {'id':sid}
        return store.run(write)
    @r.delete('/saved/{sid}')
    def remove(sid:str,user=Depends(core.current_user)):
        def write(u):
            row=u.get('customer_saved',user['id']) or {'entries':{}}
            row['entries'].pop(sid,None);u.put('customer_saved',user['id'],row)
            from saved_alerts import sync_saved
            sync_saved(u,user['id'],sid,None)
            return {'removed':True}
        return store.run(write)
    @r.get('/compatibility')
    def compatibility(category:str='',model:str=''):
        if not 2<=len(category)<=80 or not 2<=len(model)<=100:fail('MODEL_REQUIRED','Enter a category and model or part number.',422)
        def read(u):
            import re
            tokens=set(re.findall(r'[a-z0-9]+',model.casefold()))
            rows=u.find('inventory','category',category,limit=100)
            result=[]
            for row in rows:
                declared=str(row.get('compatibility',''))
                words=set(re.findall(r'[a-z0-9]+',declared.casefold()))
                if not tokens or not tokens.issubset(words):continue
                target=saved_target(u,'product',row['id'])
                if target:result.append({'id':row['id'],**target,'match':'Supplier text matches your search; confirm the exact model with the shop.'})
            return {'items':result,'verified_compatibility':False,'scope':'Up to 100 catalogue entries in this category. Supplier declarations are not independently tested.'}
        return store.run(read)
    from saved_alerts import install as install_alerts
    install_alerts(core,r)
    core.app.include_router(r)
