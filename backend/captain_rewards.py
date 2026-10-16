"""Verified community points, opt-in rankings and account-bound Repaido rewards.

No client scoring, cash conversion, demographic weighting or passive activity rewards.
"""
import math
import time
from fastapi import APIRouter, Depends, Response
from pydantic import Field
from operations import Input, fail, metres
from local_business import digest, document, partner_profile
from evidence import download_object
from captain_policy import OFFERS, LEVELS, Policy as RewardPolicy, level_summary, limits, reserve_budget

DAY = 86400
VERSION = 'captain-v2'
TERMS = 'Repaido-funded. One use per offer per 30 days while Gold is active. No stacking. Eligible base only; taxes, parts, deposits, delivery and extras excluded. Reservation counts as use.'
# Exact catalogue categories, never a fuzzy match against seller marketing copy.
APPLIANCES = {'appliances', 'home appliances', 'refurbished appliances', 'refrigerator', 'refrigerators', 'washing machine', 'washing machines', 'air conditioner', 'air conditioners', 'television', 'televisions'}
FACTORS = [
    'Independent completion review', 'Collection permission recorded', 'Public-place declaration',
    'Safe material category', 'Before evidence present', 'After evidence present',
    'Different before and after photos', 'Evidence belongs to its uploader', 'Evidence claimed by this report',
    'Authorised collector or approved contributor', 'Disposal destination recorded', 'Review note recorded',
    'Location within 300 metres', 'Location accuracy within 100 metres', 'Fresh location at submission',
    'Verification follows submission', 'Award issued once per report', 'Maximum 50 points per India-time day across contributions',
    'Points earned in the last 30 days', 'Age of each verified award', '30-day decay period',
    '30% retained ranking floor', 'Verified days of contribution', 'Lifetime verified cleanups',
]

def totals(ledger, now=None):
    now = time.time() if now is None else now
    rows = [r for r in ledger if not r.get('revoked') and type(r.get('points')) is int and r['points'] >= 0
            and type(r.get('created_at')) in (int,float) and math.isfinite(r['created_at']) and 0 <= r['created_at'] <= now]
    scored = [r for r in rows if r['points'] > 0]
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
    earned_today=sum(r['points'] for r in rows if int((r['created_at']+19800)//DAY)==int((now+19800)//DAY))
    return dict(points=qualifying, qualifying_points=qualifying, lifetime_points=sum(r['points'] for r in rows), ranking_points=math.floor(rank+1e-8), verified_cleanups=len(rows), verified_contributions=len(rows), scored_contributions=len(scored), verified_public_cleanups=sum(r.get('source','cleanup')=='cleanup' for r in rows), verified_scrap_collections=sum(r.get('source')=='scrap' for r in rows), active_days=len({int((r['created_at']+19800)//DAY) for r in scored}), gold=qualifying>=100, gold_until=expiry if qualifying>=100 else None, captain_at=100, points_per_cleanup=10, points_per_contribution=10, daily_points_limit=50, earned_today=earned_today, points_available_today=max(0,50-earned_today), expiring_in_seven_days=sum(r['points'] for r in recent if r['created_at']+30*DAY<=now+7*DAY), next_expiry_at=min((r['created_at']+30*DAY for r in recent if r['points']),default=None), badge='Swachh Bharat Captain · Gold' if qualifying>=100 else 'Cleanliness contributor', levels=LEVELS, **level_summary(qualifying), server_time=now)


def record_contribution(u, row, uid, source, now, checks, *, identifier=None, counterpart=None):
    """One account/source receipt, one shared daily limit, one ranking projection."""
    identifier=identifier or row['id']
    existing=u.get('cleanup_points',identifier)
    if existing:return existing
    ledger=u.find('cleanup_points','user_id',uid)
    day=int((now+19800)//DAY)
    today=[r for r in ledger if not r.get('revoked') and int((r['created_at']+19800)//DAY)==day]
    pair_used=source=='scrap' and any(r.get('source')=='scrap' and r.get('counterpart_id')==counterpart and r['points']>0 for r in today)
    points=10 if sum(r['points'] for r in today)<50 and not pair_used else 0
    reason='Daily points limit reached' if not points and not pair_used else 'Points already earned with this collection partner today' if pair_used else ''
    result=dict(id=identifier,user_id=uid,source=source,source_id=row['id'],points=points,created_at=now,version=VERSION,
                reason=reason,counterpart_id=counterpart,checks=checks)
    u.put('cleanup_points',identifier,result)
    # Concurrent awards for the same account conflict on this projection. A
    # retried Firestore transaction rechecks the entire shared daily limit.
    profile=u.get('captain_profiles',uid) or {'id':uid,'public':False,'name':'','photo_id':None,'version':0}
    profile.update(city=row['city'],city_key=row['city'].strip().casefold(),awards=[{k:x[k] for k in ('points','created_at','source') if k in x} for x in ledger+[result]])
    u.put('captain_profiles',uid,profile)
    return result

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
    checks.append(totals(u.find('cleanup_points','user_id',row['customer_id']),now)['points_available_today']>0)
    verified=[dict(label=label,passed=bool(value)) for label,value in zip(FACTORS,checks)]
    result=record_contribution(u,row,row['customer_id'],'cleanup',now,verified)
    if row.get('owner_id') and row['owner_id']!=row['customer_id']:
        collector_checks=verified[:-1]+[dict(label=FACTORS[17],passed=totals(u.find('cleanup_points','user_id',row['owner_id']),now)['points_available_today']>0)]
        collector=record_contribution(u,row,row['owner_id'],'cleanup',now,collector_checks,
                                      identifier=digest('cleanup-collector:'+row['id']+':'+row['owner_id']))
        row['collector_points']=collector['points']
    return result


def award_scrap(u, row, now):
    """A sale earns nothing until both parties have confirmed the weighed payment."""
    photo=u.get('business_documents',row.get('photo_document_id','')) or {}
    quote=row.get('evaluation') or {}
    scale=u.get('business_documents',quote.get('weighing_document_id','')) or {}
    partner=partner_profile(u,row.get('owner_id',''),'scrap_owner') or {}
    checks=[('Customer confirmed receipt',row.get('state')=='completed' and row.get('payment_source')=='customer_confirmed_receipt'),
            ('Different seller and approved collector',bool(row.get('owner_id')) and row['owner_id']!=row['customer_id'] and partner.get('status')=='approved' and partner.get('valid_until',0)>=row.get('accepted_at',now)),
            ('Camera receipt belongs to this collection',photo.get('kind')=='scrap_camera' and photo.get('claimed_by')==row['id'] and photo.get('owner_id')==row['customer_id']),
            ('Collector arrived before weighing',row.get('experience_version',0)>=2 and row.get('travel_phase')=='arrived'),
            ('Collector owns scale evidence',scale.get('owner_id')==row.get('owner_id') and bool(scale.get('object'))),
            ('Agreed positive quote matches payment',type(row.get('agreed_paise')) is int and row['agreed_paise']>0 and row['agreed_paise']==quote.get('total_paise')),
            ('Positive net weight recorded',bool(quote.get('lines')) and all(x.get('net_grams',0)>0 for x in quote.get('lines',[])))]
    if not all(value for _,value in checks):
        row['rewards_status']='not_eligible'
        row['rewards_note']='This collection is complete. Points require a pickup camera receipt, arrival and scale evidence.'
        return
    verified=[dict(label=label,passed=True) for label,_ in checks]
    for role,uid,other in [('customer',row['customer_id'],row['owner_id']),('collector',row['owner_id'],row['customer_id'])]:
        result=record_contribution(u,row,uid,'scrap',now,verified,identifier=digest('scrap-points:'+row['id']+':'+uid),counterpart=other)
        row[role+'_points']=result['points']
        row[role+'_points_note']=result['reason']
    row['rewards_status']='confirmed'

def offers(u, uid, summary, now):
    from captain_policy import month
    u.prefetch([('captain_redemptions',digest(uid+':'+code)) for code in OFFERS]+[('captain_policies','current'),('captain_budget',month(now))])
    items=[]
    for code,rule in OFFERS.items():
        used=u.get('captain_redemptions',digest(uid+':'+code)) or {}
        next_at=used.get('reserved_at',0)+30*DAY if used else None
        cap,policy_reason,policy_version=limits(u,rule,code,summary,now)
        first_used=cap is not None and rule.get('first_only') and any(r.get('state') in ('accepted','boarded','completed') for r in u.find('shared_passengers','customer_id',uid))
        reason=policy_reason or ('Terms being finalised' if cap is None else 'Earn 100 points in 30 days' if not summary['gold'] else 'Your first shared-ride offer has been used' if first_used else 'Available again after 30 days' if next_at and now<next_at else '')
        items.append(dict(**{**rule,'cap_paise':cap},code=code,available=not reason,reason=reason,next_use_at=next_at if next_at and now<next_at else None,terms=TERMS,funded_by='repaido',policy_version=policy_version,expires_at=summary.get('gold_until'),level=summary['level']['name']))
    return items

def validate(u,uid,code,scope,now=None):
    now=time.time() if now is None else now
    summary=totals(u.find('cleanup_points','user_id',uid),now)
    offer=next((x for x in offers(u,uid,summary,now) if x['code']==code.strip().upper()),None)
    actual_scope='visit' if scope=='service' else scope
    if not offer or not offer['available'] or offer['scope']!=actual_scope:fail('REWARD_UNAVAILABLE','This reward is not available for this checkout. Check Gold status, offer limits and the eligible category.',409)
    return offer

def reserve(u,uid,code,scope,base,reference,now=None):
    now=time.time() if now is None else now;code=code.strip().upper();key=digest(uid+':'+code)
    ledger_key=digest(uid+':'+reference)
    old=u.get('captain_reward_ledger',ledger_key)
    if old:
        if old['code']!=code or old['eligible_base_paise']!=base or old.get('scope',scope)!=scope:fail('REWARD_CHANGED','This checkout already has a different reward reservation.',409)
        return {k:v for k,v in old.items() if k not in ('user_id','reference','reserved_at')}
    offer=validate(u,uid,code,scope,now)
    if base<=0:fail('REWARD_BASE_REQUIRED','An eligible base charge is required.',422)
    snapshot=dict(code=code,scope=scope,bps=offer['bps'],cap_paise=offer['cap_paise'],eligible_base_paise=base,discount_paise=min(base*offer['bps']//10000,offer['cap_paise']),funded_by='repaido',terms=TERMS,version=VERSION,expires_at=offer['expires_at'],level=offer['level'])
    reserve_budget(u,snapshot['discount_paise'],offer['policy_version'],now)
    u.put('captain_redemptions',key,dict(user_id=uid,code=code,reference=reference,reserved_at=now,snapshot=snapshot))
    u.put('captain_reward_ledger',ledger_key,dict(user_id=uid,reference=reference,reserved_at=now,**snapshot))
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
            sales=u.find('scrap_collections','customer_id',user['id'])
            collections=u.find('scrap_collections','owner_id',user['id'])
            return {**s,'profile':{k:p.get(k,d) for k,d in [('name',''),('photo_id',None),('public',False),('city',''),('version',0)]},'offers':offers(u,user['id'],s,now),'cash_received_paise':sum(x['reward_paise'] for x in reports if x['payment_state']=='received'),'cash_pending_paise':sum(x['reward_paise'] for x in reports if x['payment_state'] in ('approved','reported','disputed')),'scrap_received_paise':sum(x.get('agreed_paise',0) for x in sales if x['state']=='completed' and x.get('payment_source')=='customer_confirmed_receipt'),'scrap_paid_paise':sum(x.get('agreed_paise',0) for x in collections if x['state']=='completed' and x.get('payment_source')=='customer_confirmed_receipt'),'factors':FACTORS,'awards':sorted(ledger,key=lambda x:x['created_at'],reverse=True)[:30]}
        return store.run(read)
    @r.get('/admin/policy')
    def policy(admin=Depends(core.operator)):
        from captain_policy import policy_view
        return store.run(policy_view)
    @r.post('/admin/policy')
    def configure(body:RewardPolicy,admin=Depends(core.operator)):
        from captain_policy import save_policy
        return store.run(lambda u:save_policy(u,body,admin['id']))
    @r.post('/profile')
    def profile(body:Profile,user=Depends(core.current_user)):
        def save(u):
            p=u.get('captain_profiles',user['id']) or {'id':user['id'],'version':0}
            if p.get('version',0)!=body.expected_version:
                if p.get('version')==body.expected_version+1 and all(p.get(k)==v for k,v in dict(name=body.name.strip(),photo_id=body.photo_id,public=body.public).items()):return {'saved':True,'version':p['version']}
                fail('STALE_VERSION','Your profile changed. Close and reopen settings before saving.',409)
            if body.public and len(body.name.strip())<2:fail('NAME_REQUIRED','Add a display name to join the leaderboard.',422)
            if body.photo_id:
                photo=document(u,body.photo_id,user['id'])
                if u.get('cleanup_evidence_claims',body.photo_id) or photo.get('kind')=='scrap_camera' or photo.get('weighing_collection_id'):fail('PRIVATE_EVIDENCE','Upload a separate profile photo. Collection and report evidence stay private.',422)
            p.update(body.model_dump(exclude={'expected_version'}),name=body.name.strip(),version=p.get('version',0)+1)
            ledger=u.find('cleanup_points','user_id',user['id']);p['awards']=[{k:x[k] for k in ('points','created_at','source') if k in x} for x in ledger]
            # Legacy records get their verified city only, never a client-selected ranking city.
            completed=sorted((x for x in u.find('cleanup_reports','customer_id',user['id']) if x['state']=='completed'),key=lambda x:x.get('completed_at',0))
            if completed and not p.get('city'):p.update(city=completed[-1]['city'],city_key=completed[-1]['city_key'])
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
                    if not s['scored_contributions']:continue
                    rows.append(dict(id=digest('public-captain:'+item['id']),name=item['name'],photo_url=f"/api/operations/local-business/captain/avatar/{digest('public-captain:'+item['id'])}/{item['photo_id']}" if item.get('photo_id') else None,mine=item['id']==user['id'],**{k:s[k] for k in ['ranking_points','active_days','verified_cleanups','verified_contributions','scored_contributions','gold','level']}))
            rows.sort(key=lambda x:(-x['ranking_points'],-x['active_days'],-x['scored_contributions'],x['id']))
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
