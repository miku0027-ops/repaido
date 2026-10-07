"""Public Hire leaderboards: consented profiles, genuine outcomes, no contact/location fields."""
import copy,json,math,os,re,threading,time
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from collections import OrderedDict,defaultdict
from concurrent.futures import Future
from typing import Annotated,Literal
from fastapi import APIRouter,Depends,Response
from pydantic import Field
from operations import Input,Pin,metres,fail
from hiring import listing_eligible,free_listing,policy
from worker_records import public_profile
from home_plans import OFFERINGS
from discovery import relevance,terms
from search_index import public_search
from integrations import enabled,configured

JOB_FIELDS=('worker_id','state','review','service_name','category','service_id','home_plan_id','completed_at')
RECOMMENDATION_CANDIDATES=64
RECOMMENDATION_PROFILES=12
RECOMMENDATION_WORK_RECORDS=80

class Recommendations(Input):
    city:str=Field(min_length=1,max_length=80)
    category:str=Field(default='',max_length=60)
    location:Pin|None=None
    radius_km:float=Field(default=20,ge=1,le=50)
    role:Literal['all','technician','specialist','contractor']='all'
    strict_nearby:bool=False
    allow_buffer:bool=False
    min_rating:float=Field(default=0,ge=0,le=5)
    min_experience:int=Field(default=0,ge=0,le=50)
    min_completed:int=Field(default=0,ge=0,le=10000)
    language:str=Field(default='',max_length=60)
    available_only:bool=False
    sort:Literal['recommended','rating','experience','completed']='recommended'
    query:str=Field(default='',max_length=100)
    budget_paise:int|None=Field(default=None,ge=0,le=100000000,strict=True)
    limit:int=Field(default=6,ge=1,le=8,strict=True)
    compare_ids:list[Annotated[str,Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_.:@-]+$')]]=Field(default_factory=list,max_length=4)

def bounded_rows(u,kind,field,value,limit,fields=None):
    """Existing single-field indexes, hard read bounds; no new composite index.

    This is a candidate window, not a whole-city ranking. Firestore's equality
    query uses its automatic single-field index and default document ordering.
    No historical query is run on every keystroke by the public leaderboard.
    """
    if (kind,field) not in (('workers','city'),('jobs','worker_id'),('hires','worker_id'),('professional_offers','worker_id')):
        raise ValueError('Unsupported recommendation lookup')
    if u.tx is not None:
        query=u.core.fs_collection('ops_'+kind).where(field,'==',value).limit(limit)
        if fields:query=query.select(fields)
        rows={s.id:s.to_dict() for s in query.stream(transaction=u.tx)}
    else:
        sql=f"SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.{field}')=? LIMIT ?"
        rows={r['id']:json.loads(r['body']) for r in u.conn.execute(sql,(kind,value,limit))}
    # A transaction's own writes must be represented without escaping the cap.
    for (k,key),item in u.pending.items():
        if k==kind:
            if item.get(field)==value:rows[key]=copy.deepcopy(item)
            else:rows.pop(key,None)
    values=list(rows.values())[:limit]
    if not fields:u.fetched.update({(kind,key):copy.deepcopy(row) for key,row in rows.items()})
    if fields:values=[{k:row[k] for k in fields if k in row} for row in values]
    return values

def recommendation_categories(catalog,prefs,now):
    """Use only the explicit v2 opt-in and bounded aggregated category signals."""
    names={c['id']:c['name'] for c in catalog['categories']}
    valid={s['category'] for s in catalog['services'] if s.get('active',True)}
    names={c:names.get(c,c.replace('_',' ').title()) for c in valid}
    names.update({'home:'+s['id']:s['name'] for s in OFFERINGS})
    opted=bool(prefs.get('enabled') and prefs.get('consent_version')==2)
    signals=prefs.get('signals',{}) if opted else {}
    output=[]
    for cid,name in names.items():
        # Home event recording stores its ordinary category; don't silently
        # turn a broad category visit into a preference for a particular plan.
        signal=signals.get(cid,{})
        age=max(0,now-signal.get('at',0))
        score=signal.get('score',0)*math.exp(-age/(7*86400)) if age<30*86400 else 0
        established=signal.get('visits',0)>=2 and score>=1 and signal.get('at',0)<=now
        output.append({'id':cid,'name':name,'personalised':established,
                       'reason':'Based on categories you repeatedly explored' if established else 'Browse this category',
                       'interest_confidence':'established' if established else 'none',
                       'last_explored_at':signal.get('at') if established else None,
                       '_interest_score':score if established else 0})
    output.sort(key=lambda c:(-c['_interest_score'],c['name'],c['id']))
    return output,opted

def comparison_fields(category):
    standard=[{'id':'verified_work','label':'Completed work & customer reviews','source':'completed_work'},
              {'id':'experience','label':'Years of experience','source':'reviewed_profile'},
              {'id':'skills','label':'Relevant skills','source':'reviewed_profile'},
              {'id':'specialties','label':'Specialties','source':'professional_profile'},
              {'id':'tools','label':'Tools listed','source':'reviewed_profile'},
              {'id':'languages','label':'Languages','source':'professional_profile'},
              {'id':'catalogue','label':'Catalogue reference prices','source':'current_catalogue'}]
    if category.startswith('home:'):
        standard[-1]={'id':'scope','label':'Written scope & quote','source':'home_service_catalogue'}
        standard.append({'id':'approved_service','label':'Reviewed Home service','source':'team_review'})
    labels={'ac':('Appliance skills','Diagnostic & service tools'),
            'plumbing':('Plumbing skills','Plumbing tools'),
            'plumber':('Plumbing skills','Plumbing tools'),
            'electrician':('Electrical skills','Electrical testing tools'),
            'electrical':('Electrical skills','Electrical testing tools'),
            'cleaning':('Cleaning skills','Cleaning equipment'),
            'carpenter':('Carpentry skills','Carpentry tools'),
            'painting':('Painting & surface skills','Painting tools')}
    if category in labels:
        standard[2]['label'],standard[4]['label']=labels[category]
    return standard

def recommendation_read(u,core,body,user,catalog):
    from hiring import free_listing as campaign_active
    if body.strict_nearby and (body.location is None or body.radius_km not in (8,10) or body.allow_buffer):fail('NEARBY_REQUIRED','Choose a location and an 8 or 10 km radius without a buffer.',422)
    now=time.time();prefs=u.get('discovery_preferences',user['id']) or {}
    categories,opted=recommendation_categories(catalog,prefs,now)
    known={c['id']:c for c in categories}
    if body.category and body.category not in known:fail('INVALID_CATEGORY','Choose a listed category.',422)
    selected=body.category or next((c['id'] for c in categories if c['personalised']),'')
    category_interest=known.get(selected,{})
    personalised=bool(opted and category_interest.get('personalised'))
    cold_start=not any(c['personalised'] for c in categories)
    public_categories=[{k:v for k,v in c.items() if not k.startswith('_')} for c in categories]
    result={'personalised':personalised,'consent_required':not opted,'cold_start':cold_start,
            'generated_at':now,'refresh_after_seconds':20,
            'preferences_updated_at':prefs.get('updated_at') if opted else None,
            'categories':public_categories,'selected_category':selected,'professionals':[],
            'comparisons':[],'missing_compare_ids':list(dict.fromkeys(body.compare_ids)),
            'comparison_fields':comparison_fields(selected) if selected else [],
            'candidate_window':{'limit':RECOMMENDATION_CANDIDATES,'examined':0,'has_more':False,
                'note':'Recommendations compare a bounded city candidate window, not every professional or a guaranteed match.'},
            'method':'Selected category first. Fit score uses verified reviews in that category, completed-work evidence, listed experience, your current search and freshly checked availability. It is not a probability, public rank, diagnosis or price quote.'}
    if not selected:return result
    city=next((c for c in core.CITIES if c.casefold()==body.city.strip().casefold()),body.city.strip())
    pool=bounded_rows(u,'workers','city',city,RECOMMENDATION_CANDIDATES+1)
    result['candidate_window'].update(examined=min(len(pool),RECOMMENDATION_CANDIDATES),has_more=len(pool)>RECOMMENDATION_CANDIDATES)
    pool=pool[:RECOMMENDATION_CANDIDATES]
    requested=list(dict.fromkeys(body.compare_ids))
    if any(not re.fullmatch(r'[A-Za-z0-9_.:@-]{1,128}',wid) for wid in requested):fail('INVALID_PROFILE','Choose a listed professional.',422)
    u.prefetch([('workers',wid) for wid in requested])
    workers={w['id']:w for w in pool}
    workers.update({wid:w for wid in requested if (w:=u.get('workers',wid))})
    ids=list(workers)
    u.prefetch([('hire_policy','current'),('policies','current'),
                *[('hire_memberships',wid) for wid in ids],*[('partner_entitlements',wid) for wid in ids],
                *[('worker_profiles',wid) for wid in ids],*[('home_availability',wid) for wid in ids]])
    hire_policy=policy(u)
    services=[s for s in catalog['services'] if s.get('active',True) and s['category']==selected]
    eligible=[]
    for w in workers.values():
        wid=w['id'];member=u.get('hire_memberships',wid) or {}
        if w.get('status')!='approved' or w.get('city','').strip().casefold()!=city.casefold() or not listing_eligible(u,wid):continue
        entitlement=u.get('partner_entitlements',wid) or {}
        earned=entitlement.get('starts_at',0)<=now<entitlement.get('ends_at',0)
        if not campaign_active() and not earned and member.get('policy_version')!=hire_policy['version']:continue
        if body.role=='contractor' and not w.get('contractor_verified'):continue
        if body.role not in ('all','contractor') and w.get('role')!=body.role:continue
        if (w.get('experience_years') or 0)<body.min_experience:continue
        home=(u.get('home_availability',wid) or {}).get('approved_services',[])
        if not (selected in w.get('categories',[]) or selected.startswith('home:') and selected[5:] in home):continue
        origin=w.get('location')
        if body.location:
            radius=min(body.radius_km,member.get('radius_km',w.get('radius_km',0)))*(1+hire_policy['radius_buffer_bps']/10000 if body.allow_buffer else 1)
            if not origin or metres(body.location.model_dump(),origin)>radius*1000:continue
        p=u.get('worker_profiles',wid) or {}
        if body.language and body.language.casefold() not in [str(x).casefold() for x in p.get('languages',[])]:continue
        search_text=' '.join([text(w.get('name')),*[text(x) for x in w.get('skills',[])],*[text(x) for x in p.get('specialties',[])],known[selected]['name']])
        if body.query and relevance(body.query,search_text)<.5:continue
        if body.available_only:
            pos=w.get('position') or {}
            if not (w.get('online') and 0<=now-pos.get('received_at',0)<=300 and pos.get('accuracy',1000)<=100):continue
        eligible.append((w,relevance(body.query,search_text)))
    # Expensive evidence is bounded separately from the city candidate window.
    def presence(w):
        pos=w.get('position') or {}
        return bool(w.get('online') and 0<=now-pos.get('received_at',0)<=300 and pos.get('accuracy',1000)<=100)
    eligible.sort(key=lambda pair:(pair[0]['id'] not in requested,-pair[1],not presence(pair[0]),-(pair[0].get('experience_years') or 0),pair[0]['id']))
    selected_workers=eligible[:RECOMMENDATION_PROFILES]
    for w,match in selected_workers:
        wid=w['id']
        work=bounded_rows(u,'jobs','worker_id',wid,RECOMMENDATION_WORK_RECORDS+1,JOB_FIELDS)
        complete=len(work)<=RECOMMENDATION_WORK_RECORDS;work=work[:RECOMMENDATION_WORK_RECORDS]
        hires=bounded_rows(u,'hires','worker_id',wid,21,('worker_id','state'))
        offers=bounded_rows(u,'professional_offers','worker_id',wid,21)
        row=profile(u,w,work,offers[:20])
        offer_services={selected[5:]} if selected.startswith('home:') else {s['id'] for s in OFFERINGS if s['category']==selected}
        row['offers']=[offer for offer in row['offers'] if offer['service_id'] in offer_services]
        if body.min_completed>row['completed_tasks'] or (body.min_rating and (row['rating'] or 0)<body.min_rating):continue
        row['service_packages']=[{k:s.get(k) for k in ('id','name','description','price_paise','duration_minutes','included','excluded')} for s in services]
        busy=any(j.get('state') in ('offered','accepted','en_route','travelling','arrived','in_progress','collecting_parts','parts_pending','parts_approved','completion_pending') for j in work)
        busy=busy or any(h.get('state') in ('offered','awaiting_choice','quoting','quoted') for h in hires)
        pos=w.get('position') or {};fresh=bool(w.get('online') and 0<=now-pos.get('received_at',0)<=300 and pos.get('accuracy',1000)<=100)
        if body.location and fresh:
            radius=min(body.radius_km,(u.get('hire_memberships',wid) or {}).get('radius_km',w.get('radius_km',0)))*(1+hire_policy['radius_buffer_bps']/10000 if body.allow_buffer else 1)
            fresh=metres(body.location.model_dump(),pos)+pos.get('accuracy',0)<=radius*1000
        row['available_now']=bool(fresh and not busy and complete and len(hires)<=20)
        if body.available_only and not row['available_now']:continue
        row['availability_status']='confirmed_recent' if row['available_now'] else 'busy' if busy else 'not_confirmed'
        row['availability_note']='Recent presence checked; acceptance and your requested schedule still require confirmation.'
        if body.location:row['distance_km']=round(metres(body.location.model_dump(),w['location'])/1000,1)
        record=next((c for c in row['category_records'] if c['category']==selected),None) or {'completed':0,'review_count':0,'rating':None}
        n=record['review_count'];rating=record['rating'];done=record['completed'];confidence=n/(n+5)
        components=[{'id':'verified_reviews','label':'Verified category reviews','points':round((rating or 0)/5*confidence*60,2),'maximum':60,'source':'completed_work'},
                    {'id':'completed_work','label':'Completed category work','points':round(min(done,20)/20*10,2),'maximum':10,'source':'completed_work'},
                    {'id':'experience','label':'Listed years of experience','points':round(min(w.get('experience_years') or 0,10),2),'maximum':10,'source':'reviewed_profile'},
                    {'id':'search_match','label':'Current search match','points':round(match*10,2) if body.query else 0,'maximum':10,'source':'current_request'},
                    {'id':'availability','label':'Fresh presence without known active work','points':10 if row['available_now'] else 0,'maximum':10,'source':'current_presence'}]
        reasons=[]
        if personalised:reasons.append(category_interest['reason'])
        if n:reasons.append(f'{n} verified reviews from completed work in this category')
        else:reasons.append('No verified completed-work reviews in this category yet')
        if body.query:reasons.append('Matches the skills or specialties in your current search')
        if row['available_now']:reasons.append('Recent presence checked; schedule still needs confirmation')
        if not complete:reasons.append('Work evidence is a bounded sample, not lifetime totals')
        row['recommendation']={'score':round(sum(c['points'] for c in components),2),'components':components,'reasons':reasons,
            'score_is_probability':False,'evidence_scope':{'kind':'bounded_worker_records','record_limit':RECOMMENDATION_WORK_RECORDS,'complete':complete}}
        references=[{**{k:s.get(k) for k in ('id','name','price_paise','duration_minutes','included','excluded')},'basis':'catalogue_reference'} for s in services]
        prices=[s['price_paise'] for s in services if isinstance(s.get('price_paise'),int)]
        budget='unknown'
        if body.budget_paise is not None and prices:
            budget='within_catalogue_reference' if max(prices)<=body.budget_paise else 'above_catalogue_reference' if min(prices)>body.budget_paise else 'mixed_catalogue_references'
        attributes=[{'id':k,'label':next((f['label'] for f in result['comparison_fields'] if f['id']==k),k.title()),'value':row.get(source,[]),'source':claim}
                    for k,source,claim in (('skills','skills','reviewed_profile'),('specialties','specialties','professional_profile'),('tools','tools','reviewed_profile'),('languages','languages','professional_profile'))]
        attributes.insert(0,{'id':'experience','label':'Years of experience','value':w.get('experience_years'),'source':'reviewed_profile'})
        readiness=bool(hire_policy.get('enabled') and isinstance(hire_policy.get('day_hours'),int) and isinstance(hire_policy.get('gst_bps'),int) and hire_policy.get('terms'))
        row['comparison']={'category':selected,'category_name':known[selected]['name'],
            'verified_work':{'completed':done,'review_count':n,'rating':rating,'confidence':round(confidence,3)},
            'attributes':attributes,'catalogue_references':references,'budget_status':budget,
            'price_note':'Catalogue amounts are reference prices for the listed scope, not a binding day-hire quote. Materials, extras, tax and route-based travel must be confirmed separately.',
            'offers_note':'Only the professional’s active, reviewed Home offers are shown. Savings apply to an agreed first-period base fee and are calculated in the written quote; catalogue prices are not reduced here.',
            'hire_readiness':{'enabled':readiness,'policy_version':hire_policy['version'],'day_hours':hire_policy.get('day_hours'),
                'base_paise':hire_policy.get('base_paise') if readiness else None,'quote_required':True,
                'routing_ready':bool(os.getenv('GOOGLE_ROUTES_API_KEY')),
                'payments_ready':enabled('REPAIDO_PAYMENTS_ENABLED') and configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET')}}
        if selected.startswith('home:'):
            row['comparison']['home_service']=next(({k:s[k] for k in ('id','name','description','recurring')} for s in OFFERINGS if s['id']==selected[5:]),None)
            row['comparison']['budget_status']='unknown'
        result['professionals'].append(row)
    sorters={'recommended':lambda row:(-row['recommendation']['score'],row['id']),
             'rating':lambda row:(-(row['comparison']['verified_work']['rating'] or 0),-row['comparison']['verified_work']['review_count'],row['id']),
             'experience':lambda row:(-(row.get('experience_years') or 0),-row['recommendation']['score'],row['id']),
             'completed':lambda row:(-row['comparison']['verified_work']['completed'],-row['recommendation']['score'],row['id'])}
    result['professionals'].sort(key=sorters[body.sort])
    result['comparisons']=[row for wid in requested for row in result['professionals'] if row['id']==wid]
    result['missing_compare_ids']=[wid for wid in requested if not any(row['id']==wid for row in result['comparisons'])]
    result['professionals']=result['professionals'][:body.limit]
    return result

class BrowseCache:
    """Small per-instance cache for public city browsing; never used for live availability."""
    def __init__(self,ttl=8,max_entries=128):
        self.ttl,self.max_entries=ttl,max_entries
        self.lock=threading.Lock()
        self.rows=OrderedDict()
        self.pending={}

    def get_or_load(self,key,load):
        if key is None:return load()
        with self.lock:
            entry=self.rows.get(key)
            if entry and time.monotonic()-entry[0]<self.ttl:
                self.rows.move_to_end(key)
                return copy.deepcopy(entry[1])
            self.rows.pop(key,None)
            future=self.pending.get(key)
            owner=future is None
            if owner:
                future=Future();self.pending[key]=future
        if not owner:return copy.deepcopy(future.result(timeout=25))
        try:
            value=load()
            with self.lock:
                self.rows[key]=(time.monotonic(),copy.deepcopy(value))
                while len(self.rows)>self.max_entries:self.rows.popitem(last=False)
            future.set_result(value)
            return value
        except Exception as error:
            future.set_exception(error)
            raise
        finally:
            with self.lock:self.pending.pop(key,None)

class Browse(Input):
    city:str=Field(max_length=80)
    location:Pin|None=None
    radius_km:float=Field(default=20,gt=0,le=50)
    category:str=Field(default='',max_length=60)
    role:Literal['all','technician','specialist','contractor']='all'
    strict_nearby:bool=False
    query:str=Field(default='',max_length=100)
    sort:Literal['recommended','rating','experience','completed']='recommended'
    min_rating:float=Field(default=0,ge=0,le=5)
    min_experience:int=Field(default=0,ge=0,le=50)
    min_completed:int=Field(default=0,ge=0,le=10000)
    language:str=Field(default='',max_length=60)
    available_only:bool=False
    allow_buffer:bool=False

def text(value):
    # Public free text must not become a direct-contact shortcut.
    s=str(value or '')
    s=re.sub(r'(?<!\w)(?:\+?\d[\s().-]*){8,15}(?!\w)','[contact hidden]',s)
    return re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[contact hidden]',s)

def profile(u,w,jobs,offers=None,*,include_membership=True,include_network=True):
    p=public_profile(u,w,jobs=jobs,include_membership=include_membership,include_network=include_network)
    for key in ('city','radius_km'):p.pop(key,None)
    for key in ('name','bio'):p[key]=text(p.get(key))
    for key in ('skills','tools','languages','specialties'):p[key]=[text(v) for v in p.get(key,[])]
    for r in p['reviews']:
        for key in ('service','text','reply'):
            if r.get(key):r[key]=text(r[key])
    completed=[j for j in jobs if j['state']=='completed'];groups=defaultdict(list)
    for j in completed:groups[j['category']].append(j)
    # Home jobs retain their explicit service ID; generic category is used for ordinary tasks.
    for j in completed:
        if j.get('home_plan_id') and j['service_id'].startswith('home-'):
            groups['home:'+j['service_id'][5:]].append(j)
    p['category_records']=[{'category':c,'completed':len(rows),'review_count':len(rs:=[j['review']['rating'] for j in rows if j.get('review')]),'rating':round(sum(rs)/len(rs),2) if rs else None} for c,rows in groups.items()]
    p['category_records'].sort(key=lambda r:(-r['completed'],r['category']))
    p['completed_tasks']=len(completed)
    p['work_history']=[{'service':text(j['service_name']),'category':j['category'],'completed_at':j.get('completed_at'),'rating':j.get('review',{}).get('rating')} for j in sorted(completed,key=lambda j:j.get('completed_at',0),reverse=True)[:12]]
    p['home_services']=(u.get('home_availability',w['id']) or {}).get('approved_services',[])
    p['contractor_verified']=bool(w.get('contractor_verified'))
    from professional_offers import active_offers
    p['offers']=active_offers(u,w['id'],offers=offers)
    p['listed_member']=True
    return p

def weekly_ranks(u,wid):
    worker=u.get('workers',wid)
    if not worker or worker['status']!='approved':fail('APPROVAL_REQUIRED','An approved worker profile is required.',403)
    now=datetime.fromtimestamp(time.time(),ZoneInfo('Asia/Kolkata'))
    start=(now-timedelta(days=now.weekday())).replace(hour=0,minute=0,second=0,microsecond=0)
    end=start+timedelta(days=7)
    eligible={w['id']:w for w in u.find('workers','city',worker['city']) if w['status']=='approved' and listing_eligible(u,w['id'])}
    jobs=[j for j in u.for_workers('jobs',eligible,JOB_FIELDS) if j['state']=='completed' and start.timestamp()<=j.get('completed_at',0)<min(end.timestamp(),time.time()+1)]
    output=[]
    for category in worker['categories']:
        scores={}
        for uid,w in eligible.items():
            if category not in w['categories']:continue
            rows=[j for j in jobs if j['worker_id']==uid and j['category']==category]
            ratings=[j['review']['rating'] for j in rows if j.get('review')]
            if rows:scores[uid]=(sum(ratings)/(len(ratings)+5),len(rows),len(ratings))
        score=scores.get(wid)
        rank=1+sum(other>score for other in scores.values()) if score else None
        output.append({'category':category,'rank':rank,'participants':len(scores),'completed':score[1] if score else 0,'reviews':score[2] if score else 0})
    return {'city':worker['city'],'starts_at':start.timestamp(),'ends_at':end.timestamp(),'categories':output,'method':'Weekly completed work in your city and category, ordered by verified-review confidence, completed tasks, then review count. Equal scores share a rank. No completed work this week means unranked.'}

def install(core):
    r=APIRouter(prefix='/operations/hiring',tags=['Hire discovery']);store=core.operations_store
    browse_cache=BrowseCache()
    @r.post('/recommendations')
    def recommendations(body:Recommendations,response:Response,user=Depends(core.current_user)):
        # Private interests and fresh commercial/presence data never enter the
        # shared public leaderboard cache or intermediary HTTP caches.
        response.headers['Cache-Control']='private, no-store'
        catalog=core.catalog(False)
        return store.run(lambda u:recommendation_read(u,core,body,user,catalog))
    @r.get('/my-weekly-rank')
    def my_weekly_rank(user=Depends(core.current_user)):
        return store.run(lambda u:weekly_ranks(u,user['id']))
    @r.post('/leaderboard')
    def leaderboard(body:Browse):
        if body.strict_nearby and (body.location is None or body.radius_km not in (8,10) or body.allow_buffer):fail('NEARBY_REQUIRED','Choose a location and an 8 or 10 km radius without a buffer.',422)
        def load():
            catalog=core.catalog(False);categories={c['id']:c['name'] for c in catalog['categories']}
            categories.update({'home:'+s['id']:s['name'] for s in OFFERINGS})
            for s in catalog['services']:categories.setdefault(s['category'],s['category'].replace('_',' ').title())
            if body.category and body.category not in categories:fail('INVALID_CATEGORY','Choose a listed category.',422)
            return store.run(lambda u:read(u,catalog,categories))
        def read(u,catalog,categories):
            now=time.time()
            city=next((city for city in core.CITIES if city.casefold()==body.city.casefold()),body.city)
            pool=u.all('workers') if body.strict_nearby else u.find('workers','city',city)
            u.prefetch([('hire_policy','current'),*[('hire_memberships',w['id']) for w in pool],
                        *([] if free_listing() else [('partner_entitlements',w['id']) for w in pool])])
            p=policy(u)
            eligible=[]
            for w in pool:
                m=u.get('hire_memberships',w['id']) or {}
                if w['status']!='approved' or not listing_eligible(u,w['id']) or (not free_listing() and not u.get('partner_entitlements',w['id']) and m.get('policy_version')!=p['version']) or (not body.strict_nearby and w['city'].casefold()!=body.city.casefold()):continue
                if body.role=='contractor' and not w.get('contractor_verified'):continue
                if body.role not in ('all','contractor') and w['role']!=body.role:continue
                if (w.get('experience_years') or 0)<body.min_experience:continue
                origin=w.get('location')
                if body.location:
                    limit=min(body.radius_km,m.get('radius_km',w['radius_km']))*(1+p['radius_buffer_bps']/10000 if body.allow_buffer else 1)
                    if not origin or metres(body.location.model_dump(),origin)>limit*1000:continue
                eligible.append(w)
            worker_ids=[w['id'] for w in eligible]
            u.prefetch([('policies','current'),*[('worker_profiles',wid) for wid in worker_ids],
                        *[('home_availability',wid) for wid in worker_ids]])
            if body.query:
                # Reject impossible text matches before fetching each candidate's
                # historical reviews, jobs and offers. Exact scoring is preserved.
                texts=[]
                for w in eligible:
                    p=u.get('worker_profiles',w['id']) or {}
                    h=u.get('home_availability',w['id']) or {}
                    texts.append(' '.join([text(w['name']),*[text(v) for v in w.get('skills',[])],*[text(v) for v in p.get('specialties',[])],*[categories.get(c,c) for c in w.get('categories',[])],*[categories.get('home:'+c,c) for c in h.get('approved_services',[])]]))
                matches=public_search.scores(texts,body.query,terms,.5) or {}
                eligible=[w for i,w in enumerate(eligible) if i in matches]
                worker_ids=[w['id'] for w in eligible]
            jobs=u.for_workers('jobs',worker_ids,JOB_FIELDS);by_worker=defaultdict(list)
            for j in jobs:by_worker[j.get('worker_id')].append(j)
            by_offer_worker=defaultdict(list)
            for offer in u.for_workers('professional_offers',worker_ids):by_offer_worker[offer['worker_id']].append(offer)
            busy={j.get('worker_id') for j in jobs if j['state'] in ('en_route','travelling','arrived','in_progress','collecting_parts','parts_pending','parts_approved','completion_pending')}
            rows=[]
            for w in eligible:
                m=u.get('hire_memberships',w['id']) or {}
                origin=w.get('location')
                fresh=w.get('position') or {};available=bool(w.get('online') and 0<=now-fresh.get('received_at',0)<=300 and fresh.get('accuracy',1000)<=100 and w['id'] not in busy)
                if body.available_only and not available:continue
                row=profile(u,w,by_worker[w['id']],by_offer_worker[w['id']],include_membership=False,include_network=False);row['available_now']=available
                if body.strict_nearby:row['distance_km']=round(metres(body.location.model_dump(),origin)/1000,1)
                row['service_packages']=[{k:s.get(k) for k in ('id','name','description','price_paise','duration_minutes','included','excluded')} for s in catalog['services'] if s['category'] in row['categories']]
                if body.language and body.language.casefold() not in [v.casefold() for v in row['languages']]:continue
                if body.min_completed>row['completed_tasks'] or (body.min_rating and (row['rating'] or 0)<body.min_rating):continue
                if body.query and relevance(body.query,' '.join([row['name'],*row['skills'],*row['specialties'],*[categories.get(c,c) for c in row['categories']],*[categories.get('home:'+c,c) for c in row['home_services']]]))<.5:continue
                rows.append(row)
            def matches(row,c):return c in row['categories'] or c.startswith('home:') and c[5:] in row['home_services']
            def score(row,c):
                rec=next((v for v in row['category_records'] if v['category']==c),None) if c else None
                n=rec['review_count'] if rec else row['review_count'] if not c else 0
                avg=rec['rating'] if rec else row['rating'] if not c else None
                done=rec['completed'] if rec else row['completed_tasks'] if not c else 0
                return ((avg or 0)*n/(n+5),done,n)
            leaders=[]
            for cid,name in categories.items():
                ranked=sorted([row for row in rows if matches(row,cid) and score(row,cid)[2]],key=lambda row:(*[-v for v in score(row,cid)],row['id']))
                lead=ranked[0] if ranked else None
                leaders.append({'id':cid,'name':name,'count':sum(matches(row,cid) for row in rows),'leader':{k:lead[k] for k in ('id','name','portrait_url','role')} if lead else None})
            selected=[row for row in rows if not body.category or matches(row,body.category)]
            keys={'recommended':lambda x:(*[-v for v in score(x,body.category)],x['id']),'rating':lambda x:(-(next((r['rating'] or 0 for r in x['category_records'] if r['category']==body.category),0) if body.category else x['rating'] or 0),-score(x,body.category)[2],x['id']),'completed':lambda x:(-score(x,body.category)[1],x['id']),'experience':lambda x:(-(x['experience_years'] or 0),*[-v for v in score(x,body.category)],x['id'])}
            selected.sort(key=keys[body.sort]);ranking=sorted([x for x in selected if score(x,body.category)[2]],key=lambda x:(*[-v for v in score(x,body.category)],x['id']));ranks={x['id']:i+1 for i,x in enumerate(ranking)}
            for row in selected:row['rank']=ranks.get(row['id']);row['rank_category']=body.category
            # Ranking reads every eligible candidate, but membership enrollment
            # and richer career sections are bounded to the returned page.
            from repaidians_billing import membership_badge
            visible=selected[:40]
            visible_ids={row['id'] for row in visible}|{c['leader']['id'] for c in leaders if c['leader']}
            u.prefetch([(kind,wid) for wid in visible_ids for kind in ('rp_members','rp_trials','rp_subscriptions','rp_network_profiles')])
            workers={w['id']:w for w in eligible}
            badges={wid:membership_badge(u,wid,worker=workers[wid]) for wid in visible_ids}
            for row in visible:
                row['repaidianBadge']=badges[row['id']]
            for category in leaders:
                if category['leader']:category['leader']['repaidianBadge']=badges[category['leader']['id']]
            return {'professionals':visible,'total':len(selected),'categories':leaders,'scope':'service_area' if body.location else 'city','covered':body.city in core.CITIES,'method':'Rank uses verified completed-work reviews, confidence from review count, then completed work in the selected category. New profiles are unranked. Only approved, active Hire members are listed. City browsing is not an availability promise; a request rechecks current location and schedule.'}
        # Exact city-only browse requests are shared briefly across Cloud Run
        # threads. GPS/availability searches always read current records.
        cache_key=body.model_dump_json() if core.USE_FIRESTORE and not body.location and not body.available_only and not body.strict_nearby else None
        return browse_cache.get_or_load(cache_key,load)
    core.app.include_router(r)
