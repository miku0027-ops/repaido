"""Public Hire leaderboards: consented profiles, genuine outcomes, no contact/location fields."""
import copy,re,threading,time
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from collections import OrderedDict,defaultdict
from concurrent.futures import Future
from typing import Literal
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,Pin,metres,fail
from hiring import listing_eligible,free_listing,policy
from worker_records import public_profile
from home_plans import OFFERINGS
from discovery import relevance

JOB_FIELDS=('worker_id','state','review','service_name','category','service_id','home_plan_id','completed_at')

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

def profile(u,w,jobs,offers=None):
    p=public_profile(u,w,jobs=jobs)
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
            jobs=u.for_workers('jobs',worker_ids,JOB_FIELDS);by_worker=defaultdict(list)
            for j in jobs:by_worker[j.get('worker_id')].append(j)
            by_offer_worker=defaultdict(list)
            for offer in u.for_workers('professional_offers',worker_ids):by_offer_worker[offer['worker_id']].append(offer)
            busy={j.get('worker_id') for j in jobs if j['state'] in ('travelling','arrived','in_progress','parts_pending','parts_approved','completion_pending')}
            rows=[]
            for w in eligible:
                m=u.get('hire_memberships',w['id']) or {}
                origin=w.get('location')
                fresh=w.get('position') or {};available=bool(w.get('online') and 0<=now-fresh.get('received_at',0)<=300 and fresh.get('accuracy',1000)<=100 and w['id'] not in busy)
                if body.available_only and not available:continue
                row=profile(u,w,by_worker[w['id']],by_offer_worker[w['id']]);row['available_now']=available
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
            return {'professionals':selected[:40],'total':len(selected),'categories':leaders,'scope':'service_area' if body.location else 'city','covered':body.city in core.CITIES,'method':'Rank uses verified completed-work reviews, confidence from review count, then completed work in the selected category. New profiles are unranked. Only approved, active Hire members are listed. City browsing is not an availability promise; a request rechecks current location and schedule.'}
        # Exact city-only browse requests are shared briefly across Cloud Run
        # threads. GPS/availability searches always read current records.
        cache_key=body.model_dump_json() if core.USE_FIRESTORE and not body.location and not body.available_only and not body.strict_nearby else None
        return browse_cache.get_or_load(cache_key,load)
    core.app.include_router(r)
