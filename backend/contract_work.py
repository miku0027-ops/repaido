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
def worker_type_name(value):
    value='_'.join(unicodedata.normalize('NFKC',value).casefold().split())
    if not re.fullmatch(r'[a-z][a-z0-9_]{1,59}',value):raise ValueError('Use a worker type such as mistri, rajmistri, labour, wiring or cleaning.')
    return value
class WorkforceRequirement(Input):
    worker_type:str=Field(min_length=2,max_length=60)
    count:int=Field(ge=1,le=500)
    @field_validator('worker_type')
    @classmethod
    def clean_type(cls,v):return worker_type_name(v)
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
    worker_type:str|None=Field(default=None,min_length=2,max_length=60)
    @field_validator('worker_type')
    @classmethod
    def clean_type(cls,v):return worker_type_name(v) if v else None
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
    work_trade:Literal['cleaning','electrician','plumber','ac','pest','carpenter','civil','spares']|None=None
    summary:str=Field(min_length=20,max_length=3000)
    skills:list[str]=Field(min_length=1,max_length=20)
    worker_role:Literal['any','technician','specialist']='any'
    openings:int=Field(ge=1,le=500)
    role_requirements:list[WorkforceRequirement]=Field(default_factory=list,max_length=20)
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
    @model_validator(mode='after')
    def role_counts(self):
        roles=[r.worker_type for r in self.role_requirements]
        if len(roles)!=len(set(roles)):raise ValueError('Combine each worker type into one required count.')
        if roles and sum(r.count for r in self.role_requirements)!=self.openings:raise ValueError('Worker type counts must add up to total team places.')
        return self
class JoinApplication(Input):
    hiring_version:int=Field(ge=1)
    note:str=Field(min_length=20,max_length=2000)
    available:Literal[True]
    worker_type:str|None=Field(default=None,min_length=2,max_length=60)
    @field_validator('worker_type')
    @classmethod
    def clean_type(cls,v):return worker_type_name(v) if v else None
class ApplicationDecision(Input):
    expected_version:int=Field(ge=1)
    project_version:int=Field(ge=1)
    action:Literal['shortlist','reject','offer','hold']
    request_id:str|None=Field(default=None,min_length=16,max_length=100)
    note:str=Field(default='',max_length=1000)
    role:Literal['member','supervisor']='member'
    daily_rate_paise:int|None=Field(default=None,gt=0,le=10000000)
    terms:str=Field(default='',max_length=2000)
    worker_type:str|None=Field(default=None,min_length=2,max_length=60)
    @field_validator('worker_type')
    @classmethod
    def clean_type(cls,v):return worker_type_name(v) if v else None

class ApplicationView(Input):
    expected_version:int=Field(ge=1)
    action:Literal['profile_viewed','application_viewed','reviewed']
    request_id:str|None=Field(default=None,min_length=16,max_length=100)
class ApplicationWithdraw(Input):
    expected_version:int=Field(ge=1)
    request_id:str|None=Field(default=None,min_length=16,max_length=100)

APPLICATION_SCAN=64

def hiring_source_authorized(u,p):
    """Authorization is derived from server-owned records, never discovery/client hints."""
    if (u.get('network_suspensions',p.get('owner_id','')) or {}).get('active'):return False
    if p.get('source_kind')=='private_request':return bool(p.get('owner_phone_verified'))
    owner=u.get('workers',p.get('owner_id','')) or {}
    approved=owner.get('status')=='approved' and bool(owner.get('contractor_verified'))
    if p.get('source_kind')=='customer_custom_query':
        source=u.get('contract_tenders',p.get('tender_id','')) or {}
        return approved and source.get('source_kind')=='customer_custom_query' and source.get('status')=='awarded' and source.get('winning_project_id')==p.get('id') and source.get('awarded_contractor_id')==p.get('owner_id')
    return approved

HIRING_TRADES=('cleaning','electrician','plumber','ac','pest','carpenter','civil','spares')

def accepted_team(p):
    """One active placement per registered worker, even for older duplicated rows."""
    rows={}
    for row in p.get('team') or []:
        if row.get('status')=='accepted' and row.get('worker_id'):
            rows[row['worker_id']]=row
    return list(rows.values())

def team_capacity(p,exclude_invitation=None):
    """Accepted workers fill vacancies; pending offers reserve remaining places."""
    hiring=p.get('hiring') or {}
    requirements=hiring.get('role_requirements') or p.get('workforce_requirements') or []
    required=hiring.get('openings') or p.get('manpower_needed') or (sum(r['count'] for r in requirements) if requirements else None)
    accepted=accepted_team(p);joined={m['worker_id'] for m in accepted};pending={}
    for row in p.get('team') or []:
        if row.get('id')==exclude_invitation:continue
        if row.get('status')=='pending' and row.get('worker_id') and row['worker_id'] not in joined:
            pending[row['worker_id']]=row
    def counts(target,filled,reserved):
        return dict(required=target,accepted=filled,vacancies=max(0,target-filled) if target is not None else None,
                    pendingOffers=reserved,availableToOffer=max(0,target-filled-reserved) if target is not None else None)
    roles=[]
    for requirement in requirements:
        kind=requirement['worker_type'];filled=sum(m.get('worker_type')==kind for m in accepted)
        reserved=sum(m.get('worker_type')==kind for m in pending.values())
        roles.append(dict(worker_type=kind,**counts(requirement['count'],filled,reserved)))
    return {**counts(required,len(accepted),len(pending)), 'roles':roles}

def work_stage(p):
    if p.get('status') in ('completed','cancelled','paused'):return p['status']
    if p.get('status')=='active':return 'work_live'
    if p.get('tender_id') and not p.get('awarded_at'):return 'preparing_bid'
    capacity=team_capacity(p)
    return 'team_ready' if capacity['required'] is not None and capacity['vacancies']==0 else 'recruiting' if p.get('hiring') else 'planning'

def sync_team_capacity(p):
    """Keep the canonical notice closed when accepted placements fill its team."""
    capacity=team_capacity(p);hiring=p.get('hiring')
    if hiring and capacity['required'] is not None and capacity['vacancies']==0 and hiring.get('status')=='open':
        hiring.update(status='closed',closed_reason='team_full',closed_at=time.time())
    return capacity

def require_team_place(p,worker_type=None,exclude_invitation=None):
    capacity=team_capacity(p,exclude_invitation)
    if capacity['required'] is not None and capacity['availableToOffer']==0:fail('TEAM_FULL','Every team place is accepted or reserved by a pending offer.',409)
    if capacity['roles']:
        role=next((r for r in capacity['roles'] if r['worker_type']==worker_type),None)
        if not role:fail('WORKER_TYPE_REQUIRED','Choose one of this project’s required worker types.',422)
        if role['availableToOffer']==0:fail('ROLE_FULL','This worker type has no unreserved team places.',409)
    return capacity

def validate_capacity_update(p):
    capacity=team_capacity(p)
    if capacity['required'] is not None and capacity['accepted']+capacity['pendingOffers']>capacity['required']:
        fail('TEAM_CAPACITY','Remove or resolve existing placements before reducing team places.',409)
    required_types={r['worker_type'] for r in capacity['roles']}
    if required_types and any(m.get('worker_type') not in required_types for m in p.get('team') or [] if m.get('status') in ('pending','accepted')):
        fail('WORKER_TYPE_REQUIRED','Resolve untyped or changed team placements before changing worker type requirements.',409)
    if any(r['accepted']+r['pendingOffers']>r['required'] for r in capacity['roles']):
        fail('ROLE_CAPACITY','Resolve existing placements before reducing this worker type’s places.',409)
    return capacity

def hiring_trade(hiring,title=''):
    """Work category is independent of the customer's business/industry sector.

    Old records can be classified from specific skills/title, then a recognizable
    trade sector. An unknown industry is not evidence of a spare-parts job.
    """
    explicit=hiring.get('work_trade')
    if explicit in HIRING_TRADES:return explicit
    from repaidians_opportunities import trade_for
    for value in [*hiring.get('skills',[]),title,hiring.get('sector','')]:
        text=' '.join(unicodedata.normalize('NFKC',str(value or '')).casefold().split())
        trade=trade_for(text)
        if trade!='spares':return trade
        if re.search(r'\b(?:spares?|parts?|inventory|shop|shops|distributor|dealer)\b',text):return 'spares'
    return None

def application_fit(worker,hiring):
    """Explainable, fixed-weight suitability; arrival order only resolves equal scores."""
    def tokens(values):
        words=set(re.findall(r'[^\W_]+',' '.join(str(v) for v in values).casefold(),flags=re.UNICODE))
        aliases={'electrical':'electrician','electric':'electrician','hvac':'ac','plumbing':'plumber','clean':'cleaning','construction':'civil','carpentry':'carpenter'}
        return {aliases.get(word,word) for word in words if word not in {'service','services','work','worker','and','the','for'}}
    requested=tokens(hiring.get('skills',[]));held=tokens(worker.get('skills',[]))
    skills=len(requested & held)/len(requested) if requested else 0
    wanted=tokens([hiring_trade(hiring) or ''])
    category=1.0 if tokens(worker.get('categories',[])) & wanted else 0.0
    city=1.0 if worker.get('city','').strip().casefold()==hiring.get('city','').strip().casefold() else 0.0
    minimum=hiring.get('minimum_experience',0);years=max(0,worker.get('experience_years') or 0)
    experience=min(1.0,years/max(1,minimum)) if minimum else 1.0
    eligible=worker.get('status')=='approved' and years>=minimum and (hiring.get('worker_role','any')=='any' or hiring.get('worker_role')==worker.get('role'))
    components=dict(skills=round(skills,3),category=category,city=city,experience=round(experience,3))
    score=round(45*skills+25*category+20*city+10*experience,2)
    reasons=[]
    if skills:reasons.append('Recorded skills cover '+str(round(skills*100))+'% of the requested skill terms')
    if category:reasons.append('Recorded trade relates to this work')
    if city:reasons.append('Same city as the work notice')
    if years>=minimum:reasons.append('Meets the recorded experience requirement')
    if not eligible:reasons.append('Current role or approval does not meet this notice')
    return dict(score=score,eligible=bool(eligible),components=components,reasons=reasons,model='project-fit-v1')

def application_keyset(u,uid,scope='all',project_id='',after='',limit=APPLICATION_SCAN+1):
    """Bounded ownership queries; no global application scan on either datastore."""
    limit=min(APPLICATION_SCAN+1,max(1,limit));rows={}
    fields=['owner_id','worker_id'] if scope=='all' else ['worker_id' if scope=='mine' else 'owner_id']
    if project_id and scope!='mine':fields=['project_id']
    for field in fields:
        value=project_id if field=='project_id' else uid
        if u.tx is not None:
            from google.cloud.firestore_v1.field_path import FieldPath
            q=u.core.fs_collection('ops_project_applications').where(field,'==',value).order_by(FieldPath.document_id()).limit(limit)
            if after:q=q.start_after({FieldPath.document_id():u.core.fs_doc('ops_project_applications',after)})
            rows.update({snap.id:snap.to_dict() for snap in q.stream(transaction=u.tx)})
        else:
            result=u.conn.execute(f"SELECT id,body FROM operation_records WHERE kind='project_applications' AND json_extract(body,'$.{field}')=? AND id>? ORDER BY id LIMIT ?",(value,after,limit))
            rows.update({row['id']:json.loads(row['body']) for row in result})
    for (kind,key),row in u.pending.items():
        if kind=='project_applications' and key>after and any(row.get(field)==(project_id if field=='project_id' else uid) for field in fields):rows[key]=row
    chosen=sorted(rows.items())[:limit]
    u.fetched.update({('project_applications',key):row for key,row in chosen})
    return chosen

def public_hiring(p):
    h=p.get('hiring')
    if not h:return None
    team=accepted_team(p);capacity=team_capacity(p)
    hiring={k:v for k,v in h.items() if k not in ('updated_by',)}
    if capacity['required'] is not None and capacity['vacancies']==0 and hiring.get('status')=='open':hiring.update(status='closed',closed_reason='team_full')
    return dict(id=p['id'],title=p['title'],contractor_id=p['owner_id'],contractor_name=p['owner_name'],owner_id=p['owner_id'],owner_name=p['owner_name'],source_kind=p.get('source_kind','commercial_project'),work_type='private_request' if p.get('source_kind')=='private_request' else 'project',status=p['status'],
        starts_at=p['starts_at'],ends_at=p['ends_at'],preparing_tender=bool(p.get('tender_id') and not p.get('awarded_at')),
        hiring=hiring,capacity=capacity,work_stage=work_stage(p),
        progress=dict(approved=sum(g['status']=='approved' for g in p['goals']),total=len(p['goals'])),
        team=dict(total=len(team),supervisors=sum(m['role']=='supervisor' for m in team),members=sum(m['role']=='member' for m in team)))

PUBLIC_TENDER_FIELDS=('id','title','sector','city','budget_paise','manpower_needed','opens_at','deadline','starts_at','ends_at','status','source_kind')
PUBLIC_TENDER_SCAN=64


def initialize(core):
    if core.USE_FIRESTORE and core.fb_db:return
    with core.db() as conn:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_contract_tenders_public_status_key ON operation_records(json_extract(body,'$.status'),id) WHERE kind='contract_tenders'")
        for field in ('owner_id','worker_id','project_id'):
            conn.execute(f"CREATE INDEX IF NOT EXISTS idx_project_applications_{field}_key ON operation_records(json_extract(body,'$.{field}'),id) WHERE kind='project_applications'")


def public_tender(t,now):
    if t.get('source_kind')=='customer_custom_query' or t.get('status')!='open' or t['ends_at']<=now:return None
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
    def project_owner(u,p,user):
        phone(user)
        if p['owner_id']!=user['id']:fail('FORBIDDEN','Only the project owner can manage hiring.',403)
        if p.get('source_kind')!='private_request':contractor(u,user)
        elif not hiring_source_authorized(u,p):fail('UNAVAILABLE','Project owner access is unavailable.',403)
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
    def can_access(p,uid):
        # An old invitation/team row is history, not an ongoing authorization grant.
        return p['owner_id']==uid or any(m['worker_id']==uid and m['status'] in ('pending','accepted') for m in p['team'])
    def access(p,uid):
        if not can_access(p,uid):fail('FORBIDDEN','This project is private.',403)
    def manager(p,uid):return p['owner_id']==uid or (member(p,uid) or {}).get('role')=='supervisor'
    def notify(u,uid,title,body,application_id=None,project_id=None):
        key=str(uuid.uuid4());row=dict(id=key,user_id=uid,title=title,body=body,destination='repaidians' if application_id else 'contractor',created_at=time.time())
        if application_id:row.update(application_id=application_id,project_id=project_id,kind='application_update')
        u.put('notifications',key,row)
    def application_event(u,a,user,action,status=None,note='',request_id=None):
        now=time.time();a['version']+=1;a['updated_at']=now
        if status:a['status']=status
        e=dict(id=str(uuid.uuid4()),action=action,status=a['status'],at=now,actor=user['id'])
        if note:e['note']=note
        a.setdefault('events',[]).append(e)
        if request_id:
            receipts=a.setdefault('command_receipts',{})
            receipts[request_id]=dict(action=action,version=a['version'])
            if len(receipts)>100:receipts.pop(next(iter(receipts)))
        audit(u,'ContractApplicationChanged',user['id'],application_id=a['id'],command=action,version=a['version'])
        u.put('project_applications',a['id'],a)
        from repaidians_work import application_event as social_application_event
        project=u.get('contract_projects',a['project_id'])
        if project:social_application_event(u,a,project,{'hold':'held','shortlist':'shortlisted','offer':'offered','accept':'accepted','reject':'rejected','reviewed':'reviewing'}.get(action,action))
    def application_replay(a,request_id,action,body=None):
        receipt=(a.get('command_receipts') or {}).get(request_id) if request_id else None
        digest=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True).encode()).hexdigest() if body else None
        if receipt and (receipt['action']!=action or (receipt.get('request_hash') and receipt['request_hash']!=digest)):fail('REQUEST_REUSED','Use a new request for changed details.',409)
        return bool(receipt)
    def application_view(a):
        return {k:v for k,v in a.items() if k not in ('command_receipts',)}
    def application_details(u,a,uid):
        from worker_network import person_card
        if uid not in (a['owner_id'],a['worker_id']):fail('NOT_FOUND','Application unavailable.',404)
        p=get(u,'contract_projects',a['project_id'])
        invitation=next((m for m in p['team'] if m.get('id')==a.get('invitation_id')),None)
        row={**application_view(a),'project_title':p['title'],'project_version':p['version'],'project_status':p['status'],'source_kind':p.get('source_kind','commercial_project'),'invitation_status':invitation.get('status') if invitation else None,'applicant':person_card(u,u.get('workers',a['worker_id']) or {})}
        row.update(capacity=team_capacity(p),work_stage=work_stage(p))
        if invitation:row['invitation']={k:invitation.get(k) for k in ('id','worker_id','role','worker_type','status','daily_rate_paise','terms','invited_at','responded_at','accepted_at')}
        if uid==a['owner_id']:row['fit']=application_fit(u.get('workers',a['worker_id']) or {},p.get('hiring') or {})
        return row
    def event(u,p,user,action,note=''):
        if 'team' in p:sync_team_capacity(p)
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
        access(p,uid)
        state=dict(capacity=team_capacity(p),work_stage=work_stage(p))
        if p['owner_id']==uid:return {**p,**state}
        mine=member(p,uid)
        if not mine:
            return {**{k:p[k] for k in ('id','title','scope','site','starts_at','ends_at','status','version','owner_id','owner_name','tender_id')},**state,'source_kind':p.get('source_kind','commercial_project'),'team':[m for m in p['team'] if m['worker_id']==uid],'goals':[],'attendance':[],'leave':[],'events':[]}
        return {**p,**state,'budget_paise':None,'team':[{**m,'daily_rate_paise':m['daily_rate_paise'] if m['worker_id']==uid else None,'terms':m['terms'] if m['worker_id']==uid else ''} for m in p['team']],'attendance':[a for a in p['attendance'] if a['worker_id']==uid or mine['role']=='supervisor'],'leave':[a for a in p['leave'] if a['worker_id']==uid or mine['role']=='supervisor']}
    @r.get('/sectors')
    def sectors():
        return store.run(lambda u:dict(sectors=sector_catalog(u)))
    @r.get('/overview')
    def overview():
        def execute(u):
            projects={p['id']:p for p in u.all('contract_projects')}
            contracts=[];scores={}
            for t in u.all('contract_tenders'):
                if t.get('source_kind')=='customer_custom_query':continue
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
            return dict(server_time=time.time(),tenders=[{k:v for k,v in tender_view(t,user['id']).items() if k not in ('request_hash','events','owner_id')} for t in u.all('contract_tenders') if t.get('source_kind')!='customer_custom_query'])
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
            uid=user['id'];w=u.get('workers',uid) or {};return dict(server_time=time.time(),user_id=uid,can_contract=w.get('status')=='approved' and bool(w.get('contractor_verified')),profile=u.get('contract_profiles',uid),projects=[project_view(p,uid) for p in u.all('contract_projects') if can_access(p,uid)],tenders=[tender_view(t,uid) for t in u.all('contract_tenders') if t.get('source_kind')!='customer_custom_query' and ((w.get('status')=='approved' and w.get('contractor_verified')) or t['owner_id']==uid)])
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
    def create_project_record(body,user,private=False):
        phone(user)
        def execute(u):
            if not private:contractor(u,user)
            if private and body.tender_id:fail('PRIVATE_TENDER','A private request cannot bid for a commercial tender.',422)
            key=identifier('private-project' if private else 'project',user['id'],body.request_id);old=u.get('contract_projects',key);digest=same_create(old,body)
            if old:return old
            if body.ends_at<=time.time():fail('DATES','Choose future work dates.',422)
            if body.tender_id:
                t=get(u,'contract_tenders',body.tender_id)
                if t.get('source_kind')=='customer_custom_query':fail('SCOPED_QUERY','Use the matched customer query to prepare its contract.',403)
                if t['status']!='open' or t['deadline']<=time.time():fail('CLOSED','This tender is closed.',409)
                if body.starts_at!=t['starts_at'] or body.ends_at!=t['ends_at']:fail('DATES','Use the tender work dates for its team plan.',422)
            p=dict(**body.model_dump(exclude={'request_id'}),id=key,request_hash=digest,owner_id=user['id'],owner_name=(u.get('contract_profiles',user['id']) or {}).get('name',user['name']),source_kind='private_request' if private else 'commercial_project',owner_phone_verified=bool(user.get('phone_verified')),status='planning',team=[],goals=[],attendance=[],leave=[],events=[],version=1,created_at=time.time())
            u.put('contract_projects',key,p);audit(u,'ContractProjectCreated',user['id'],project_id=key);return p
        return store.run(execute)
    @r.post('/projects')
    def create_project(body:Project,user=Depends(core.current_user)):
        return create_project_record(body,user)
    @r.post('/projects/private')
    def create_private_project(body:Project,user=Depends(core.current_user)):
        return create_project_record(body,user,private=True)
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
            contractor(u,user);t=get(u,'contract_tenders',tid)
            if t.get('source_kind')=='customer_custom_query':fail('SCOPED_QUERY','Submit through the matched customer query.',403)
            uid=user['id'];key=identifier('bid',uid,body.request_id);old=next((b for b in t['bids'] if b['id']==key),None);digest=same_create(old,body)
            if old:return tender_view(t,uid)
            version(t,body.expected_version)
            if t['owner_id']==uid:fail('SELF_BID','You cannot bid on your own tender.',403)
            if t['status']!='open' or not t['opens_at']<=time.time()<t['deadline']:fail('CLOSED','Bidding is not open.',409)
            p=get(u,'contract_projects',body.project_id)
            if p['owner_id']!=uid or p['tender_id']!=tid or p['status']!='planning':fail('TEAM_REQUIRED','Choose your team plan for this tender.',422)
            crew=accepted_team(p)
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
            t=get(u,'contract_tenders',tid)
            if t.get('source_kind')=='customer_custom_query':fail('SCOPED_QUERY','Manage this contract through the customer query.',403)
            version(t,body.expected_version);uid=user['id'];action=body.action
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
                    p=get(u,'contract_projects',b['project_id']);crew=accepted_team(p);contractor(u,dict(id=b['contractor_id'],phone_verified=True))
                    if p['status']!='planning' or len(crew)<t['manpower_needed']:fail('TEAM_REQUIRED','The bidder must reconfirm the required team.',409)
                    for m in crew:active_worker(u,m['worker_id']);free(u,m['worker_id'],p)
                    b['status']='awarded';t.update(status='awarded',winning_bid_id=b['id'],winning_project_id=p['id']);p.update(awarded_at=time.time(),contract_value_paise=b['amount_paise'],client_id=uid)
                    event(u,p,user,'contract_awarded');u.put('contract_projects',p['id'],p);notify(u,p['owner_id'],'Tender awarded',t['title'])
            event(u,t,user,action);u.put('contract_tenders',tid,t);return tender_view(t,uid)
        return store.run(execute)
    def add_invitation(u,pid,body,user):
        p=get(u,'contract_projects',pid);project_owner(u,p,user);version(p,body.expected_version)
        if p['owner_id']!=user['id']:fail('FORBIDDEN','Only the contractor can invite or set reporting roles.',403)
        if p['status'] in ('completed','cancelled') or p['ends_at']<=time.time():fail('CLOSED','Project is closed.',409)
        if body.worker_id==user['id']:fail('SELF_INVITE','Choose another agent.',422)
        w=active_worker(u,body.worker_id)
        from repaidians import blocked as social_blocked
        if social_blocked(u,user['id'],body.worker_id) or (u.get('network_suspensions',body.worker_id) or {}).get('active'):fail('UNAVAILABLE','This agent is unavailable for invitations.',409)
        if any(m['worker_id']==body.worker_id and m['status'] in ('pending','accepted') for m in p['team']):fail('DUPLICATE','This agent is already invited or on the team.',409)
        require_team_place(p,body.worker_type)
        if body.reports_to and not any(m['worker_id']==body.reports_to and m['status']=='accepted' and m['role']=='supervisor' for m in p['team']):fail('HIERARCHY','Choose an accepted supervisor.',422)
        free(u,body.worker_id,p)
        m=dict(**body.model_dump(exclude={'expected_version'}),id=str(uuid.uuid4()),name=w['name'],status='pending',invited_at=time.time());p['team'].append(m)
        event(u,p,user,'agent_invited',w['name']);u.put('contract_projects',pid,p);notify(u,body.worker_id,'Project team invitation',p['title']);return p
    @r.post('/projects/{pid}/invitations')
    def invite(pid:str,body:Invite,user=Depends(core.current_user)):
        return store.run(lambda u:project_view(add_invitation(u,pid,body,user),user['id']))

    @r.put('/projects/{pid}/hiring')
    def hiring_notice(pid:str,body:HiringNotice,user=Depends(core.current_user)):
        def save(u):
            p=get(u,'contract_projects',pid);project_owner(u,p,user)
            version(p,body.expected_version)
            if p['status'] in ('completed','cancelled') or p['ends_at']<=time.time():fail('CLOSED','This project has ended.',409)
            if body.status=='open' and not time.time()<body.deadline<=p['ends_at']:fail('DEADLINE','Set a future application deadline within the project dates.',422)
            h={**body.model_dump(exclude={'expected_version'}),'version':(p.get('hiring') or {}).get('version',0)+1,'updated_at':time.time()}
            work_trade=hiring_trade(h,p['title'])
            if not work_trade:fail('WORK_CATEGORY_REQUIRED','Choose the work category separately from the business sector.',422)
            h['work_trade']=work_trade
            if p.get('work_trade') and h['work_trade']!=p['work_trade']:fail('AGREED_TRADE','Hiring must keep the work category agreed for this contract.',409)
            h['sector']=save_sector(u,h['sector'],user['id']);p['hiring']=h
            if p.get('workforce_requirements') and h['role_requirements']!=p['workforce_requirements']:fail('AGREED_WORKFORCE','Hiring must keep the worker type counts agreed for this contract.',409)
            validate_capacity_update(p)
            event(u,p,user,'hiring_'+body.status);u.put('contract_projects',pid,p);return {**p,'capacity':team_capacity(p),'work_stage':work_stage(p)}
        return store.run(save)
    @r.post('/projects/{pid}/apply')
    def apply_for_project(pid:str,body:JoinApplication,user=Depends(core.current_user)):
        def save(u):
            from worker_network import network_worker, blocked, throttle
            from repaidians import blocked as social_blocked
            w=network_worker(u,user);p=get(u,'contract_projects',pid);h=p.get('hiring') or {};uid=user['id']
            if uid==p['owner_id'] or blocked(u,uid,p['owner_id']) or social_blocked(u,uid,p['owner_id']):fail('UNAVAILABLE','This application is unavailable.',403)
            if not hiring_source_authorized(u,p):fail('UNAVAILABLE','Project owner approval is unavailable.',409)
            if h.get('status')!='open' or h.get('deadline',0)<=time.time() or p['status'] not in ('planning','active') or p['ends_at']<=time.time():fail('CLOSED','Hiring is not open for this project.',409)
            if h['version']!=body.hiring_version:fail('TERMS_CHANGED','Hiring details changed. Read the updated notice before applying.',409)
            if team_capacity(p)['vacancies']==0:fail('FULL','The accepted project team has filled every place.',409)
            if (p.get('tender_id') and not p.get('awarded_at')):fail('AWARD_REQUIRED','This plan is awaiting contract award. Register interest in the contract before applying for an awarded project.',409)
            worker_type=body.worker_type
            capacity=team_capacity(p)
            if capacity['roles']:
                role=next((r for r in capacity['roles'] if r['worker_type']==worker_type),None)
                if not role:fail('WORKER_TYPE_REQUIRED','Choose a required worker type before applying.',422)
                if role['vacancies']==0:fail('ROLE_FULL','The accepted team has filled this worker type.',409)
            if h['worker_role']!='any' and h['worker_role']!=w['role']:fail('ROLE_REQUIRED','This notice requires a different approved work role.',409)
            if (w.get('experience_years') or 0)<h['minimum_experience']:fail('EXPERIENCE_REQUIRED','This notice requires more recorded experience.',409)
            if any(m['worker_id']==uid and m['status'] in ('accepted','pending') for m in p['team']):fail('ALREADY_TEAM','An invitation or team placement already exists.',409)
            free(u,uid,p)
            first_interest_at=None
            if p.get('source_kind')=='customer_custom_query':
                from repaidians import digest
                interest=u.get('custom_contract_interests',digest(p.get('tender_id','')+':'+uid)) or {}
                stamp=interest.get('created_at')
                if interest.get('query_id')==p.get('tender_id') and interest.get('worker_id')==uid and interest.get('worker_type')==worker_type and interest.get('status')=='pending_award' and interest.get('available') is True and isinstance(stamp,(int,float)) and not isinstance(stamp,bool) and 0<stamp<=time.time():first_interest_at=stamp
            key=identifier('application',uid,pid);old=u.get('project_applications',key)
            if old and old['status'] in ('applied','shortlisted','on_hold') and (old.get('notice_snapshot') or {}).get('version')!=h['version']:
                old.update(notice_snapshot=h,note=body.note,worker_type=worker_type,first_interest_at=first_interest_at)
                application_event(u,old,user,'reconfirmed','applied');return application_view(old)
            if old and old['status'] not in ('withdrawn','rejected','declined','offer_withdrawn'):return application_view(old)
            if old and old['status']=='rejected':fail('REVIEWED','This application was reviewed. Contact the contractor through a connection for future openings.',409)
            throttle(u,uid,'application',20,86400)
            row=dict(id=key,project_id=pid,worker_id=uid,worker_name=w['name'],owner_id=p['owner_id'],note=body.note,worker_type=worker_type,first_interest_at=first_interest_at,notice_snapshot=h,source_kind=p.get('source_kind','commercial_project'),starts_at=p['starts_at'],ends_at=p['ends_at'],status='applied',version=(old or {}).get('version',0)+1,created_at=time.time(),updated_at=time.time(),events=[*((old or {}).get('events',[])),dict(id=str(uuid.uuid4()),action='applied',status='applied',actor=uid,at=time.time())])
            u.put('project_applications',key,row)
            from repaidians_work import application_event as social_application_event
            social_application_event(u,row,p,'applied');notify(u,p['owner_id'],'New joining request',p['title']);return application_view(row)
        return store.run(save)
    @r.get('/projects/{pid}/candidates')
    def project_candidates(pid:str,cursor:str=Query(default='',max_length=1024),limit:int=Query(default=24,ge=1,le=APPLICATION_SCAN),user=Depends(core.current_user)):
        def read(u):
            from repaidians_work import candidate_keyset
            from repaidians import blocked as social_blocked
            from worker_network import blocked, person_card
            p=get(u,'contract_projects',pid);project_owner(u,p,user);h=p.get('hiring') or {}
            if not h:fail('HIRING_REQUIRED','Publish the work requirements before discovering suitable agents.',409)
            if p['status'] in ('completed','cancelled') or p['ends_at']<=time.time():fail('CLOSED','This project has ended.',409)
            after,binding=published_cursor(cursor,dict(user_id=user['id'],project_id=pid,hiring_version=h['version'],city=h['city'],work_trade=hiring_trade(h,p['title'])))
            refs=candidate_keyset(u,hiring_trade(h,p['title']),h['city'],after,APPLICATION_SCAN)
            u.prefetch([(kind,row['id']) for row in refs for kind in ('workers','rp_members','network_suspensions','worker_profiles')]+[(kind,key) for row in refs for key in (user['id']+':'+row['id'],row['id']+':'+user['id']) for kind in ('network_blocks',)]+[('rp_blocks',hashlib.sha256(key.encode()).hexdigest()) for row in refs for key in (user['id']+':'+row['id'],row['id']+':'+user['id'])])
            candidates=[];last=after;seen=0
            for ref in refs:
                last=ref['sortKey'];seen+=1;wid=ref['id']
                if not ref.get('active') or wid==user['id']:continue
                worker=u.get('workers',wid) or {};profile=u.get('rp_members',wid) or {}
                if profile.get('workStatus') not in ('available','open_to_work') or worker.get('status')!='approved':continue
                if blocked(u,user['id'],wid) or social_blocked(u,user['id'],wid) or (u.get('network_suspensions',wid) or {}).get('active'):continue
                if any(m['worker_id']==wid and m['status'] in ('pending','accepted') for m in p['team']):continue
                fit=application_fit(worker,h)
                if not fit['eligible'] or not fit['components']['city'] or not (fit['components']['skills'] or fit['components']['category']):continue
                card=person_card(u,worker)
                candidates.append({**card,'worker_id':wid,'fit':fit,'ready_for_work':True,'work_status':profile['workStatus'],'profile_id':wid,'avatar_url':profile.get('avatarUrl'),'schedule_rechecked_on_offer':True})
                if len(candidates)>=limit:break
            candidates.sort(key=lambda row:(-row['fit']['score'],row['id']))
            has_more=seen<len(refs) or len(refs)==APPLICATION_SCAN
            return dict(candidates=candidates,agents=candidates,project_id=pid,project_version=p['version'],hiring_version=h['version'],has_more=has_more,next_cursor=published_next_cursor(last,binding) if has_more and last else None,rank_scope='page')
        return store.run(read)
    @r.get('/hiring/applications')
    def hiring_applications(scope:Literal['all','mine','owned']='all',project_id:str=Query(default='',max_length=100,pattern=r'^[A-Za-z0-9_-]*$'),cursor:str=Query(default='',max_length=1024),limit:int=Query(default=24,ge=1,le=APPLICATION_SCAN),user=Depends(core.current_user)):
        phone(user);uid=user['id'];after,binding=published_cursor(cursor,dict(user_id=uid,scope=scope,project_id=project_id))
        def read(u):
            from worker_network import person_card
            if project_id:
                source=get(u,'contract_projects',project_id)
                if scope!='mine':project_owner(u,source,user)
            records=application_keyset(u,uid,scope,project_id,after,limit+1);has_more=len(records)>limit;records=records[:limit];rows=[]
            u.prefetch([('contract_projects',a['project_id']) for _,a in records]+[(kind,a['worker_id']) for _,a in records for kind in ('workers','worker_profiles')])
            for _,a in records:
                if project_id and a['project_id']!=project_id:continue
                if uid not in (a['owner_id'],a['worker_id']) or (scope=='mine' and a['worker_id']!=uid) or (scope=='owned' and a['owner_id']!=uid):continue
                p=u.get('contract_projects',a['project_id'])
                if not p:continue
                rows.append(application_details(u,a,uid))
            if scope=='owned':
                rows.sort(key=lambda a:(not a['fit']['eligible'],-a['fit']['score'],a.get('first_interest_at') or a['created_at'],a['created_at'],a['id']))
                for position,row in enumerate(rows,1):row.update(queue_position=position,rank_scope='page',tie_break='recorded_interest_or_application' if row.get('first_interest_at') else 'first_applied')
            else:rows.sort(key=lambda a:a['updated_at'],reverse=True)
            return dict(applications=rows,has_more=has_more,next_cursor=published_next_cursor(records[-1][0],binding) if has_more and records else None,server_time=time.time())
        return store.run(read)
    @r.get('/hiring/applications/{aid}')
    def hiring_application_detail(aid:str,user=Depends(core.current_user)):
        phone(user)
        return store.run(lambda u:application_details(u,get(u,'project_applications',aid),user['id']))
    @r.post('/hiring/applications/{aid}/view')
    def record_application_view(aid:str,body:ApplicationView,user=Depends(core.current_user)):
        def save(u):
            a=get(u,'project_applications',aid);p=get(u,'contract_projects',a['project_id']);project_owner(u,p,user)
            if application_replay(a,body.request_id,body.action,body):return application_view(a)
            # First meaningful action is recorded once; rerenders/opening the same view cannot spam candidates.
            if a.get(body.action+'_at'):return application_view(a)
            version(a,body.expected_version);a[body.action+'_at']=time.time()
            application_event(u,a,user,body.action,request_id=body.request_id)
            if body.request_id:
                a['command_receipts'][body.request_id]['request_hash']=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True).encode()).hexdigest();u.put('project_applications',a['id'],a)
            labels={'profile_viewed':'Your profile was viewed','application_viewed':'Your application was opened','reviewed':'Your application was reviewed'}
            notify(u,a['worker_id'],labels[body.action],p['title'],a['id'],p['id']);return application_view(a)
        return store.run(save)
    @r.post('/hiring/applications/{aid}/withdraw')
    def withdraw_application(aid:str,body:ApplicationWithdraw|None=None,user=Depends(core.current_user)):
        def save(u):
            phone(user);a=get(u,'project_applications',aid)
            if a['worker_id']!=user['id']:fail('NOT_FOUND','Application unavailable.',404)
            if a['status']=='withdrawn' or (body and application_replay(a,body.request_id,'withdrawn',body)):return application_view(a)
            if body:version(a,body.expected_version)
            if a['status'] not in ('applied','shortlisted','on_hold','offer_withdrawn'):fail('STATE','Respond to an existing offer from Project teams.',409)
            application_event(u,a,user,'withdrawn','withdrawn',request_id=body.request_id if body else None)
            if body and body.request_id:
                a['command_receipts'][body.request_id]['request_hash']=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True).encode()).hexdigest();u.put('project_applications',a['id'],a)
            notify(u,a['owner_id'],'Application withdrawn',a.get('worker_name','An applicant'),a['id'],a['project_id']);return application_view(a)
        return store.run(save)
    @r.post('/hiring/applications/{aid}/decision')
    def decide_application(aid:str,body:ApplicationDecision,user=Depends(core.current_user)):
        def save(u):
            from worker_network import blocked
            from repaidians import blocked as social_blocked
            a=get(u,'project_applications',aid);p=get(u,'contract_projects',a['project_id']);project_owner(u,p,user)
            if application_replay(a,body.request_id,body.action,body):return application_view(a)
            version(a,body.expected_version);version(p,body.project_version)
            if p['status'] in ('completed','cancelled') or p['ends_at']<=time.time():fail('CLOSED','This project has ended.',409)
            if a['status'] not in ('applied','shortlisted','on_hold','offer_withdrawn'):fail('STATE','This application is no longer pending.',409)
            if body.action=='offer':
                h=p.get('hiring') or {}
                if h.get('status')!='open' or h.get('deadline',0)<=time.time() or p['status'] not in ('planning','active'):fail('HIRING_CLOSED','Reopen hiring before making an offer.',409)
                if a.get('notice_snapshot',{}).get('version')!=h.get('version'):fail('TERMS_CHANGED','The hiring notice changed. Ask the candidate to reconfirm the current notice.',409)
                if blocked(u,user['id'],a['worker_id']) or social_blocked(u,user['id'],a['worker_id']):fail('UNAVAILABLE','This connection is blocked.',403)
                candidate=active_worker(u,a['worker_id'])
                if (u.get('network_suspensions',a['worker_id']) or {}).get('active'):fail('UNAVAILABLE','This candidate is under network review.',409)
                if (h['worker_role']!='any' and candidate['role']!=h['worker_role']) or candidate.get('experience_years',0)<h['minimum_experience']:fail('REQUIREMENTS_CHANGED','The candidate no longer meets this notice. Review the current requirements.',409)
                worker_type=body.worker_type or a.get('worker_type')
                if a.get('worker_type') and worker_type!=a['worker_type']:fail('WORKER_TYPE_CHANGED','Send joining terms for the worker type the applicant selected.',409)
                require_team_place(p,worker_type)
                if not body.daily_rate_paise or len(body.terms.strip())<20:fail('TERMS','Set the offered daily rate and full joining terms.',422)
                p=add_invitation(u,p['id'],Invite(expected_version=p['version'],worker_id=a['worker_id'],role=body.role,worker_type=worker_type,daily_rate_paise=body.daily_rate_paise,terms=body.terms),user)
                invitation=p['team'][-1];invitation.update(application_id=a['id'],hiring_version=h['version'])
                u.put('contract_projects',p['id'],p);a['invitation_id']=invitation['id']
                a['offer_snapshot']={k:invitation.get(k) for k in ('daily_rate_paise','terms','role','worker_type','invited_at','hiring_version')}
            elif body.action in ('reject','hold') and len(body.note.strip())<5:fail('REASON','Give the candidate a short decision reason.',422)
            a['decision_note']=body.note
            application_event(u,a,user,body.action,{'offer':'offered','shortlist':'shortlisted','reject':'rejected','hold':'on_hold'}[body.action],body.note,body.request_id)
            if body.request_id:
                a['command_receipts'][body.request_id]['request_hash']=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True).encode()).hexdigest();u.put('project_applications',a['id'],a)
            notify(u,a['worker_id'],'Application '+a['status'].replace('_',' '),p['title'],a['id'],p['id']);return application_view(a)
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
                application=u.get('project_applications',inv['application_id']) if inv.get('application_id') else None
                if application and (application.get('status')!='offered' or application.get('invitation_id')!=inv['id']):fail('OFFER_CHANGED','This application offer is no longer current.',409)
                if a=='accept':
                    if any(row.get('worker_id')==uid and row.get('status')=='accepted' for row in p['team']):fail('ALREADY_TEAM','You already hold an accepted placement on this project.',409)
                    require_team_place(p,inv.get('worker_type'),exclude_invitation=inv['id'])
                    if inv.get('hiring_version') and (p.get('hiring') or {}).get('version')!=inv['hiring_version']:fail('TERMS_CHANGED','Hiring details changed after this offer. Ask for a new offer.',409)
                    if not hiring_source_authorized(u,p):fail('UNAVAILABLE','The project owner is unavailable.',409)
                    if (u.get('network_suspensions',uid) or {}).get('active'):fail('UNAVAILABLE','Worker access is under review.',409)
                    from repaidians import blocked as social_blocked
                    if social_blocked(u,uid,p['owner_id']):fail('UNAVAILABLE','This work connection is blocked.',403)
                    candidate=active_worker(u,uid);free(u,uid,p)
                    current_hiring=p.get('hiring') or {}
                    if application and ((current_hiring.get('worker_role','any')!='any' and current_hiring.get('worker_role')!=candidate['role']) or (candidate.get('experience_years') or 0)<current_hiring.get('minimum_experience',0)):fail('REQUIREMENTS_CHANGED','Your approved work record no longer meets this notice.',409)
                    if p['ends_at']<=now:fail('DATES','Invitation dates have passed.',409)
                    if inv['reports_to'] and not member(p,inv['reports_to']):fail('HIERARCHY','The supervisor has left. Ask for a new invitation.',409)
                inv.update(status='accepted' if a=='accept' else 'declined',responded_at=now);notify(u,p['owner_id'],'Team invitation '+a,p['title'])
                if a=='accept':inv['accepted_at']=now
                if application:
                    application_event(u,application,user,a,'hired' if a=='accept' else 'declined',body.note)
                    notify(u,uid,'Application '+application['status'],p['title'],application['id'],p['id'])
            elif a in ('leave_team','remove'):
                target=body.target_id if a=='remove' else uid
                if a=='remove' and not own:fail('FORBIDDEN','Only the contractor can remove members.',403)
                active_rows=[x for x in p['team'] if x['worker_id']==target and x['status'] in ('pending','accepted')]
                if not active_rows:fail('MEMBER','Member not active.',409)
                linked_seen=set()
                for row in active_rows:
                    was_pending=row['status']=='pending';row['status']='removed' if a=='remove' else 'left'
                    linked=u.get('project_applications',row['application_id']) if row.get('application_id') else None
                    if linked and linked.get('invitation_id')==row['id'] and linked['id'] not in linked_seen:
                        linked_seen.add(linked['id']);status='offer_withdrawn' if was_pending else 'ended'
                        application_event(u,linked,user,a,status,body.note)
                        notify(u,row['worker_id'],'Application '+status.replace('_',' '),p['title'],linked['id'],p['id'])
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
                if p['status'] in ('completed','cancelled'):
                    for teammate in p['team']:
                        linked=u.get('project_applications',teammate['application_id']) if teammate.get('application_id') else None
                        if linked and linked.get('invitation_id')==teammate['id'] and linked.get('status') in ('offered','hired'):
                            application_event(u,linked,user,a,p['status'],body.note)
                            notify(u,linked['worker_id'],'Project '+p['status'],p['title'],linked['id'],p['id'])
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
            event(u,p,user,a,body.note);u.put('contract_projects',pid,p)
            if not can_access(p,uid):
                # A self-revoking command still commits and returns its receipt,
                # without returning the private project after permission ends.
                return dict(id=p['id'],title=p['title'],status=p['status'],version=p['version'],team=[{k:row.get(k) for k in ('id','worker_id','role','status')} for row in p['team'] if row['worker_id']==uid])
            return project_view(p,uid)
        return store.run(execute)
    core.app.include_router(r)
