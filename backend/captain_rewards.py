"""Verified community points, opt-in rankings and account-bound Repaido rewards.

No client scoring, cash conversion, demographic weighting or passive activity rewards.
"""
import math
import time
from fastapi import APIRouter, Depends, Response
from pydantic import Field
from operations import Input, fail, metres
from local_business import digest, document
from evidence import download_object

DAY = 86400
VERSION = 'captain-v1'
OFFERS = {
    'CAPTAINSHARE50': dict(title='Your first shared ride', scope='shared', bps=5000, cap_paise=None, first_only=True),
    'CAPTAINREPAIR30': dict(title='Repair visiting fee', scope='visit', bps=3000, cap_paise=None),
    'CAPTAINREFURB25': dict(title='Refurbished appliances', scope='refurbished', bps=2500, cap_paise=100000),
    'CAPTAINRENT10': dict(title='Tools & heavy-vehicle rentals', scope='rental', bps=1000, cap_paise=None),
    'CAPTAINCAB50': dict(title='Cab base fare', scope='cab', bps=5000, cap_paise=None),
}
TERMS = 'Repaido-funded. One use per offer per 30 days while Gold is active. No stacking. Eligible base only; taxes, parts, deposits, delivery and extras excluded. Reservation counts as use.'
# Exact catalogue categories, never a fuzzy match against seller marketing copy.
APPLIANCES = {'appliances', 'home appliances', 'refurbished appliances', 'refrigerator', 'refrigerators', 'washing machine', 'washing machines', 'air conditioner', 'air conditioners', 'television', 'televisions'}
FACTORS = [
    'Independent completion review', 'Collection permission recorded', 'Public-place declaration',
    'Safe material category', 'Before evidence present', 'After evidence present',
    'Different before and after photos', 'Evidence belongs to its uploader', 'Evidence claimed by this report',
    'Authorised collector or approved contributor', 'Disposal destination recorded', 'Review note recorded',
    'Location within 300 metres', 'Location accuracy within 100 metres', 'Fresh location at submission',
    'Verification follows submission', 'Award issued once per report', 'Maximum five scored cleanups per day',
    'Points earned in the last 30 days', 'Age of each verified award', '30-day decay period',
    '30% retained ranking floor', 'Verified days of contribution', 'Lifetime verified cleanups',
]

def totals(ledger, now=None):
    now = time.time() if now is None else now
    rows = [r for r in ledger if 0 <= r.get('created_at', now + 1) <= now and r.get('points', 0) >= 0]
    recent = [r for r in rows if now - r['created_at'] < 30 * DAY]
    rank = sum(r['points'] * (1 if now-r['created_at'] < 30*DAY else max(.3, 1-.7*(now-r['created_at']-30*DAY)/(30*DAY))) for r in rows)
    qualifying = sum(r['points'] for r in recent)
    expiry = None
    remaining = qualifying
    for row in sorted(recent, key=lambda r:r['created_at']):
        remaining -= row['points']
        if remaining < 100:
            expiry = row['created_at'] + 30*DAY
            break
    return dict(points=qualifying, qualifying_points=qualifying, lifetime_points=sum(r['points'] for r in rows), ranking_points=math.floor(rank+1e-8), verified_cleanups=len(rows), active_days=len({int((r['created_at']+19800)//DAY) for r in rows}), gold=qualifying>=100, gold_until=expiry if qualifying>=100 else None, captain_at=100, points_per_cleanup=10, badge='Swachh Bharat Captain · Gold' if qualifying>=100 else 'Cleanliness contributor', server_time=now)

def award(u, row, reviewer, now):
    """Fail closed for new awards; legacy verified awards keep their original value."""
    existing = u.get('cleanup_points', row['id'])
    if existing:return existing
    before=row.get('document_ids',[]);after=row.get('after_document_ids',[]);pos=row.get('completion_position',{})
    claimed=all((u.get('cleanup_evidence_claims',i) or {}).get('report_id')==row['id'] for i in before+after)
    owned=all((u.get('business_documents',i) or {}).get('owner_id')==uid for ids,uid in [(before,row['customer_id']),(after,row.get('owner_id'))] for i in ids)
    submitted=row.get('submitted_at',row.get('updated_at',now))
    checks=[reviewer not in (row['customer_id'],row.get('owner_id')),len(row.get('authority_reference','').strip())>=8,row.get('public_place') is True,row['category']!='hazardous',bool(before),bool(after),len(set(before+after))==len(before+after),owned,claimed,bool(row.get('owner_id')) and (row['owner_id']!=row['customer_id'] or row.get('allow_independent',False)),len(row.get('disposal_note','').strip())>=10,len(row.get('review_note','').strip())>=10,bool(pos) and metres(row['location'],pos)<=300,0<pos.get('accuracy',0)<=100,-10<=submitted-pos.get('captured_at',0)<=120,submitted<=now,True]
    if not all(checks):fail('POINTS_REVIEW_REQUIRED','The evidence or location checks are incomplete. Request fresh cleanup evidence before awarding points.',409)
    ledger=u.find('cleanup_points','user_id',row['customer_id'])
    day=int((now+19800)//DAY)
    daily=sum(int((r['created_at']+19800)//DAY)==day for r in ledger)
    checks.append(daily<5)
    points=10 if daily<5 else 0
    result=dict(id=row['id'],user_id=row['customer_id'],points=points,created_at=now,version=VERSION,checks=[dict(label=label,passed=bool(value)) for label,value in zip(FACTORS,checks)])
    u.put('cleanup_points',row['id'],result)
    # One per-account projection: no public access to the private reports or evidence.
    p=u.get('captain_profiles',row['customer_id']) or {'id':row['customer_id'],'public':False,'name':'','photo_id':None,'version':0}
    p.update(city=row['city'],city_key=row['city_key'],awards=[{'points':x['points'],'created_at':x['created_at']} for x in ledger+[result]])
    u.put('captain_profiles',row['customer_id'],p)
    return result

def offers(u, uid, summary, now):
    items=[]
    for code,rule in OFFERS.items():
        used=u.get('captain_redemptions',digest(uid+':'+code)) or {}
        next_at=used.get('reserved_at',0)+30*DAY if used else None
        reason='Terms being finalised' if rule['cap_paise'] is None else 'Earn 100 points in 30 days' if not summary['gold'] else 'Available again after 30 days' if next_at and now<next_at else ''
        items.append(dict(**rule,code=code,available=not reason,reason=reason,next_use_at=next_at if next_at and now<next_at else None,terms=TERMS,funded_by='repaido'))
    return items

def validate(u,uid,code,scope,now=None):
    now=time.time() if now is None else now
    summary=totals(u.find('cleanup_points','user_id',uid),now)
    offer=next((x for x in offers(u,uid,summary,now) if x['code']==code.strip().upper()),None)
    if not offer or not offer['available'] or offer['scope']!=scope:fail('REWARD_UNAVAILABLE','This reward is not available for this checkout. Check Gold status, offer limits and the eligible category.',409)
    return offer

def reserve(u,uid,code,scope,base,reference,now=None):
    now=time.time() if now is None else now;code=code.strip().upper();key=digest(uid+':'+code)
    old=u.get('captain_redemptions',key)
    if old and old.get('reference')==reference:return old['snapshot']
    offer=validate(u,uid,code,scope,now)
    if base<=0:fail('REWARD_BASE_REQUIRED','An eligible base charge is required.',422)
    snapshot=dict(code=code,bps=offer['bps'],cap_paise=offer['cap_paise'],eligible_base_paise=base,discount_paise=min(base*offer['bps']//10000,offer['cap_paise']),funded_by='repaido',terms=TERMS,version=VERSION)
    u.put('captain_redemptions',key,dict(user_id=uid,code=code,reference=reference,reserved_at=now,snapshot=snapshot))
    u.put('captain_reward_ledger',digest(uid+':'+reference),dict(user_id=uid,reference=reference,reserved_at=now,**snapshot))
    return snapshot

class Profile(Input):
    expected_version:int=Field(ge=0)
    name:str=Field(default='',max_length=60)
    photo_id:str|None=Field(default=None,max_length=100)
    public:bool=False

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations/local-business/captain',tags=['Community rewards'])
    @r.get('/me')
    def me(user=Depends(core.current_user)):
        def read(u):
            now=time.time();ledger=u.find('cleanup_points','user_id',user['id']);s=totals(ledger,now);p=u.get('captain_profiles',user['id']) or {}
            reports=u.find('cleanup_reports','customer_id',user['id'])
            return {**s,'profile':{k:p.get(k,d) for k,d in [('name',''),('photo_id',None),('public',False),('city',''),('version',0)]},'offers':offers(u,user['id'],s,now),'cash_received_paise':sum(x['reward_paise'] for x in reports if x['payment_state']=='received'),'cash_pending_paise':sum(x['reward_paise'] for x in reports if x['payment_state'] in ('approved','reported','disputed')),'factors':FACTORS,'awards':sorted(ledger,key=lambda x:x['created_at'],reverse=True)[:30]}
        return store.run(read)
    @r.post('/profile')
    def profile(body:Profile,user=Depends(core.current_user)):
        def save(u):
            p=u.get('captain_profiles',user['id']) or {'id':user['id'],'version':0}
            if p.get('version',0)!=body.expected_version:
                if p.get('version')==body.expected_version+1 and all(p.get(k)==v for k,v in dict(name=body.name.strip(),photo_id=body.photo_id,public=body.public).items()):return {'saved':True,'version':p['version']}
                fail('STALE_VERSION','Your profile changed. Close and reopen settings before saving.',409)
            if body.public and len(body.name.strip())<2:fail('NAME_REQUIRED','Add a display name to join the leaderboard.',422)
            if body.photo_id:
                document(u,body.photo_id,user['id'])
                if u.get('cleanup_evidence_claims',body.photo_id):fail('PRIVATE_EVIDENCE','Upload a separate profile photo. Report evidence stays private.',422)
            p.update(body.model_dump(exclude={'expected_version'}),name=body.name.strip(),version=p.get('version',0)+1)
            ledger=u.find('cleanup_points','user_id',user['id']);p['awards']=[{'points':x['points'],'created_at':x['created_at']} for x in ledger]
            # Legacy records get their verified city only, never a client-selected ranking city.
            completed=sorted((x for x in u.find('cleanup_reports','customer_id',user['id']) if x['state']=='completed'),key=lambda x:x.get('completed_at',0))
            if completed:p.update(city=completed[-1]['city'],city_key=completed[-1]['city_key'])
            u.put('captain_profiles',user['id'],p)
            return {'saved':True,'version':p['version']}
        return store.run(save)
    @r.get('/leaderboard')
    def leaderboard(user=Depends(core.current_user)):
        def read(u):
            p=u.get('captain_profiles',user['id']) or {};city=p.get('city_key');rows=[];now=time.time()
            if city:
                for item in u.find('captain_profiles','city_key',city):
                    if not item.get('public'):continue
                    s=totals(item.get('awards',[]),now)
                    if not s['verified_cleanups']:continue
                    rows.append(dict(id=digest('public-captain:'+item['id']),name=item['name'],photo_url=f"/api/operations/local-business/captain/avatar/{digest('public-captain:'+item['id'])}/{item['photo_id']}" if item.get('photo_id') else None,mine=item['id']==user['id'],**{k:s[k] for k in ['ranking_points','active_days','verified_cleanups','gold']}))
            rows.sort(key=lambda x:(-x['ranking_points'],-x['active_days'],-x['verified_cleanups'],x['id']))
            for i,row in enumerate(rows):row['rank']=i+1
            own=next((x for x in rows if x['mine']),None)
            return {'city':p.get('city',''),'entries':rows[:50],'my_rank':own,'participants':len(rows),'server_time':now}
        return store.run(read)
    @r.get('/photo/{photo_id}')
    def own_photo(photo_id:str,user=Depends(core.current_user)):
        def read(u):
            p=u.get('captain_profiles',user['id']) or {}
            if p.get('photo_id')!=photo_id:fail('NOT_FOUND','Photo unavailable.',404)
            return document(u,photo_id,user['id'])
        doc=store.run(read)
        return Response(download_object(doc['object']),media_type='image/jpeg',headers={'Cache-Control':'private, no-store'})
    @r.get('/avatar/{public_id}/{photo_id}')
    def avatar(public_id:str,photo_id:str):
        def read(u):
            doc=u.get('business_documents',photo_id)
            if not doc:fail('NOT_FOUND','Photo unavailable.',404)
            p=u.get('captain_profiles',doc['owner_id']) or {}
            if not p.get('public') or p.get('photo_id')!=photo_id or digest('public-captain:'+doc['owner_id'])!=public_id:fail('NOT_FOUND','Photo unavailable.',404)
            return doc
        doc=store.run(read)
        return Response(download_object(doc['object']),media_type='image/jpeg',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
    core.app.include_router(r)
