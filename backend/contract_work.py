"""Transactional tender, project and consent-based workforce records. No money movement."""
import base64,hashlib,json,re,time,uuid,unicodedata
from typing import Literal
from fastapi import APIRouter,Depends,Query
from pydantic import Field,model_validator,field_validator
from operations import Input,fail
from integrations import audit

DEFAULT_SECTORS = ('Real estate','Education','Hospitality','Home services','Healthcare','Retail','Office spaces','Manufacturing','Warehousing','Logistics','Construction','Electrical','Plumbing','HVAC','Solar energy','Telecom','Security systems','Landscaping','Water systems','Interior design')

def sector_name(value):
    value=' '.join(unicodedata.normalize('NFKC',value).split())
    if not 2<=len(value)<=80 or any(unicodedata.category(c).startswith('C') or c in '<>' for c in value):
        raise ValueError('Enter a sector name between 2 and 80 characters.')
    return value

def sector_catalog(u):
    names={n.casefold():n for n in DEFAULT_SECTORS}
    sources=[r.get('name','') for r in u.all('business_sectors')]
    sources += [r.get('sector','') for r in u.all('contract_profiles')]
    sources += [r.get('sector','') for r in u.all('contract_tenders')]
    for raw in sources:
        try:name=sector_name(raw)
        except (ValueError,TypeError):continue
        names.setdefault(name.casefold(),name)
    return list(names.values())

def save_sector(u,value,uid):
    name=sector_name(value)
    name=next((n for n in sector_catalog(u) if n.casefold()==name.casefold()),name)
    key=hashlib.sha256(name.casefold().encode()).hexdigest()
    if not u.get('business_sectors',key):
        u.put('business_sectors',key,dict(id=key,name=name,created_by=uid,created_at=time.time()))
    return name

class Create(Input):
    request_id:str=Field(min_length=16,max_length=100)
class Profile(Input):
    sector:str=Field(default='',max_length=80)
    @field_validator('sector')
    @classmethod
    def clean_sector(cls,v):return sector_name(v) if v else v
    name:str=Field(min_length=2,max_length=120)
    city:str=Field(min_length=2,max_length=80)
    scope:str=Field(min_length=10,max_length=2000)
class Project(Create):
    title:str=Field(min_length=3,max_length=150)
    scope:str=Field(min_length=10,max_length=4000)
    site:str=Field(min_length=5,max_length=300)
    starts_at:float
    ends_at:float
    budget_paise:int=Field(ge=0,le=50000000000)
    tender_id:str|None=None
    @model_validator(mode='after')
    def dates(self):
        if self.ends_at<=self.starts_at:raise ValueError('End must follow start.')
        return self
class Tender(Project):
    @field_validator('sector')
    @classmethod
    def clean_sector(cls,v):return sector_name(v)
    sector:str=Field(min_length=2,max_length=80)
    city:str=Field(min_length=2,max_length=80)
    opens_at:float
    deadline:float
    manpower_needed:int=Field(ge=1,le=500)
    terms:str=Field(min_length=20,max_length=6000)
    @model_validator(mode='after')
    def windows(self):
        if not self.opens_at<self.deadline<=self.starts_at:raise ValueError('Bidding must close before project work starts.')
        return self
class Bid(Create):
    expected_version:int=Field(ge=1)
    project_id:str
    amount_paise:int=Field(gt=0,le=50000000000)
    proposal:str=Field(min_length=20,max_length=6000)
    accepted_terms:Literal[True]
class TenderCommand(Input):
    expected_version:int=Field(ge=1)
    action:Literal['register','unregister','withdraw','award','close']
    bid_id:str|None=None
class Invite(Input):
    expected_version:int=Field(ge=1)
    worker_id:str
    role:Literal['supervisor','member']
    reports_to:str|None=None
    daily_rate_paise:int=Field(ge=0,le=10000000)
    terms:str=Field(min_length=20,max_length=2000)
class Command(Input):
    expected_version:int=Field(ge=1)
    action:Literal['accept','decline','leave_team','remove','start','pause','resume','complete','cancel','goal_add','goal_submit','goal_approve','goal_reopen','check_in','check_out','leave_request','leave_approve','leave_decline']
    target_id:str|None=None
    title:str=Field(default='',max_length=150)
    note:str=Field(default='',max_length=2000)
    assignee_id:str|None=None
    due_at:float|None=None
    starts_at:float|None=None
    ends_at:float|None=None


class HiringNotice(Input):
    expected_version:int=Field(ge=1)
    status:Literal['open','paused','closed']
    city:str=Field(min_length=2,max_length=80)
    area:str=Field(min_length=2,max_length=120)
    sector:str=Field(min_length=2,max_length=80)
    summary:str=Field(min_length=20,max_length=3000)
    skills:list[str]=Field(min_length=1,max_length=20)
    worker_role:Literal['any','technician','specialist']='any'
    openings:int=Field(ge=1,le=500)
    minimum_experience:int=Field(ge=0,le=60,default=0)
    daily_rate_paise:int=Field(gt=0,le=10000000)
    hours_per_day:int=Field(ge=1,le=12)
    deadline:float
    terms:str=Field(min_length=20,max_length=2000)
    benefits:str=Field(default='',max_length=1000)
    @field_validator('skills')
    @classmethod
    def clean_skills(cls,values):
        cleaned=list(dict.fromkeys(v.strip() for v in values))
        if any(not 2<=len(v)<=80 for v in cleaned):raise ValueError('Each skill must be 2–80 characters.')
        return cleaned
class JoinApplication(Input):
    hiring_version:int=Field(ge=1)
    note:str=Field(min_length=20,max_length=2000)
    available:Literal[True]
class ApplicationDecision(Input):
    expected_version:int=Field(ge=1)
    project_version:int=Field(ge=1)
    action:Literal['shortlist','reject','offer']
    note:str=Field(default='',max_length=1000)
    role:Literal['member','supervisor']='member'
    daily_rate_paise:int|None=Field(default=None,gt=0,le=10000000)
    terms:str=Field(default='',max_length=2000)

def public_hiring(p):
    h=p.get('hiring')
    if not h:return None
    team=[m for m in p['team'] if m['status']=='accepted']
    return dict(id=p['id'],title=p['title'],contractor_id=p['owner_id'],contractor_name=p['owner_name'],status=p['status'],
        starts_at=p['starts_at'],ends_at=p['ends_at'],preparing_tender=bool(p.get('tender_id') and not p.get('awarded_at')),
        hiring={k:v for k,v in h.items() if k not in ('updated_by',)},
        progress=dict(approved=sum(g['status']=='approved' for g in p['goals']),total=len(p['goals'])),
        team=dict(total=len(team),supervisors=sum(m['role']=='supervisor' for m in team),members=sum(m['role']=='member' for m in team)))

PUBLIC_TENDER_FIELDS=('id','title','sector','city','budget_paise','manpower_needed','opens_at','deadline','starts_at','ends_at','status')
PUBLIC_TENDER_SCAN=64


def initialize(core):
    if core.USE_FIRESTORE and core.fb_db:return
    with core.db() as conn:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_contract_tenders_public_status_key ON operation_records(json_extract(body,'$.status'),id) WHERE kind='contract_tenders'")


def public_tender(t,now):
    if t.get('status')!='open' or t['ends_at']<=now:return None
    stage='upcoming' if now<t['opens_at'] else 'bidding' if now<t['deadline'] else 'decision'
    fields=('id','title','sector','city','budget_paise','manpower_needed','opens_at','deadline','starts_at','ends_at')
    return {**{key:t[key] for key in fields},'status':t['status'],'phase':stage}


def published_keyset(u,after='',limit=PUBLIC_TENDER_SCAN):
    """Read only bounded open summaries, projecting before private payloads leave storage."""
    limit=min(PUBLIC_TENDER_SCAN,max(1,limit))
    if u.tx is not None:
        from google.cloud.firestore_v1.field_path import FieldPath
        query=u.core.fs_collection('ops_contract_tenders').where('status','==','open')
        query=query.select(PUBLIC_TENDER_FIELDS).order_by(FieldPath.document_id()).limit(limit)
        if after:
            query=query.start_after({FieldPath.document_id():u.core.fs_doc('ops_contract_tenders',after)})
        return [(snapshot.id,{**snapshot.to_dict(),'id':snapshot.id}) for snapshot in query.stream(transaction=u.tx)]
    columns=','.join(f"json_extract(body,'$.{field}') AS {field}" for field in PUBLIC_TENDER_FIELDS if field!='id')
    rows=u.conn.execute(f"SELECT id,{columns} FROM operation_records WHERE kind='contract_tenders' AND id>? AND json_extract(body,'$.status')=? ORDER BY id LIMIT ?",(after,'open',limit))
    return [(row['id'],dict(row)) for row in rows]


def published_record(u,tid):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',tid):return None
    if u.tx is not None:
        snapshot=u.core.fs_doc('ops_contract_tenders',tid).get(field_paths=PUBLIC_TENDER_FIELDS,transaction=u.tx)
        return {**snapshot.to_dict(),'id':snapshot.id} if snapshot.exists else None
    columns=','.join(f"json_extract(body,'$.{field}') AS {field}" for field in PUBLIC_TENDER_FIELDS if field!='id')
    row=u.conn.execute(f"SELECT id,{columns} FROM operation_records WHERE kind=? AND id=?",('contract_tenders',tid)).fetchone()
    return dict(row) if row else None


def published_cursor(cursor,filters):
    binding=hashlib.sha256(json.dumps(filters,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if not cursor:return '',binding
    try:
        decoded=base64.b64decode(cursor+'='*(-len(cursor)%4),altchars=b'-_',validate=True)
        token=json.loads(decoded)
        if token.get('v')!=1 or token.get('f')!=binding or not isinstance(token.get('k'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',token['k']):raise ValueError()
        return token['k'],binding
    except Exception:fail('CURSOR','Refresh these opportunities to continue with the selected filters.',422)


def published_next_cursor(key,binding):
    return base64.urlsafe_b64encode(json.dumps({'v':1,'k':key,'f':binding},separators=(',',':')).encode()).decode().rstrip('=')

def identifier(prefix,user,request):return prefix+'-'+hashlib.sha256((user+':'+request).encode()).hexdigest()[:32]
def same_create(old,body):
    digest=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True).encode()).hexdigest()
    if old and old.get('request_hash')!=digest:fail('REQUEST_REUSED','Use a new request for changed details.',409)
    return digest

def install(core):
    r=APIRouter(prefix='/operations/contractor');store=core.operations_store
    def phone(user):
        if not user.get('phone_verified'):fail('PHONE_REQUIRED','Verify your mobile number first.',403)
    def contractor(u,user):
        phone(user);w=u.get('workers',user['id']) or {}
        if w.get('status')!='approved' or not w.get('contractor_verified'):fail('CONTRACTOR_REVIEW','Complete contractor approval in your partner profile before creating projects or bidding.',403)
    def active_worker(u,wid):
        w=u.get('workers',wid)
        if not w or w.get('status')!='approved':fail('WORKER_UNAVAILABLE','Choose an approved Repaido agent.',409)
        return w
    def get(u,kind,key):
        row=u.get(kind,key)
        if not row:fail('NOT_FOUND','Record not found.',404)
        return row
    def version(row,v):
        if row['version']!=v:fail('STALE_VERSION','This record changed. Refresh and retry.',409)
    def member(p,uid):return next((m for m in p['team'] if m['worker_id']==uid and m['status']=='accepted'),None)
    def access(p,uid):
        if p['owner_id']!=uid and not any(m['worker_id']==uid for m in p['team']):fail('FORBIDDEN','This project is private.',403)
    def manager(p,uid):return p['owner_id']==uid or (member(p,uid) or {}).get('role')=='supervisor'
    def notify(u,uid,title,body):
        key=str(uuid.uuid4());u.put('notifications',key,dict(id=key,user_id=uid,title=title,body=body,destination='contractor',created_at=time.time()))
    def event(u,p,user,action,note=''):
        p['version']+=1;p['updated_at']=time.time();p['events'].append(dict(id=str(uuid.uuid4()),action=action,actor=user['id'],at=time.time(),note=note))
        audit(u,'ContractWorkChanged',user['id'],record_id=p['id'],command=action,version=p['version'])
    def free(u,worker,p):
        from home_plans import conflict
        if conflict(u,worker,p['starts_at'],(p['ends_at']-p['starts_at'])/60,exclude_contract=p['id']):fail('SCHEDULE_CONFLICT','An accepted project, home plan or booked service overlaps these dates.',409)
        for other in u.all('contract_projects'):
            if other['id']==p['id'] or other['status'] in ('completed','cancelled'):continue
            if member(other,worker) and p['starts_at']<other['ends_at'] and other['starts_at']<p['ends_at']:fail('SCHEDULE_CONFLICT','This agent has already accepted overlapping project dates.',409)
        for job in u.all('jobs'):
            if job.get('worker_id')!=worker or job.get('state') in ('completed','cancelled'):continue
            start=job.get('starts_epoch')
            if not start:fail('ACTIVE_TASK','Resolve the agent’s existing task schedule before accepting project work.',409)
            duration=job.get('duration_minutes') or job.get('service_duration_minutes') or 120
            if start<p['ends_at'] and start+duration*60>p['starts_at']:fail('SCHEDULE_CONFLICT','A booked service overlaps these project dates.',409)
    def tender_view(t,uid):
        d={**t};d['registrations_count']=len(t['registrations']);d['registered']=uid in t['registrations'];d.pop('registrations');d['bids_count']=sum(b['status']=='submitted' for b in t['bids']);d['bids']=[b for b in t['bids'] if uid==t['owner_id'] or uid==b['contractor_id']];return d
    def project_view(p,uid):
        if p['owner_id']==uid:return p
        mine=member(p,uid)
        if not mine:
            return {**{k:p[k] for k in ('id','title','scope','site','starts_at','ends_at','status','version','owner_id','owner_name','tender_id')},'team':[m for m in p['team'] if m['worker_id']==uid],'goals':[],'attendance':[],'leave':[],'events':[]}
        return {**p,'budget_paise':None,'team':[{**m,'daily_rate_paise':m['daily_rate_paise'] if m['worker_id']==uid else None,'terms':m['terms'] if m['worker_id']==uid else ''} for m in p['team']],'attendance':[a for a in p['attendance'] if a['worker_id']==uid or mine['role']=='supervisor'],'leave':[a for a in p['leave'] if a['worker_id']==uid or mine['role']=='supervisor']}
    @r.get('/sectors')
    def sectors():
        return store.run(lambda u:dict(sectors=sector_catalog(u)))
    @r.get('/overview')
    def overview():
        def execute(u):
            projects={p['id']:p for p in u.all('contract_projects')}
            contracts=[];scores={}
            for t in u.all('contract_tenders'):
                p=projects.get(t.get('winning_project_id'))
                if t.get('status')!='awarded' or not p:continue
                contracts.append(dict(id=t['id'],title=t['title'],sector=t['sector'],city=t['city'],status=p['status']))
                if p['status']=='completed':scores[p['owner_id']]=scores.get(p['owner_id'],0)+1
            leaders=[]
            for uid,count in scores.items():
                w=u.get('workers',uid) or {}
                if w.get('status')=='approved' and w.get('contractor_verified'):
                    leaders.append(dict(id=uid,name=w.get('name','Contractor'),city=w.get('city',''),completed=count))
            leaders.sort(key=lambda x:(-x['completed'],x['id']))
            return dict(contracts=contracts,leaders=leaders[:10])
        return store.run(execute)
    @r.get('/opportunities')
    def opportunities(user=Depends(core.current_user)):
        def execute(u):
            contractor(u,user)
            return dict(server_time=time.time(),tenders=[{k:v for k,v in tender_view(t,user['id']).items() if k not in ('request_hash','events','owner_id')} for t in u.all('contract_tenders')])
        return store.run(execute)
    @r.get('/published')
    def published(sector:str=Query(default='',max_length=80),query:str=Query(default='',max_length=120),
                  phase:Literal['all','upcoming','bidding','decision']='all',
                  cursor:str=Query(default='',max_length=1024),limit:int=Query(default=24,ge=1,le=PUBLIC_TENDER_SCAN)):
        """Public discovery is a summary, never a private tender/workspace projection."""
        selected_sector=unicodedata.normalize('NFKC',sector).strip().casefold()
        needle=unicodedata.normalize('NFKC',query).strip().casefold()
        after,binding=published_cursor(cursor,dict(sector=selected_sector,query=needle,phase=phase))
        def execute(u):
            now=time.time();rows=published_keyset(u,after);items=[];consumed=0;last=after
            for key,t in rows:
                consumed+=1;last=key
                summary=public_tender(t,now)
                if not summary:continue
                if selected_sector and unicodedata.normalize('NFKC',summary['sector']).casefold()!=selected_sector:continue
                if phase!='all' and phase!=summary['phase']:continue
                haystack=' '.join(str(summary[k]) for k in ('title','city','sector'))
                if needle and needle not in unicodedata.normalize('NFKC',haystack).casefold():continue
                items.append(summary)
                if len(items)>=limit:break
            has_more=consumed<len(rows) or len(rows)==PUBLIC_TENDER_SCAN
            return dict(server_time=now,total=None,has_more=has_more,next_cursor=published_next_cursor(last,binding) if has_more else None,tenders=items)
        return store.run(execute)
    @r.get('/published/{tid}')
    def published_summary(tid:str):
        def execute(u):
            now=time.time();record=published_record(u,tid);row=public_tender(record,now) if record else None
            if not row:fail('NOT_FOUND','This opportunity is no longer published.',404)
            return dict(server_time=now,tender=row)
        return store.run(execute)
    @r.get('/workspace')
    def workspace(user=Depends(core.current_user)):
        phone(user)
        def execute(u):
            uid=user['id'];w=u.get('workers',uid) or {};return dict(server_time=time.time(),user_id=uid,can_contract=w.get('status')=='approved' and bool(w.get('contractor_verified')),profile=u.get('contract_profiles',uid),projects=[project_view(p,uid) for p in u.all('contract_projects') if p['owner_id']==uid or any(m['worker_id']==uid for m in p['team'])],tenders=[tender_view(t,uid) for t in u.all('contract_tenders') if (w.get('status')=='approved' and w.get('contractor_verified')) or t['owner_id']==uid])
        return store.run(execute)
    @r.put('/profile')
    def profile(body:Profile,user=Depends(core.current_user)):
        phone(user)
        def execute(u):
            row=dict(**body.model_dump(),id=user['id'])
            if 'sector' not in body.model_fields_set:row['sector']=(u.get('contract_profiles',user['id']) or {}).get('sector','')
            if row['sector']:row['sector']=save_sector(u,row['sector'],user['id'])
            u.put('contract_profiles',user['id'],row);return row
        return store.run(execute)
    @r.get('/agents')
    def agents(user=Depends(core.current_user)):
        def execute(u):
            contractor(u,user);return dict(agents=[{k:w.get(k) for k in ('id','name','city','role','skills','categories','profile_photo_url')} for w in u.all('workers') if w.get('status')=='approved' and w['id']!=user['id']])
        return store.run(execute)
    @r.post('/projects')
    def create_project(body:Project,user=Depends(core.current_user)):
        def execute(u):
            contractor(u,user);key=identifier('project',user['id'],body.request_id);old=u.get('contract_projects',key);digest=same_create(old,body)
            if old:return old
            if body.ends_at<=time.time():fail('DATES','Choose future work dates.',422)
            if body.tender_id:
                t=get(u,'contract_tenders',body.tender_id)
                if t['status']!='open' or t['deadline']<=time.time():fail('CLOSED','This tender is closed.',409)
                if body.starts_at!=t['starts_at'] or body.ends_at!=t['ends_at']:fail('DATES','Use the tender work dates for its team plan.',422)
            p=dict(**body.model_dump(exclude={'request_id'}),id=key,request_hash=digest,owner_id=user['id'],owner_name=(u.get('contract_profiles',user['id']) or {}).get('name',user['name']),status='planning',team=[],goals=[],attendance=[],leave=[],events=[],version=1,created_at=time.time())
            u.put('contract_projects',key,p);audit(u,'ContractProjectCreated',user['id'],project_id=key);return p
        return store.run(execute)
    @r.post('/tenders')
    def create_tender(body:Tender,user=Depends(core.current_user)):
        phone(user)
        def execute(u):
            key=identifier('tender',user['id'],body.request_id);old=u.get('contract_tenders',key);digest=same_create(old,body)
            if old:return tender_view(old,user['id'])
            if body.deadline<=time.time():fail('DATES','Bidding deadline must be in the future.',422)
            if body.tender_id:fail('INVALID','A tender cannot link to another tender.',422)
            t=dict(**body.model_dump(exclude={'request_id','tender_id'}),id=key,request_hash=digest,owner_id=user['id'],owner_name=(u.get('contract_profiles',user['id']) or {}).get('name',user['name']),status='open',bids=[],registrations=[],events=[],version=1,created_at=time.time())
            t['sector']=save_sector(u,t['sector'],user['id'])
            u.put('contract_tenders',key,t);return tender_view(t,user['id'])
        return store.run(execute)
    @r.post('/tenders/{tid}/bid')
    def bid(tid:str,body:Bid,user=Depends(core.current_user)):
        def execute(u):
            contractor(u,user);t=get(u,'contract_tenders',tid);uid=user['id'];key=identifier('bid',uid,body.request_id);old=next((b for b in t['bids'] if b['id']==key),None);digest=same_create(old,body)
            if old:return tender_view(t,uid)
            version(t,body.expected_version)
            if t['owner_id']==uid:fail('SELF_BID','You cannot bid on your own tender.',403)
            if t['status']!='open' or not t['opens_at']<=time.time()<t['deadline']:fail('CLOSED','Bidding is not open.',409)
            p=get(u,'contract_projects',body.project_id)
            if p['owner_id']!=uid or p['tender_id']!=tid or p['status']!='planning':fail('TEAM_REQUIRED','Choose your team plan for this tender.',422)
            crew=[m for m in p['team'] if m['status']=='accepted']
            if len(crew)<t['manpower_needed']:fail('TEAM_REQUIRED','The required number of agents must accept their invitations before bidding.',409)
            for m in crew:active_worker(u,m['worker_id']);free(u,m['worker_id'],p)
            for b in t['bids']:
                if b['contractor_id']==uid and b['status']=='submitted':b['status']='superseded'
            t['bids'].append(dict(id=key,request_hash=digest,contractor_id=uid,contractor_name=p['owner_name'],project_id=p['id'],amount_paise=body.amount_paise,proposal=body.proposal,team_size=len(crew),status='submitted',terms_snapshot=t['terms'],submitted_at=time.time()))
            event(u,t,user,'bid_submitted');u.put('contract_tenders',tid,t);notify(u,t['owner_id'],'New tender bid',t['title']);return tender_view(t,uid)
        return store.run(execute)
    @r.post('/tenders/{tid}/commands')
    def tender_command(tid:str,body:TenderCommand,user=Depends(core.current_user)):
        phone(user)
        def execute(u):
            t=get(u,'contract_tenders',tid);version(t,body.expected_version);uid=user['id'];action=body.action
            if action in ('register','unregister'):
                contractor(u,user)
                if t['status']!='open' or time.time()>=t['deadline']:fail('CLOSED','Tender is closed.',409)
                t['registrations']=[x for x in t['registrations'] if x!=uid]
                if action=='register':t['registrations'].append(uid)
            elif action=='withdraw':
                b=next((x for x in t['bids'] if x['id']==body.bid_id and x['contractor_id']==uid),None)
                if not b or b['status']!='submitted' or t['status']!='open':fail('INVALID_BID','Only your pending bid can be withdrawn.',409)
                b['status']='withdrawn'
            else:
                if t['owner_id']!=uid:fail('FORBIDDEN','Only the tender owner can decide bids.',403)
                if t['status']!='open':fail('CLOSED','Tender already decided.',409)
                if action=='close':t['status']='closed'
                else:
                    if time.time()<t['deadline']:fail('WINDOW_OPEN','Wait until the bidding deadline to award this tender.',409)
                    b=next((x for x in t['bids'] if x['id']==body.bid_id and x['status']=='submitted'),None)
                    if not b:fail('INVALID_BID','Choose a submitted bid.',422)
                    p=get(u,'contract_projects',b['project_id']);crew=[m for m in p['team'] if m['status']=='accepted'];contractor(u,dict(id=b['contractor_id'],phone_verified=True))
                    if p['status']!='planning' or len(crew)<t['manpower_needed']:fail('TEAM_REQUIRED','The bidder must reconfirm the required team.',409)
                    for m in crew:active_worker(u,m['worker_id']);free(u,m['worker_id'],p)
                    b['status']='awarded';t.update(status='awarded',winning_bid_id=b['id'],winning_project_id=p['id']);p.update(awarded_at=time.time(),contract_value_paise=b['amount_paise'],client_id=uid)
                    event(u,p,user,'contract_awarded');u.put('contract_projects',p['id'],p);notify(u,p['owner_id'],'Tender awarded',t['title'])
            event(u,t,user,action);u.put('contract_tenders',tid,t);return tender_view(t,uid)
        return store.run(execute)
    def add_invitation(u,pid,body,user):
        contractor(u,user);p=get(u,'contract_projects',pid);version(p,body.expected_version)
        if p['owner_id']!=user['id']:fail('FORBIDDEN','Only the contractor can invite or set reporting roles.',403)
        if p['status'] in ('completed','cancelled') or p['ends_at']<=time.time():fail('CLOSED','Project is closed.',409)
        if body.worker_id==user['id']:fail('SELF_INVITE','Choose another agent.',422)
        w=active_worker(u,body.worker_id)
        if any(m['worker_id']==body.worker_id and m['status'] in ('pending','accepted') for m in p['team']):fail('DUPLICATE','This agent is already invited or on the team.',409)
        if body.reports_to and not any(m['worker_id']==body.reports_to and m['status']=='accepted' and m['role']=='supervisor' for m in p['team']):fail('HIERARCHY','Choose an accepted supervisor.',422)
        free(u,body.worker_id,p)
        m=dict(**body.model_dump(exclude={'expected_version'}),id=str(uuid.uuid4()),name=w['name'],status='pending',invited_at=time.time());p['team'].append(m)
        event(u,p,user,'agent_invited',w['name']);u.put('contract_projects',pid,p);notify(u,body.worker_id,'Project team invitation',p['title']);return p
    @r.post('/projects/{pid}/invitations')
    def invite(pid:str,body:Invite,user=Depends(core.current_user)):
        return store.run(lambda u:add_invitation(u,pid,body,user))

    @r.put('/projects/{pid}/hiring')
    def hiring_notice(pid:str,body:HiringNotice,user=Depends(core.current_user)):
        def save(u):
            contractor(u,user);p=get(u,'contract_projects',pid)
            if p['owner_id']!=user['id']:fail('FORBIDDEN','Only the project owner can manage hiring.',403)
            version(p,body.expected_version)
            if p['status'] in ('completed','cancelled') or p['ends_at']<=time.time():fail('CLOSED','This project has ended.',409)
            if body.status=='open' and not time.time()<body.deadline<=p['ends_at']:fail('DEADLINE','Set a future application deadline within the project dates.',422)
            h={**body.model_dump(exclude={'expected_version'}),'version':(p.get('hiring') or {}).get('version',0)+1,'updated_at':time.time()}
            h['sector']=save_sector(u,h['sector'],user['id']);p['hiring']=h
            event(u,p,user,'hiring_'+body.status);u.put('contract_projects',pid,p);return p
        return store.run(save)
    @r.post('/projects/{pid}/apply')
    def apply_for_project(pid:str,body:JoinApplication,user=Depends(core.current_user)):
        def save(u):
            from worker_network import network_worker, blocked, throttle
            w=network_worker(u,user);p=get(u,'contract_projects',pid);h=p.get('hiring') or {};uid=user['id']
            if uid==p['owner_id'] or blocked(u,uid,p['owner_id']):fail('UNAVAILABLE','This application is unavailable.',403)
            owner=active_worker(u,p['owner_id'])
            if not owner.get('contractor_verified'):fail('UNAVAILABLE','Contractor approval is unavailable.',409)
            if h.get('status')!='open' or h.get('deadline',0)<=time.time() or p['status'] in ('completed','cancelled') or p['ends_at']<=time.time():fail('CLOSED','Hiring is not open for this project.',409)
            if h['version']!=body.hiring_version:fail('TERMS_CHANGED','Hiring details changed. Read the updated notice before applying.',409)
            if h['worker_role']!='any' and h['worker_role']!=w['role']:fail('ROLE_REQUIRED','This notice requires a different approved work role.',409)
            if (w.get('experience_years') or 0)<h['minimum_experience']:fail('EXPERIENCE_REQUIRED','This notice requires more recorded experience.',409)
            if any(m['worker_id']==uid and m['status'] in ('accepted','pending') for m in p['team']):fail('ALREADY_TEAM','An invitation or team placement already exists.',409)
            free(u,uid,p)
            key=identifier('application',uid,pid);old=u.get('project_applications',key)
            if old and old['status'] not in ('withdrawn','rejected'):return old
            if old and old['status']=='rejected':fail('REVIEWED','This application was reviewed. Contact the contractor through a connection for future openings.',409)
            throttle(u,uid,'application',20,86400)
            row=dict(id=key,project_id=pid,worker_id=uid,worker_name=w['name'],owner_id=p['owner_id'],note=body.note,notice_snapshot=h,starts_at=p['starts_at'],ends_at=p['ends_at'],status='applied',version=(old or {}).get('version',0)+1,created_at=time.time(),updated_at=time.time(),events=[dict(status='applied',at=time.time())])
            u.put('project_applications',key,row);notify(u,p['owner_id'],'New joining request',p['title']);return row
        return store.run(save)
    @r.get('/hiring/applications')
    def hiring_applications(user=Depends(core.current_user)):
        def read(u):
            from worker_network import network_worker, person_card
            network_worker(u,user);uid=user['id'];rows=[]
            for a in u.all('project_applications'):
                if uid not in (a['owner_id'],a['worker_id']):continue
                p=u.get('contract_projects',a['project_id'])
                if not p:continue
                inv=next((m for m in p['team'] if m.get('id')==a.get('invitation_id')),None)
                rows.append({**a,'project_title':p['title'],'project_version':p['version'],'invitation_status':inv.get('status') if inv else None,'applicant':person_card(u,u.get('workers',a['worker_id']) or {})})
            return dict(applications=sorted(rows,key=lambda a:a['updated_at'],reverse=True))
        return store.run(read)
    @r.post('/hiring/applications/{aid}/withdraw')
    def withdraw_application(aid:str,user=Depends(core.current_user)):
        def save(u):
            phone(user);a=get(u,'project_applications',aid)
            if a['worker_id']!=user['id']:fail('NOT_FOUND','Application unavailable.',404)
            if a['status'] not in ('applied','shortlisted'):fail('STATE','Respond to an existing offer from Project teams.',409)
            a.update(status='withdrawn',version=a['version']+1,updated_at=time.time());a['events'].append(dict(status='withdrawn',at=time.time()));u.put('project_applications',aid,a);return a
        return store.run(save)
    @r.post('/hiring/applications/{aid}/decision')
    def decide_application(aid:str,body:ApplicationDecision,user=Depends(core.current_user)):
        def save(u):
            from worker_network import blocked
            contractor(u,user);a=get(u,'project_applications',aid);p=get(u,'contract_projects',a['project_id'])
            if p['owner_id']!=user['id']:fail('FORBIDDEN','Only the project owner can review applicants.',403)
            version(a,body.expected_version);version(p,body.project_version)
            if a['status'] not in ('applied','shortlisted'):fail('STATE','This application is no longer pending.',409)
            if body.action=='offer':
                h=p.get('hiring') or {}
                if h.get('status')!='open':fail('HIRING_CLOSED','Reopen hiring before making an offer.',409)
                if blocked(u,user['id'],a['worker_id']):fail('UNAVAILABLE','This connection is blocked.',403)
                candidate=active_worker(u,a['worker_id'])
                if (u.get('network_suspensions',a['worker_id']) or {}).get('active'):fail('UNAVAILABLE','This candidate is under network review.',409)
                if (h['worker_role']!='any' and candidate['role']!=h['worker_role']) or candidate.get('experience_years',0)<h['minimum_experience']:fail('REQUIREMENTS_CHANGED','The candidate no longer meets this notice. Review the current requirements.',409)
                if sum(m['status'] in ('accepted','pending') for m in p['team'])>=h.get('openings',0):fail('TEAM_FULL','All advertised places are filled or offered. Update openings first.',409)
                if not body.daily_rate_paise or len(body.terms.strip())<20:fail('TERMS','Set the offered daily rate and full joining terms.',422)
                p=add_invitation(u,p['id'],Invite(expected_version=p['version'],worker_id=a['worker_id'],role=body.role,daily_rate_paise=body.daily_rate_paise,terms=body.terms),user)
                a['invitation_id']=p['team'][-1]['id']
            elif body.action=='reject' and len(body.note.strip())<5:fail('REASON','Give the candidate a short decision reason.',422)
            a.update(status={'offer':'offered','shortlist':'shortlisted','reject':'rejected'}[body.action],decision_note=body.note,version=a['version']+1,updated_at=time.time())
            a['events'].append(dict(status=a['status'],at=time.time()));u.put('project_applications',aid,a);notify(u,a['worker_id'],'Application '+a['status'],p['title']);return a
        return store.run(save)
    @r.post('/projects/{pid}/commands')
    def command(pid:str,body:Command,user=Depends(core.current_user)):
        phone(user)
        def execute(u):
            p=get(u,'contract_projects',pid);uid=user['id'];access(p,uid);version(p,body.expected_version);a=body.action;own=p['owner_id']==uid;manage=manager(p,uid);m=member(p,uid);now=time.time()
            if p['status'] in ('completed','cancelled'):fail('CLOSED','This project is read-only.',409)
            if a in ('accept','decline'):
                inv=next((x for x in p['team'] if x['id']==body.target_id and x['worker_id']==uid and x['status']=='pending'),None)
                if not inv:fail('INVITATION','This invitation is no longer pending.',409)
                if a=='accept':
                    active_worker(u,uid);free(u,uid,p)
                    if p['ends_at']<=now:fail('DATES','Invitation dates have passed.',409)
                    if inv['reports_to'] and not member(p,inv['reports_to']):fail('HIERARCHY','The supervisor has left. Ask for a new invitation.',409)
                inv.update(status='accepted' if a=='accept' else 'declined',responded_at=now);notify(u,p['owner_id'],'Team invitation '+a,p['title'])
            elif a in ('leave_team','remove'):
                target=body.target_id if a=='remove' else uid
                if a=='remove' and not own:fail('FORBIDDEN','Only the contractor can remove members.',403)
                row=next((x for x in p['team'] if x['worker_id']==target and x['status'] in ('pending','accepted')),None)
                if not row:fail('MEMBER','Member not active.',409)
                row['status']='removed' if a=='remove' else 'left'
                for child in p['team']:
                    if child.get('reports_to')==target:child['reports_to']=None
                for att in p['attendance']:
                    if att['worker_id']==target and not att.get('out_at'):att.update(out_at=now,closure_reason=a)
            elif a in ('start','pause','resume','complete','cancel'):
                if not own:fail('FORBIDDEN','Only the contractor can change contract status.',403)
                transitions={'start':('planning','active'),'pause':('active','paused'),'resume':('paused','active'),'complete':('active','completed')}
                if a=='cancel':p['status']='cancelled'
                else:
                    before,after=transitions[a]
                    if p['status']!=before:fail('STATE','Action does not match the current project stage.',409)
                    if a=='start':
                        if p['tender_id'] and not p.get('awarded_at'):fail('AWARD_REQUIRED','This tender has not been awarded to you.',409)
                        if now<p['starts_at'] or now>=p['ends_at']:fail('DATES','Start within the agreed work dates.',409)
                    if a=='complete' and (not p['goals'] or any(g['status']!='approved' for g in p['goals'])):fail('GOALS','Approve all project goals before completing.',409)
                    p['status']=after
                if p['status'] in ('completed','cancelled','paused'):
                    for att in p['attendance']:
                        if not att.get('out_at'):att.update(out_at=now,closure_reason=a)
            elif a=='goal_add':
                if not manage:fail('FORBIDDEN','A contractor or supervisor must create goals.',403)
                if len(body.title.strip())<3 or not body.due_at or not p['starts_at']<=body.due_at<=p['ends_at']:fail('GOAL','Add a title and a due date within the project.',422)
                if body.assignee_id and not member(p,body.assignee_id):fail('ASSIGNEE','Assign an accepted team member.',422)
                p['goals'].append(dict(id=str(uuid.uuid4()),title=body.title,note=body.note,assignee_id=body.assignee_id,due_at=body.due_at,status='planned',evidence=''))
            elif a in ('goal_submit','goal_approve','goal_reopen'):
                g=next((g for g in p['goals'] if g['id']==body.target_id),None)
                if not g:fail('GOAL','Goal not found.',404)
                if a=='goal_submit':
                    if not manage and (not m or g['assignee_id']!=uid):fail('FORBIDDEN','Only the assignee or supervisor can submit progress.',403)
                    if len(body.note.strip())<10:fail('EVIDENCE','Describe the work and evidence reference.',422)
                    if g['status'] not in ('planned','reopened'):fail('STATE','This goal is already submitted.',409)
                    g.update(status='submitted',evidence=body.note,submitted_by=uid,submitted_at=now)
                else:
                    if not own:fail('FORBIDDEN','Only the contractor can approve or reopen goals.',403)
                    if a=='goal_approve' and g['status']!='submitted':fail('STATE','Submit work evidence first.',409)
                    g.update(status='approved' if a=='goal_approve' else 'reopened',review_note=body.note,reviewed_at=now)
            elif a in ('check_in','check_out'):
                if not m:fail('MEMBER','Only accepted agents can record their own attendance.',403)
                opened=next((x for x in p['attendance'] if x['worker_id']==uid and not x.get('out_at')),None)
                if a=='check_in':
                    if p['status']!='active' or not p['starts_at']<=now<=p['ends_at']:fail('DATES','Check in during active project dates.',409)
                    if opened:fail('ATTENDANCE','Already checked in.',409)
                    if any(l['worker_id']==uid and l['status']=='approved' and l['starts_at']<=now<l['ends_at'] for l in p['leave']):fail('LEAVE','You are on approved leave.',409)
                    p['attendance'].append(dict(id=str(uuid.uuid4()),worker_id=uid,in_at=now,out_at=None,source='agent_reported'))
                else:
                    if not opened:fail('ATTENDANCE','No open attendance record.',409)
                    opened['out_at']=now
            elif a=='leave_request':
                if not m:fail('MEMBER','Only accepted agents can request leave.',403)
                if not body.starts_at or not body.ends_at or not p['starts_at']<=body.starts_at<body.ends_at<=p['ends_at'] or body.ends_at<=now or len(body.note.strip())<5:fail('LEAVE','Add future leave dates within the project and a reason.',422)
                if any(l['worker_id']==uid and l['status'] in ('pending','approved') and l['starts_at']<body.ends_at and body.starts_at<l['ends_at'] for l in p['leave']):fail('LEAVE','An overlapping leave request already exists.',409)
                p['leave'].append(dict(id=str(uuid.uuid4()),worker_id=uid,starts_at=body.starts_at,ends_at=body.ends_at,note=body.note,status='pending'));notify(u,p['owner_id'],'Leave request',p['title'])
            elif a in ('leave_approve','leave_decline'):
                if not own:fail('FORBIDDEN','Only the contractor can decide leave.',403)
                l=next((l for l in p['leave'] if l['id']==body.target_id),None)
                if not l or l['status']!='pending':fail('LEAVE','Leave request already decided or missing.',409)
                l.update(status='approved' if a=='leave_approve' else 'declined',decided_at=now)
                notify(u,l['worker_id'],'Leave '+l['status'],p['title'])
            event(u,p,user,a,body.note);u.put('contract_projects',pid,p);return project_view(p,uid)
        return store.run(execute)
    core.app.include_router(r)
