"""Public commerce profiles and consented, bounded, evidence-based discovery.

All commerce authority stays in the native API. Event-driven aggregate projections
contain no customers or revenue. Missing history is explicitly partial/unknown.
"""
import base64
import hashlib
import json
import math
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import Field
from operations import Input, Pin, fail, metres
from commerce_ranking import VERSION, PRIOR_MEAN, PRIOR_WEIGHT
from commerce_ranking_client import rank_candidates

IST = timezone(timedelta(hours=5,minutes=30),name='Asia/Kolkata')
MAX_CATALOGUE = 100
MAX_COHORT = 24
EVENT_TTL = 30 * 86400


def digest(*parts):
    return hashlib.sha256(':'.join(map(str,parts)).encode()).hexdigest()


def norm(value):
    return re.sub(r'[^\w -]', ' ', str(value or '').casefold())[:100].strip()


def categories(shop):
    value = shop.get('categories', [])
    return list(dict.fromkeys(norm(x) for x in (value if isinstance(value,list) else re.split('[,;|]',value)) if norm(x)))[:20]


def received(order):
    return bool(order and order.get('state') == 'paid' and order.get('payment_id') and order.get('received_at')
                and not order.get('amount_refunded') and not order.get('refunded_at') and not order.get('refund_pending'))


def empty_stats(key):
    return {'id':key,'received_orders':0,'units_sold':0,'refunded_orders':0,'cancelled_orders':0,
            'review_count':0,'rating_sum':0,'observed_since':time.time()}


def change_stats(u,kind,key,delta):
    stats = u.get(kind,key) or empty_stats(key)
    for field,amount in delta.items():stats[field] = max(0,stats.get(field,0)+amount)
    stats['updated_at']=time.time();u.put(kind,key,stats)


def products_for_shop(order,shop_id):
    return {i.get('product_id') for i in order.get('items',[])[:100] if i.get('shop_id')==shop_id}


def _contribution(order,shop_id):
    own=[i for i in order.get('items',[])[:100] if i.get('shop_id')==shop_id]
    good=received(order)
    return {'received_orders':int(good),'units_sold':sum(max(0,int(i.get('quantity',0))) for i in own) if good else 0,
            'refunded_orders':int(order.get('state')=='refunded' or bool(order.get('amount_refunded') or order.get('refunded_at'))),
            'cancelled_orders':int(order.get('state') in ('cancelled','canceled'))}


def consent_epoch(preferences):
    return preferences.get('market_consent_epoch',preferences.get('updated_at'))


def _project_record(u,kind,key,value):
    """Idempotent bounded projection engine; never reads a whole collection.

    One order is capped at 100 lines by native checkout. Pair evidence is capped
    at eight distinct products so very large baskets cannot create write storms.
    """
    if kind == 'discovery_preferences':
        enabled=value.get('enabled') and value.get('consent_version')==3
        epoch=consent_epoch(value);now=time.time()
        interest=u.get('commerce_interest',key)
        ledger=u.get('commerce_event_dedup',key)
        # Erase retained signals/fingerprints immediately on opt-out/reset.
        if interest and (not enabled or interest.get('consent_updated_at')!=epoch or interest.get('expires_at',0)<=now):
            u.put('commerce_interest',key,{'id':key,'categories':{},'consent_updated_at':epoch,'expires_at':now})
        if ledger and (not enabled or ledger.get('consent_updated_at')!=epoch or ledger.get('expires_at',0)<=now):
            u.put('commerce_event_dedup',key,{'id':key,'events':{},'consent_updated_at':epoch,'expires_at':now})
        return
    if kind == 'inventory':
        sid=value.get('shop_id')
        if sid:
            state=u.get('commerce_shop_catalogue',sid) or {'id':sid,'products':{}}
            products=state.get('products',{})
            products[key]={k:value.get(k) for k in ('id','name','category','status','stock','stock_confirmed_at')}
            state['products']=dict(sorted(products.items(),key=lambda pair:(-(pair[1].get('stock_confirmed_at') or 0),pair[0]))[:MAX_CATALOGUE])
            state['updated_at']=time.time();u.put('commerce_shop_catalogue',sid,state)
        return
    if kind != 'retail_orders':return
    previous = u.get('commerce_order_projection',key) or {'shops':{},'products':{},'pairs':[],'received':False}
    shop_ids=sorted({i.get('shop_id') for i in value.get('items',[])[:100] if i.get('shop_id')})
    current={sid:_contribution(value,sid) for sid in shop_ids}
    for sid in sorted(set(current)|set(previous.get('shops',{}))):
        before=previous.get('shops',{}).get(sid,{})
        after=current.get(sid,{})
        delta={f:after.get(f,0)-before.get(f,0) for f in ('received_orders','units_sold','refunded_orders','cancelled_orders')}
        if any(delta.values()):change_stats(u,'commerce_shop_stats',sid,delta)
        # A previously verified review ceases to influence rank after a refund.
        rid=digest('review',sid,key);review=u.get('shop_reviews',rid)
        eligible=bool(received(value) and sid in current and (not review or not review.get('product_id') or review['product_id'] in products_for_shop(value,sid)) and (not review or review.get('customer_id')==value.get('customer_id')))
        if review and review.get('active') != eligible:
            direction=1 if eligible else -1
            change_stats(u,'commerce_shop_stats',sid,{'review_count':direction,'rating_sum':direction*review['rating']})
            if review.get('product_id'):change_stats(u,'commerce_product_stats',review['product_id'],{'review_count':direction,'rating_sum':direction*review['rating']})
            review['active']=eligible;u.put('shop_reviews',rid,review)
    products={}
    if received(value):
        for item in value.get('items',[])[:100]:
            pid=item.get('product_id')
            if pid:products[pid]=products.get(pid,0)+max(0,int(item.get('quantity',0)))
    for pid in sorted(set(products)|set(previous.get('products',{}))):
        old=previous.get('products',{}).get(pid,0);new=products.get(pid,0)
        delta={'received_orders':int(new>0)-int(old>0),'units_sold':new-old}
        if any(delta.values()):change_stats(u,'commerce_product_stats',pid,delta)
    product_ids=sorted(products)[:8]
    pairs=[(a,b) for a in product_ids for b in product_ids if a!=b]
    before={tuple(pair) for pair in previous.get('pairs',[])};after=set(pairs)
    for a,b in sorted(before|after):
        difference=int((a,b) in after)-int((a,b) in before)
        if difference:
            pair_key=digest('pair',a,b);pair=u.get('commerce_product_pairs',pair_key) or {'id':pair_key,'product_id':a,'other_product_id':b,'orders':0,'observed_since':time.time()}
            pair['orders']=max(0,pair['orders']+difference);u.put('commerce_product_pairs',pair_key,pair)
    u.put('commerce_order_projection',key,{'id':key,'shops':current,'products':products,'pairs':pairs,'received':received(value),'updated_at':time.time()})


def _queue_projection(u,kind,key):
    """One small durable envelope per native transaction, not per basket line.

    References are rehydrated by the worker after commit. A new native write
    creates a new envelope even when an earlier delivery is already in flight.
    """
    current=getattr(u,'_commerce_projection_envelope',None)
    if current is None or sum(len(current.get(k,[])) for k in ('inventory','orders'))>=200:
        current={'id':str(time.time_ns()).zfill(20)+'_'+uuid.uuid4().hex[:12],'inventory':[],'orders':[],'inventory_offset':0,'order_offset':0,'active':True,'created_at':time.time()}
        u._commerce_projection_envelope=current
    lane='inventory' if kind=='inventory' else 'orders'
    if key not in current[lane]:current[lane].append(key)
    u.put('commerce_projection_queue',current['id'],current)


def index_record(u,kind,key,value):
    """Keep payment writes safely below the native transaction document cap."""
    if kind=='inventory':
        _queue_projection(u,kind,key)
    elif kind=='retail_orders':
        items=value.get('items',[])[:100]
        if len(items)>8 or len({i.get('shop_id') for i in items})>4 or len(u.pending)>150:
            _queue_projection(u,kind,key)
        else:_project_record(u,kind,key,value)
    else:_project_record(u,kind,key,value)


def process_updates(core,limit=5):
    """Existing private worker/Scheduler drain; no new scheduled service needed.

    Each transaction projects at most twenty inventory documents or one bounded
    native order. The durable envelope advances only with committed projections.
    """
    processed=0;remaining=0
    def step(u):
        rows=u.find('commerce_projection_queue','active',True,limit=1)
        if not rows:return None
        entry=rows[0];inventory=entry.get('inventory',[]);offset=entry.get('inventory_offset',0)
        if offset<len(inventory):
            ids=inventory[offset:offset+20];u.prefetch([('inventory',key) for key in ids])
            for key in ids:
                product=u.get('inventory',key)
                if product:_project_record(u,'inventory',key,product)
            entry['inventory_offset']=offset+len(ids)
        else:
            orders=entry.get('orders',[]);position=entry.get('order_offset',0)
            if position<len(orders):
                key=orders[position];order=u.get('retail_orders',key)
                if order:_project_record(u,'retail_orders',key,order)
                entry['order_offset']=position+1
        entry['active']=entry.get('inventory_offset',0)<len(inventory) or entry.get('order_offset',0)<len(entry.get('orders',[]))
        if entry['active']:
            entry['updated_at']=time.time();u.put('commerce_projection_queue',entry['id'],entry)
        else:
            # Queue references have no audit value after their idempotent native
            # projection commits. Delete atomically rather than retaining an
            # unbounded inactive ledger or relying on a float-based TTL policy.
            u.pending.pop(('commerce_projection_queue',entry['id']),None)
            if u.tx is not None:u.tx.delete(u.core.fs_doc('ops_commerce_projection_queue',entry['id']))
            else:u.conn.execute('DELETE FROM operation_records WHERE kind=? AND id=?',('commerce_projection_queue',entry['id']))
        return entry['active']
    for _ in range(max(0,min(limit,10))):
        active=core.operations_store.run(step)
        if active is None:break
        processed+=1;remaining+=int(active)
    return {'processed':processed,'continued':remaining}


def public_rating(stats):
    count=stats.get('review_count',0);total=stats.get('rating_sum',0)
    return {'mean':round(total/count,2) if count else None,'count':count,
            'bayesian':round((total+PRIOR_MEAN*PRIOR_WEIGHT)/(count+PRIOR_WEIGHT),2) if count else None,
            'prior_mean':PRIOR_MEAN,'prior_weight':PRIOR_WEIGHT}


def visible(u,shop,now):
    from shop_access import visible as access_visible
    return bool(shop and shop.get('status')=='approved' and access_visible(u,shop,now))


def live_product(u,p,now):
    from procurement import live_product as native_live
    return bool(p and native_live(u,p,now) and p.get('stock',0)>0 and visible(u,u.get('shops',p['shop_id']),now))


def product_card(u,p,now,reason='Related item'):
    from shop_pricing import effective_product
    stats=u.get('commerce_product_stats',p['id']) or {}
    return {**effective_product(u,p,now),'rating':public_rating(stats),
            'received_units':stats.get('units_sold',0),'received_orders':stats.get('received_orders',0),
            'metrics_since':stats.get('observed_since'),'recommendation_reason':reason}


def public_activity(u,shop,now):
    month=datetime.fromtimestamp(now,IST).strftime('%Y-%m')
    daily=u.get('shop_presence_month',digest(shop.get('owner_id',''),month)) or {}
    presence=u.get('shop_public_presence',shop['id']) or {}
    valid_owner=presence.get('owner_id')==shop.get('owner_id')
    sessions=[v for v in presence.get('sessions',{}).values() if valid_owner and v.get('expires_at',0)>now]
    online=[v for v in sessions if v.get('online')]
    status='online' if online else ('offline' if sessions else 'unknown')
    days=daily.get('active_days')
    return {'status':status,'recently_active':bool(online),
            'last_active_at':max((v.get('updated_at',0) for v in online),default=None),
            'active_days_this_month':len({d for d in days if type(d) is int and 1<=d<=31}) if isinstance(days,list) else None,
            'month':month,'timezone':'Asia/Kolkata','expires_at':max((v.get('expires_at',0) for v in sessions),default=None)}


def match(query,text):
    words=set(norm(query).split());hay=set(norm(text).split())
    return len(words&hay)/len(words) if words else 0


def shop_evidence(u,shop,category='',query='',stock_rows=None):
    stats=u.get('commerce_shop_stats',shop['id']) or {}
    rows=stock_rows if stock_rows is not None else list((u.get('commerce_shop_catalogue',shop['id']) or {}).get('products',{}).values())
    if not rows:rows=u.find('inventory','shop_id',shop['id'],limit=12)
    now=time.time();relevant=[p for p in rows[:MAX_CATALOGUE] if not category or norm(p.get('category'))==norm(category)]
    fresh=sum(p.get('status')=='approved' and p.get('stock',0)>0 and 0<=now-p.get('stock_confirmed_at',0)<=86400 for p in relevant)
    context=max(match(query,shop.get('name','')+' '+' '.join(categories(shop))),max((match(query,p.get('name','')+' '+p.get('category','')) for p in relevant),default=0))
    if category and (norm(category) in categories(shop) or relevant):context=max(context,.7)
    # Presence and paid subscriptions never buy rank or rating points.
    return {'received_orders':stats.get('received_orders',0),'refunded_orders':stats.get('refunded_orders',0),
            'cancelled_orders':stats.get('cancelled_orders',0),'review_count':stats.get('review_count',0),'rating_sum':stats.get('rating_sum',0),
            'stock_freshness':fresh/len(relevant) if relevant else 0.0,'context_match':float(context),
            'response_count':0,'response_seconds_sum':0.0},stats


def shop_card(u,shop,now,category='',query='',score=None,reason='Related shop'):
    from shop_access import verified
    from shop_prime import public_prime
    evidence,stats=shop_evidence(u,shop,category,query)
    quality=score or rank_candidates([evidence])['scores'][0]
    prime=public_prime(u,shop,now)
    result={'id':shop['id'],'name':shop.get('name','Shop'),'city':shop.get('city',''),'categories':categories(shop),
            'verified':verified(shop),'activity':public_activity(u,shop,now),'rating':public_rating(stats),
            'quality':{'version':VERSION,**quality},'prime':{**prime,'label':'Paid placement' if prime['active'] else None},'rank':None,'reason':reason,
            'metrics_since':stats.get('observed_since'),'history_coverage':'observed_events_only'}
    if verified(shop) and shop.get('address'):result['address']=shop['address']
    return result


def prefetch_shops(u,shops,now):
    month=datetime.fromtimestamp(now,IST).strftime('%Y-%m')
    pairs=[(kind,s['id']) for s in shops for kind in ('commerce_shop_stats','commerce_shop_catalogue','shop_prime','shop_access_members','shop_access_settings','shop_public_presence')]
    pairs += [('shop_presence_month',digest(s.get('owner_id',''),month)) for s in shops]
    u.prefetch(pairs)


def cohort(u,shop,category,query,now):
    city=shop.get('city','')
    # This is explicitly a bounded candidate cohort, never a global position.
    candidates=u.find('shops','city',city,limit=MAX_COHORT+1) if city else u.find('shops','status','approved',limit=MAX_COHORT+1)
    prefetch_shops(u,candidates,now)
    selected=[]
    for s in candidates[:MAX_COHORT]:
        if not visible(u,s,now):continue
        if category:
            products=list((u.get('commerce_shop_catalogue',s['id']) or {}).get('products',{}).values())
            if not products:products=u.find('inventory','shop_id',s['id'],limit=12)
            if norm(category) not in categories(s) and not any(norm(p.get('category'))==norm(category) for p in products):continue
        selected.append(s)
    if shop['id'] not in {s['id'] for s in selected}:selected=selected[:MAX_COHORT-1]+[shop]
    evidence=[shop_evidence(u,s,category,query)[0] for s in selected]
    scores=rank_candidates(evidence)['scores']
    ranked=sorted(zip(selected,scores),key=lambda pair:(-pair[1]['score'],pair[0]['id']))
    rank=next(i+1 for i,(s,_) in enumerate(ranked) if s['id']==shop['id'])
    return {'position':rank,'cohort_size':len(ranked),'category':category or 'all','city':city or None,
            'sampled':True,'candidate_limit':MAX_COHORT,'label':'Rank among matching shops in this sample'},ranked


class Recommendation(Input):
    query:str=Field(default='',max_length=150)
    category:str=Field(default='',max_length=80)
    city:str=Field(default='',max_length=80)
    product_id:str|None=Field(default=None,min_length=1,max_length=100)
    cart_product_ids:list[str]=Field(default_factory=list,max_length=20)
    location:Pin|None=None

class DiscoveryEvent(Input):
    request_id:str=Field(min_length=16,max_length=100)
    event:Literal['view_product','view_shop','search','add_to_cart']
    product_id:str|None=Field(default=None,min_length=1,max_length=100)
    shop_id:str|None=Field(default=None,min_length=1,max_length=100)
    category:str=Field(default='',max_length=80)
    query:str=Field(default='',max_length=150)

class Review(Input):
    order_id:str=Field(min_length=1,max_length=100)
    product_id:str|None=Field(default=None,min_length=1,max_length=100)
    rating:int=Field(ge=1,le=5,strict=True)
    text:str=Field(default='',max_length=1000)
    request_id:str=Field(min_length=16,max_length=100)

class Presence(Input):
    online:bool=Field(strict=True)
    session_id:str=Field(pattern=r'^[A-Za-z0-9_-]{16,100}$')
    sequence:int=Field(ge=1,le=100000000,strict=True)

class Reindex(Input):
    cursor:str=Field(default='',max_length=150)
    limit:int=Field(default=1,ge=1,le=1)


def _public_review(row):
    return {k:row.get(k) for k in ('id','shop_id','product_id','rating','text','created_at')}|{'verified_purchase':True}


def category_products(u,category,limit=MAX_CATALOGUE+1):
    # Native merchant categories historically preserve case. Never silently
    # return nothing because a normalised interest differs from its spelling.
    exact=u.find('inventory','category',category,limit=limit) if category else []
    if len(exact)>=limit:return exact
    rows=u.find('inventory','status','approved',limit=limit)
    combined={p['id']:p for p in exact}
    combined.update({p['id']:p for p in rows if not category or norm(p.get('category'))==norm(category)})
    return [combined[key] for key in sorted(combined)][:limit]


def recommendations(u,body,user=None):
    now=time.time();category=norm(body.category);query=norm(body.query)
    seed=u.get('inventory',body.product_id) if body.product_id else None
    if seed and not live_product(u,seed,now):seed=None
    if not category and seed:category=norm(seed.get('category'))
    preferences=u.get('discovery_preferences',user['id']) if user else None
    personal=bool(preferences and preferences.get('enabled') and preferences.get('consent_version')==3)
    signals={}
    if personal:
        state=u.get('commerce_interest',user['id']) or {}
        if state.get('consent_updated_at')==consent_epoch(preferences):
            signals={k:v for k,v in state.get('categories',{}).items() if now-v.get('at',0)<EVENT_TTL}
        if not category and signals:category=max(signals,key=lambda c:signals[c].get('score',0))
    candidates=category_products(u,category)
    shop_ids=sorted({p['shop_id'] for p in candidates if p.get('shop_id')})
    u.prefetch([('shops',sid) for sid in shop_ids]+[('commerce_product_stats',p['id']) for p in candidates])
    prefetch_shops(u,[s for sid in shop_ids if (s:=u.get('shops',sid))],now)
    accepted=[]
    for p in candidates[:MAX_CATALOGUE]:
        shop=u.get('shops',p['shop_id'])
        if not live_product(u,p,now) or (body.city and norm(shop.get('city'))!=norm(body.city)):continue
        relevance=match(query,p.get('name','')+' '+p.get('category','')+' '+p.get('compatibility',''))
        if query and not relevance:continue
        distance=metres(body.location.model_dump(),shop['location']) if body.location and shop.get('location') else None
        stats=u.get('commerce_product_stats',p['id']) or {}
        interest=signals.get(norm(p.get('category')),{}).get('score',0) if personal else 0
        accepted.append((p,relevance,min(interest,10),distance,stats.get('units_sold',0)))
    accepted.sort(key=lambda t:(-t[1],-t[2],t[3] if t[3] is not None else math.inf,-t[4],t[0]['id']))
    selected=[p for p,*_ in accepted if p['id'] not in set(body.cart_product_ids) and p['id']!=body.product_id][:12]
    shopids=list(dict.fromkeys(p['shop_id'] for p,*_ in accepted))[:12]
    shops=[u.get('shops',sid) for sid in shopids]
    if shops:
        scores=rank_candidates([shop_evidence(u,s,category,query)[0] for s in shops])['scores']
        ranked=sorted(zip(shops,scores),key=lambda t:(-t[1]['score'],t[0]['id']))
        shopcards=[shop_card(u,s,now,category,query,score,'Matches this category and search') for s,score in ranked[:6]]
    else:shopcards=[]
    bought=[];samples=0
    if seed:
        base_stats=u.get('commerce_product_stats',seed['id']) or {};samples=base_stats.get('received_orders',0)
        pairs=u.find('commerce_product_pairs','product_id',seed['id'],limit=MAX_CATALOGUE)
        for pair in sorted(pairs,key=lambda p:(-p.get('orders',0),p['id'])):
            if pair.get('orders',0)<3 or samples<5:continue
            p=u.get('inventory',pair['other_product_id'])
            if live_product(u,p,now) and p['id'] not in set(body.cart_product_ids):
                bought.append({**product_card(u,p,now,'Bought together in confirmed received orders'),'co_purchase_orders':pair['orders'],'confidence':round(pair['orders']/samples,4)})
            if len(bought)>=4:break
    reason='Based on your opted-in category activity' if personal else 'Matches this category and search'
    return {'version':VERSION,'products':[product_card(u,p,now,reason) for p in selected],'shops':shopcards,
            'bought_together':{'label':'Frequently bought together' if bought else 'Related items','confidence':max((p['confidence'] for p in bought),default=None),'sample_orders':samples,'items':bought or [product_card(u,p,now,'Related category item; insufficient co-purchase evidence') for p in selected[:4]]},
            'personalised':personal,'coverage':{'sampled':True,'candidate_limit':MAX_CATALOGUE,'history':'Observed confirmed received orders only'},'server_time':now}


def install(core):
    router=APIRouter(prefix='/operations',tags=['Shop discovery']);store=core.operations_store
    @router.get('/shops/{shop_id}/profile')
    def profile(shop_id:str,category:str=Query(default='',max_length=80),query:str=Query(default='',max_length=150),sort:Literal['relevance','bestselling','top_rated','price_low']='relevance',cursor:str=Query(default='',max_length=2000)):
        def read(u):
            now=time.time();shop=u.get('shops',shop_id)
            if not visible(u,shop,now):fail('NOT_FOUND','This shop profile is not publicly available.',404)
            scope=digest(shop_id,category,query,sort);offset=0;after=''
            if cursor:
                try:
                    decoded=json.loads(base64.urlsafe_b64decode(cursor+'='*(-len(cursor)%4)))
                    if decoded.get('scope')!=scope or type(decoded.get('offset')) is not int or not 0<=decoded['offset']<=MAX_CATALOGUE:raise ValueError()
                    after=decoded.get('after','')
                    if not isinstance(after,str) or not re.fullmatch(r'[A-Za-z0-9_-]{0,100}',after):raise ValueError()
                    offset=decoded['offset']
                except (ValueError,TypeError,KeyError,UnicodeDecodeError):fail('INVALID_CURSOR','This shop page cursor is invalid.',422)
            rows=u.find('inventory','shop_id',shop_id,limit=MAX_CATALOGUE+1,after=after or None)
            accepted=[p for p in rows[:MAX_CATALOGUE] if live_product(u,p,now) and (not category or norm(p.get('category'))==norm(category)) and (not query or match(query,p.get('name','')+' '+p.get('category','')+' '+p.get('compatibility','')))]
            u.prefetch([('commerce_product_stats',p['id']) for p in accepted])
            cards=[product_card(u,p,now) for p in accepted]
            if sort=='price_low':cards.sort(key=lambda p:(p['price_paise'],p['id']))
            elif sort=='bestselling':cards.sort(key=lambda p:(-p['received_units'],p['id']))
            elif sort=='top_rated':cards.sort(key=lambda p:(-(p['rating']['bayesian'] or 0),-p['rating']['count'],p['id']))
            else:cards.sort(key=lambda p:(-match(query,p.get('name','')),-p['received_units'],p['id']))
            next_position=({'scope':scope,'offset':offset+24,'after':after} if len(cards)>offset+24 else
                           {'scope':scope,'offset':0,'after':rows[MAX_CATALOGUE-1]['id']} if len(rows)>MAX_CATALOGUE else None)
            next_cursor=base64.urlsafe_b64encode(json.dumps(next_position).encode()).decode().rstrip('=') if next_position else None
            rank,ranked=cohort(u,shop,category,query,now)
            card=shop_card(u,shop,now,category,query,rank_candidates([shop_evidence(u,shop,category,query,rows)[0]])['scores'][0]);card['rank']=rank
            stats=u.get('commerce_shop_stats',shop_id) or {}
            rentals=[]
            if visible(u,shop,now):
                for p in u.find('rental_inventory','shop_id',shop_id,limit=25):
                    if not p.get('active'):continue
                    rentals.append({k:p.get(k) for k in ('id','shop_id','name','category','image_url','daily_paise','weekly_paise','monthly_paise','deposit_paise','rates','condition')}|{'available_units':max(0,p.get('total_units',0)-p.get('reserved',0)-p.get('quarantined',0))})
            reviews=u.find('shop_reviews','shop_id',shop_id,limit=25)
            return {'shop':card,'catalogue':cards[offset:offset+24],'rentals':rentals,'next_cursor':next_cursor,
                    'reviews':[_public_review(v) for v in reviews if v.get('active')],
                    'metrics':{'received_orders':stats.get('received_orders',0),'units_sold':stats.get('units_sold',0),'verified_reviews':stats.get('review_count',0),'refunded_orders':stats.get('refunded_orders',0),'cancelled_orders':stats.get('cancelled_orders',0),'stock_freshness':shop_evidence(u,shop,category,query,rows)[0]['stock_freshness'],'since':stats.get('observed_since'),'coverage':'Observed events only; historical backfill may be incomplete'},
                    'catalogue_coverage':{'sampled':bool(after) or len(rows)>MAX_CATALOGUE,'candidate_limit':MAX_CATALOGUE,'sort_scope':'Current catalogue window; use next page to explore further items'},
                    'related_shops':[shop_card(u,s,now,category,query,score) for s,score in ranked if s['id']!=shop_id][:6], 'server_time':now}
        return store.run(read)
    @router.post('/shop-discovery/recommendations')
    def recommend(body:Recommendation):return store.run(lambda u:recommendations(u,body))
    @router.post('/shop-discovery/personal')
    @router.post('/shop-discovery/recommendations/personal',include_in_schema=False)
    def personal(body:Recommendation,user=Depends(core.current_user)):return store.run(lambda u:recommendations(u,body,user))
    @router.post('/shop-discovery/events')
    def event(body:DiscoveryEvent,user=Depends(core.current_user)):
        def save(u):
            now=time.time();prefs=u.get('discovery_preferences',user['id']) or {}
            if not prefs.get('enabled') or prefs.get('consent_version')!=3:return {'recorded':False,'reason':'consent_required'}
            key=digest('commerce-event',user['id'],body.request_id)
            category=norm(body.category)
            if body.product_id:
                p=u.get('inventory',body.product_id)
                if not live_product(u,p,now):fail('NOT_FOUND','Product unavailable.',404)
                category=norm(p.get('category'))
            elif body.shop_id:
                s=u.get('shops',body.shop_id)
                if not visible(u,s,now):fail('NOT_FOUND','Shop unavailable.',404)
                if category and category not in categories(s):category=''
            # No raw searches, pins, IP, cart contents or sensitive profile traits.
            if not category:return {'recorded':False,'reason':'category_required'}
            if not body.product_id and not body.shop_id:
                known=category_products(u,category,MAX_CATALOGUE)
                if not any(live_product(u,p,now) for p in known):return {'recorded':False,'reason':'category_unavailable'}
            ledger=u.get('commerce_event_dedup',user['id']) or {'events':{}}
            events={k:v for k,v in ledger.get('events',{}).items() if now-v.get('at',0)<86400}
            fingerprint=digest(body.model_dump_json())
            if key in events:
                if events[key].get('fingerprint')!=fingerprint:fail('KEY_REUSED','This discovery retry differs from the original event.',409)
                return {'recorded':True,'replayed':True}
            if len(events)>=100:return {'recorded':False,'reason':'daily_event_limit'}
            state=u.get('commerce_interest',user['id']) or {}
            if state.get('consent_updated_at')!=consent_epoch(prefs):state={}
            signals={k:v for k,v in state.get('categories',{}).items() if now-v.get('at',0)<EVENT_TTL}
            current=signals.get(category,{})
            weight={'search':1,'view_product':1,'view_shop':1,'add_to_cart':3}[body.event]
            signals[category]={'score':min(20,current.get('score',0)+weight),'at':now}
            signals=dict(sorted(signals.items(),key=lambda pair:pair[1]['at'],reverse=True)[:20])
            u.put('commerce_interest',user['id'],{'id':user['id'],'categories':signals,'consent_updated_at':consent_epoch(prefs),'updated_at':now,'expires_at':now+EVENT_TTL})
            # Bounded one-document idempotency ledger. No raw query retained.
            events[key]={'at':now,'fingerprint':fingerprint}
            u.put('commerce_event_dedup',user['id'],{'id':user['id'],'events':events,'consent_updated_at':consent_epoch(prefs),'expires_at':now+EVENT_TTL})
            return {'recorded':True,'replayed':False}
        return store.run(save)
    @router.post('/shop-discovery/presence')
    def presence(body:Presence,user=Depends(core.current_user)):
        def save(u):
            now=time.time();shops=u.find('shops','owner_id',user['id'],limit=2)
            shop=next((s for s in shops if s.get('status')=='approved'),None)
            if not shop or not user.get('phone_authenticated'):fail('SHOP_REQUIRED','An approved phone-authenticated shop owner is required.',403)
            state=u.get('shop_public_presence',shop['id']) or {}
            sessions=dict(state.get('sessions',{})) if state.get('owner_id')==user['id'] else {}
            old=sessions.get(body.session_id)
            if old and old.get('sequence',0)>=body.sequence:
                return {'status':public_activity(u,shop,now)['status'],'expires_at':old['expires_at'],'ignored':True}
            if body.session_id not in sessions:
                if sum(v.get('online') and v.get('expires_at',0)>now for v in sessions.values())>=8:fail('PRESENCE_LIMIT','Close another shop session before opening a new one.',429)
                if len(sessions)>=16:
                    expired=sorted((k for k,v in sessions.items() if not v.get('online') or v.get('expires_at',0)<=now),key=lambda k:sessions[k].get('updated_at',0))
                    if not expired:fail('PRESENCE_LIMIT','Close another shop session before opening a new one.',429)
                    sessions.pop(expired[0])
            sessions[body.session_id]={'online':body.online,'sequence':body.sequence,'updated_at':now,'expires_at':now+90}
            u.put('shop_public_presence',shop['id'],{'id':shop['id'],'owner_id':user['id'],'sessions':sessions})
            if body.online:
                local=datetime.fromtimestamp(now,IST);month=local.strftime('%Y-%m');mid=digest(user['id'],month)
                daily=u.get('shop_presence_month',mid) or {'id':mid,'owner_id':user['id'],'month':month,'active_days':[]}
                if local.day not in daily['active_days']:
                    daily['active_days']=sorted(set(daily['active_days'])|{local.day});daily['last_active_at']=now;u.put('shop_presence_month',mid,daily)
            return {'status':public_activity(u,shop,now)['status'],'expires_at':now+90,'ignored':False}
        return store.run(save)
    @router.get('/shops/{shop_id}/reviewable-orders')
    def reviewable(shop_id:str,user=Depends(core.current_user)):
        def read(u):
            rows=u.find('retail_orders','customer_id',user['id'],limit=100)
            orders=[]
            for row in rows:
                if not received(row):continue
                own=[i for i in row.get('items',[]) if i.get('shop_id')==shop_id]
                if not own or u.get('shop_reviews',digest('review',shop_id,row['id'])):continue
                orders.append({'id':row['id'],'received_at':row['received_at'],'items':[{'product_id':i['product_id'],'name':i.get('name','Purchased item')} for i in own]})
            return {'orders':orders,'sampled':len(rows)==100,'candidate_limit':100}
        return store.run(read)
    @router.post('/shops/{shop_id}/reviews',status_code=201)
    def review(shop_id:str,body:Review,user=Depends(core.current_user)):
        def save(u):
            shop=u.get('shops',shop_id);order=u.get('retail_orders',body.order_id)
            if not shop or not order or order.get('customer_id')!=user['id'] or not any(i.get('shop_id')==shop_id for i in order.get('items',[])):fail('NOT_FOUND','Verified received purchase not found.',404)
            if shop.get('owner_id')==user['id']:fail('SELF_REVIEW','Shop owners cannot review their own shop.',403)
            if not received(order):fail('PURCHASE_NOT_RECEIVED','A confirmed paid and received non-refunded order is required.',409)
            if body.product_id and not any(i.get('shop_id')==shop_id and i.get('product_id')==body.product_id for i in order.get('items',[])):fail('PRODUCT_NOT_PURCHASED','Choose an item in this shop purchase.',422)
            key=digest('review',shop_id,body.order_id);fp=digest(body.model_dump_json())
            old=u.get('shop_reviews',key)
            if old:
                if old.get('fingerprint')!=fp:fail('REVIEW_EXISTS','This purchase already has a verified shop review.',409)
                return {'review':_public_review(old),'rating':public_rating(u.get('commerce_shop_stats',shop_id) or {})}
            # Backfill this exact receipt before adding its review contribution.
            _project_record(u,'retail_orders',body.order_id,order)
            row={'id':key,'shop_id':shop_id,'order_id':body.order_id,'customer_id':user['id'],'product_id':body.product_id,'rating':body.rating,'text':body.text.strip(),'created_at':time.time(),'active':True,'fingerprint':fp}
            u.put('shop_reviews',key,row)
            change_stats(u,'commerce_shop_stats',shop_id,{'review_count':1,'rating_sum':body.rating})
            if body.product_id:change_stats(u,'commerce_product_stats',body.product_id,{'review_count':1,'rating_sum':body.rating})
            return {'review':_public_review(row),'rating':public_rating(u.get('commerce_shop_stats',shop_id))}
        return store.run(save)
    @router.post('/admin/shop-discovery/reindex')
    def reindex(body:Reindex,admin=Depends(core.operator)):
        def save(u):
            from repaidians_opportunities import native_scan
            rows=native_scan(u,'retail_orders',body.cursor,limit=body.limit+1)
            for key,row in rows[:body.limit]:_project_record(u,'retail_orders',key,row)
            return {'indexed':min(len(rows),body.limit),'next_cursor':rows[body.limit-1][0] if len(rows)>body.limit else None,'complete':len(rows)<=body.limit}
        return store.run(save)
    core.app.include_router(router)
