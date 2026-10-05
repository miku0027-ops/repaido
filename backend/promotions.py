"""Company campaigns, consented recommendations and bounded promotional delivery.
No inferred vulnerability, raw query storage, invented scarcity or automatic add-ons.
Discounts are fixed, advertised, company-funded and reserved transactionally.
"""
import hashlib, math, time, os, uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Literal
from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, model_validator
from operations import Input, fail
from integrations import audit

IST = ZoneInfo('Asia/Kolkata')
PLACEMENTS = Literal['home','explore','checkout','launch','push']
DEFAULT = dict(version=1, enabled=True, push_enabled=True, slots=[510,870,1230], daily_cap=3,
               repeat_hours=72, rotation_seconds=4, minimum_margin_bps=500, risk_cost_bps=300)

class Controls(Input):
    version:int=Field(ge=1)
    enabled:bool=True
    push_enabled:bool=True
    slots:list[int]=Field(default_factory=lambda:[510,870,1230],min_length=1,max_length=3)
    daily_cap:int=Field(default=3,ge=0,le=3)
    repeat_hours:int=Field(default=72,ge=24,le=168)
    rotation_seconds:int=Field(default=4,ge=3,le=10)
    minimum_margin_bps:int=Field(default=500,ge=0,le=5000)
    risk_cost_bps:int=Field(default=300,ge=100,le=5000)
    @model_validator(mode='after')
    def schedule(self):
        if any(not 480<=v<1380 for v in self.slots) or len(set(self.slots))!=len(self.slots) or any(b-a<120 for a,b in zip(sorted(self.slots),sorted(self.slots)[1:])):
            raise ValueError('Choose distinct slots at least two hours apart between 08:00 and 23:00 India time.')
        self.slots.sort();return self
class Campaign(Input):
    version:int=Field(default=0,ge=0)
    title:str=Field(min_length=3,max_length=64)
    body:str=Field(min_length=3,max_length=110)
    service_id:str=Field(min_length=1,max_length=100)
    icon:Literal['sparkles','wrench','shield','rupee','headset','repeat','leaf','car','zap','gift']='gift'
    tone:Literal['blue','mint','peach','festive']='blue'
    event_name:str=Field(default='',max_length=80)
    image_id:str=Field(default='',max_length=36)
    image_alt:str=Field(default='',max_length=150)
    layout:Literal['compact','image-card','editorial']='compact'
    placements:list[PLACEMENTS]=Field(min_length=1,max_length=5)
    cities:list[str]=Field(min_length=1,max_length=10)
    starts_at:float
    ends_at:float
    active:bool=False
    audience:Literal['all','new','returning','lapsed']='all'
    min_paid_spend_paise:int=Field(default=0,ge=0,le=100000000)
    discount_paise:int=Field(default=0,ge=0,le=1000000)
    budget_paise:int=Field(default=0,ge=0,le=100000000)
    per_user_limit:int=Field(default=1,ge=1,le=10)
    terms:str=Field(min_length=15,max_length=1600)
    @model_validator(mode='after')
    def dates(self):
        if self.image_id and len(self.image_alt.strip())<5:raise ValueError('Describe the campaign image for accessibility.')
        if self.service_id.startswith('home:') and self.discount_paise:raise ValueError('Home plans are quoted individually; do not advertise an unapproved discount.')
        if self.ends_at<=self.starts_at or self.ends_at-self.starts_at>180*86400:raise ValueError('Campaign duration must be positive and no longer than 180 days.')
        if self.discount_paise>self.budget_paise:raise ValueError('The discount needs a funded campaign budget.')
        return self
class Preferences(Input):
    consent_version:Literal[1]=1
    personalised:bool=False
    push:bool=False
    launch:bool=True
    daily_cap:int=Field(default=3,ge=0,le=3)
    city:str=Field(default='Balasore',max_length=80)
class Feed(Input):
    placement:PLACEMENTS='home'
    city:str=Field(default='Balasore',max_length=80)
    service_id:str=Field(default='',max_length=100)
class Interaction(Input):
    kind:Literal['impression','open','dismiss']
    event_id:str=Field(pattern=r'^[A-Za-z0-9_-]{16,80}$')
class OfferQuote(Input):
    campaign_id:str
    service_id:str
    city:str

def campaign_services(catalog):
    from home_plans import OFFERINGS
    return {**{s['id']:s for s in catalog['services']},**{'home:'+s['id']:dict(id='home:'+s['id'],name=s['name'],category=s['category'],description=s['description'],price_paise=0,duration_minutes=0,included=['Written scope and quote before confirmation'],excluded=['Work and availability require approval'],home_service=s['id']) for s in OFFERINGS}}

def controls(u):return u.get('campaign_controls','current') or DEFAULT.copy()
def prefs(u,uid):return u.get('campaign_preferences',uid) or dict(consent_version=1,personalised=False,push=False,launch=True,daily_cap=3,city='Balasore')
def history(u,uid):
    return [j for j in u.all('jobs') if j.get('customer_id')==uid and j['state']=='completed' and j.get('payment_status')=='verified'] if uid else []
def margin(u,c,s,policy=None):
    policy=policy or u.get('policies','current')
    if not c['discount_paise']:return True
    if not policy:return False
    config=controls(u);base=s['price_paise'];worker=base*policy['worker_share_bps']//10000;bonus=base*policy.get('bonus_reserve_bps',0)//10000
    return base-worker-bonus-c['discount_paise'] >= math.ceil(base*(config['minimum_margin_bps']+config['risk_cost_bps'])/10000)
def eligible(u,c,s,uid,city,now,placement=None):
    config=controls(u)
    if not config['enabled'] or not c.get('active') or not c['starts_at']<=now<c['ends_at'] or city not in c['cities'] or not s or not s.get('active',True):return False
    if placement and placement not in c['placements']:return False
    if not margin(u,c,s):return False
    if c['discount_paise'] and c.get('reserved_paise',0)+c['discount_paise']>c['budget_paise']:return False
    p=prefs(u,uid) if uid else {}
    if c['id'] in p.get('dismissed',{}):return False
    uses=[r for r in u.all('campaign_redemptions') if r['campaign_id']==c['id'] and r['user_id']==uid] if uid else []
    if len(uses)>=c['per_user_limit']:return False
    # Audience/spending targeting is optional and is never inferred for guests or opted-out accounts.
    if c['audience']!='all' or c['min_paid_spend_paise']:
        if not uid or not p.get('personalised'):return False
        past=history(u,uid)
        if c['audience']=='new' and past:return False
        if c['audience']=='returning' and not past:return False
        if c['audience']=='lapsed' and (not past or max(j.get('completed_at',0) for j in past)>now-60*86400):return False
        if sum(j['total_paise'] for j in past)<c['min_paid_spend_paise']:return False
    return True

def recommendations(u,catalog,body,uid=None,now=None):
    now=time.time() if now is None else now;config=controls(u);p=prefs(u,uid) if uid else {}
    if body.placement=='launch' and not p.get('launch',True):return []
    services=campaign_services(catalog);out=[]
    interest=u.get('discovery_preferences',uid) or {} if uid and p.get('personalised') else {}
    signals=interest.get('signals',{}) if interest.get('enabled') and interest.get('consent_version')==2 else {}
    paid=history(u,uid) if uid and p.get('personalised') else []
    active_categories={j['category'] for j in u.all('jobs') if uid and j.get('customer_id')==uid and j['state'] not in ('completed','cancelled')}
    for c in u.all('campaigns'):
        s=services.get(c['service_id'])
        placement='launch' if body.placement=='home' and p.get('launch',True) and 'home' not in c['placements'] and 'launch' in c['placements'] else body.placement
        if not eligible(u,c,s,uid,body.city,now,placement):continue
        if body.service_id and s['id']==body.service_id and not c['discount_paise']:continue
        if body.placement=='push' and s['category'] in active_categories:continue
        interest_score=signals.get(s['category'],{});affinity=min(1,interest_score.get('score',0)*math.exp(-max(0,now-interest_score.get('at',0))/(7*86400))/10)
        recent=[j for j in paid if j['category']==s['category']]
        # Don't frame recently completed work as needing another service.
        if recent and max(j.get('completed_at',0) for j in recent)>now-14*86400:continue
        familiar=bool(recent);rotation=int(hashlib.sha256((str(int(now//86400))+c['id']).encode()).hexdigest()[:6],16)/0xffffff
        score=0.65*affinity+0.20*familiar+0.10*min(.1,c['discount_paise']/max(1,s['price_paise']))/.1+0.05*rotation
        out.append(dict(home_service=s.get('home_service'),event_name=c.get('event_name',''),layout=c.get('layout','compact'),image_alt=c.get('image_alt',''),image_url='/api/operations/campaign-media/'+c['image_id'] if c.get('image_id') else None,launch_only=placement=='launch',id=c['id'],version=c['version'],title=c['title'],body=c['body'],icon=c['icon'],tone=c['tone'],terms=c['terms'],ends_at=c['ends_at'],discount_paise=c['discount_paise'],price_paise=s['price_paise'],offer_price_paise=s['price_paise']-c['discount_paise'],per_user_limit=c['per_user_limit'],service={k:s[k] for k in ('id','name','category','description','price_paise','duration_minutes','included','excluded')},reason='Based on your saved interests' if affinity else 'For returning customers' if familiar else 'Available in your city',_score=score))
    # Diversity avoids repeating the same category throughout a carousel.
    out.sort(key=lambda x:(-x['_score'],x['id']));selected=[];seen=set()
    for row in out:
        if row['service']['category'] not in seen:selected.append(row);seen.add(row['service']['category'])
    selected+=( [row for row in out if row not in selected] )
    for row in selected:row.pop('_score',None)
    return selected[:8]

def reserve_discount(u,j,uid,campaign_id,service,city,now):
    c=u.get('campaigns',campaign_id)
    if not c or c['service_id']!=service['id'] or not eligible(u,c,service,uid,city,now):fail('OFFER_UNAVAILABLE','This offer changed, ended, or reached its limit. Remove it to book at the displayed regular price.',409)
    discount=c['discount_paise'];c['reserved_paise']=c.get('reserved_paise',0)+discount;c['redemptions']=c.get('redemptions',0)+1;u.put('campaigns',c['id'],c)
    u.put('campaign_redemptions',j['id'],dict(id=j['id'],campaign_id=c['id'],user_id=uid,discount_paise=discount,at=now,status='reserved'))
    j.update(promotion_discount_paise=discount,promotion={'id':c['id'],'version':c['version'],'title':c['title'],'terms':c['terms'],'discount_paise':discount,'minimum_margin_bps':controls(u)['minimum_margin_bps'],'risk_cost_bps':controls(u)['risk_cost_bps']},total_paise=j['total_paise']-discount)
    # Do not release reservation on cancellation/refund automatically: prevents reuse races and budget overspend.

def delivery_allowed(u,n,device,now):
    p=prefs(u,n['user_id']);c=u.get('campaigns',n.get('campaign_id',''));cfg=controls(u);minute=datetime.fromtimestamp(now,IST).hour*60+datetime.fromtimestamp(now,IST).minute
    limit=min(cfg['daily_cap'],p.get('daily_cap',0))
    allowed=bool(cfg['enabled'] and cfg['push_enabled'] and p.get('push') and limit>0 and c and c.get('active') and n.get('campaign_version')==c['version'] and c['ends_at']>now and n.get('expires_at',0)>now and 480<=minute<1380 and n['campaign_id'] not in p.get('dismissed',{}) and device.get('audience')=='customer' and device.get('promotional_capable'))
    if not allowed:return False
    # A reduced cap also suppresses messages already queued for a later slot.
    earlier=sum(row.get('destination')=='promotion' and row.get('user_id')==n['user_id'] and row.get('local_date')==n['local_date'] and (row['created_at'],row['id'])<(n['created_at'],n['id']) for row in u.all('notifications'))
    return earlier<limit

def install(core):
    r=APIRouter(prefix='/operations',tags=['Campaigns']);store=core.operations_store
    def catalog():return core.catalog()
    @r.post('/admin/campaign-media')
    async def image_upload(request:Request,admin=Depends(core.operator)):
        from workspace import photo_body
        if not os.getenv('REPAIDO_PROFILE_BUCKET'):fail('STORAGE_UNAVAILABLE','Campaign image storage is unavailable. Your text draft can still be saved.',503)
        def quota(u):
            if sum(m['created_at']>time.time()-86400 for m in u.all('campaign_media'))>=40:fail('UPLOAD_LIMIT','Daily campaign upload limit reached.',429)
        store.run(quota);data=await photo_body(request);mid=str(uuid.uuid4());key='campaigns/'+mid
        try:
            from google.cloud import storage
            storage.Client().bucket(os.environ['REPAIDO_PROFILE_BUCKET']).blob(key).upload_from_string(data,content_type='image/jpeg',if_generation_match=0)
        except Exception:fail('UPLOAD_FAILED','Campaign image could not upload. Retry the image; your draft is unchanged.',503)
        def save(u):
            u.put('campaign_media',mid,dict(id=mid,object=key,created_at=time.time(),uploaded_by=admin['id']));audit(u,'CampaignImageUploaded',admin['id'],image_id=mid)
        store.run(save);return {'id':mid}
    def image_data(mid,preview=False):
        def read(u):
            m=u.get('campaign_media',mid)
            if not m or not preview and not any(c.get('image_id')==mid and c.get('active') and c['starts_at']<=time.time()<c['ends_at'] for c in u.all('campaigns')):fail('NOT_FOUND','Campaign image is not published.',404)
            return m
        m=store.run(read)
        try:
            from google.cloud import storage
            data=storage.Client().bucket(os.environ['REPAIDO_PROFILE_BUCKET']).blob(m['object']).download_as_bytes()
        except Exception:fail('IMAGE_UNAVAILABLE','Campaign image unavailable.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store' if preview else 'public,max-age=300','X-Content-Type-Options':'nosniff'})
    @r.get('/campaign-media/{mid}')
    def image_public(mid:str):return image_data(mid)
    @r.get('/admin/campaign-media/{mid}')
    def image_preview(mid:str,admin=Depends(core.operator)):return image_data(mid,True)
    @r.get('/admin/campaigns')
    def admin_view(admin=Depends(core.operator)):
        return store.run(lambda u:{'controls':controls(u),'campaigns':u.all('campaigns'),'notification_counts':{status:sum(d.get('status')==status and d.get('kind')=='promotion' for d in u.all('deliveries')) for status in ('pending','done')},'configured_push':__import__('integrations').enabled('REPAIDO_PUSH_ENABLED')})
    @r.put('/admin/campaign-controls')
    def admin_controls(body:Controls,admin=Depends(core.operator)):
        def save(u):
            if controls(u)['version']!=body.version:fail('VERSION_CHANGED','Refresh Global Control before saving.')
            saved={**body.model_dump(),'version':body.version+1};u.put('campaign_controls','current',saved);audit(u,'CampaignControlsChanged',admin['id']);return saved
        return store.run(save)
    @r.put('/admin/campaigns/{cid}')
    def upsert(cid:str,body:Campaign,admin=Depends(core.operator)):
        if not __import__('re').fullmatch(r'[a-zA-Z0-9_-]{3,80}',cid):fail('INVALID_ID','Use a short campaign ID.',422)
        s=campaign_services(catalog()).get(body.service_id)
        if not s or any(city not in core.CITIES for city in body.cities):fail('INVALID_TARGET','Choose a listed service and covered city.',422)
        def save(u):
            if body.image_id and not u.get('campaign_media',body.image_id):fail('INVALID_IMAGE','Upload a campaign image through Global Control.',422)
            old=u.get('campaigns',cid) or {};value={**body.model_dump(),'id':cid,'version':body.version+1,'updated_at':time.time()}
            if old.get('version',0)!=body.version:fail('VERSION_CHANGED','Campaign changed. Refresh before saving.')
            for key in ('reserved_paise','redemptions','impressions','opens'):value[key]=old.get(key,0)
            if value['budget_paise']<value['reserved_paise']:fail('BUDGET_COMMITTED','Budget cannot be lower than already reserved discounts.')
            if value['active'] and (value['ends_at']<=time.time() or not margin(u,value,s)):fail('UNFUNDED_OFFER','Offer does not leave the configured company margin and risk allowance after worker pay and bonus reserve. Reduce the discount or configure an accepted earnings policy.',422)
            u.put('campaigns',cid,value);audit(u,'CampaignSaved',admin['id'],campaign_id=cid,version=value['version']);return value
        return store.run(save)
    @r.post('/campaigns/feed')
    def general(body:Feed):
        data=catalog();return store.run(lambda u:{'cards':recommendations(u,data,body),'rotation_seconds':controls(u)['rotation_seconds']})
    @r.post('/campaigns/feed/personal')
    def personal(body:Feed,user=Depends(core.current_user)):
        data=catalog();return store.run(lambda u:{'cards':recommendations(u,data,body,user['id']),'rotation_seconds':controls(u)['rotation_seconds']})
    @r.get('/campaigns/preferences')
    def get_prefs(user=Depends(core.current_user)):return store.run(lambda u:prefs(u,user['id']))
    @r.put('/campaigns/preferences')
    def put_prefs(body:Preferences,user=Depends(core.current_user)):
        if body.city not in core.CITIES:fail('OUTSIDE_COVERAGE','Choose a supported city.',422)
        def save(u):
            old=prefs(u,user['id']);
            if not body.personalised:u.put('opportunity_interests',user['id'],{'signals':{}})
            row={**body.model_dump(),'user_id':user['id'],'dismissed':old.get('dismissed',{}),'updated_at':time.time()};u.put('campaign_preferences',user['id'],row);return row
        return store.run(save)
    @r.post('/campaigns/{cid}/events')
    def interact(cid:str,body:Interaction,user=Depends(core.current_user)):
        def save(u):
            c=u.get('campaigns',cid)
            if not c:fail('NOT_FOUND','Campaign is no longer available.',404)
            key=hashlib.sha256((user['id']+cid+body.kind+str(int(time.time()//86400))).encode()).hexdigest()
            if u.get('campaign_events',key):return {'recorded':False}
            if body.kind=='dismiss':
                p=prefs(u,user['id']);p.setdefault('dismissed',{})[cid]=time.time();p['dismissed']=dict(sorted(p['dismissed'].items(),key=lambda x:x[1])[-100:]);u.put('campaign_preferences',user['id'],p)
            else:
                k='impressions' if body.kind=='impression' else 'opens';c[k]=c.get(k,0)+1;u.put('campaigns',cid,c)
            u.put('campaign_events',key,dict(id=key,campaign_id=cid,kind=body.kind,at=time.time()));return {'recorded':True}
        return store.run(save)
    @r.post('/campaigns/quote')
    def quote(body:OfferQuote,user=Depends(core.current_user)):
        services={s['id']:s for s in catalog()['services']}
        def read(u):
            c=u.get('campaigns',body.campaign_id);s=services.get(body.service_id)
            if not c or c['service_id']!=body.service_id or not eligible(u,c,s,user['id'],body.city,time.time()):fail('OFFER_UNAVAILABLE','This offer is unavailable. Remove it or choose another offer.',409)
            return {'discount_paise':c['discount_paise'],'price_paise':s['price_paise']-c['discount_paise'],'terms':c['terms'],'title':c['title']}
        return store.run(read)
    def tick():
        now=time.time();local=datetime.fromtimestamp(now,IST);minute=local.hour*60+local.minute;date=local.date().isoformat();data=catalog()
        def schedule(u):
            cfg=controls(u)
            if not cfg['enabled'] or not cfg['push_enabled']:return {'queued':0}
            slots=[s for s in cfg['slots'] if s<=minute<min(s+20,1380)]
            if not slots:return {'queued':0}
            queued=0
            for p in u.all('campaign_preferences'):
                uid=p.get('user_id');slot=slots[-1]
                if not uid or not p.get('push') or not p.get('daily_cap'):continue
                nid=hashlib.sha256(f'promotion:{uid}:{date}:{slot}'.encode()).hexdigest()
                if u.get('notifications',nid):continue
                previous=[n for n in u.all('notifications') if n.get('user_id')==uid and n.get('destination')=='promotion']
                if sum(n.get('local_date')==date for n in previous)>=min(cfg['daily_cap'],p['daily_cap']):continue
                devices=sorted([d for d in u.all('devices') if d['user_id']==uid and d['active'] and d.get('audience')=='customer' and d.get('promotional_capable') and d['updated_at']>now-60*86400],key=lambda d:d['updated_at'],reverse=True)
                if not devices:continue
                seen={n['campaign_id'] for n in previous if n['created_at']>now-cfg['repeat_hours']*3600}
                cards=recommendations(u,data,Feed(placement='push',city=p['city']),uid,now)
                card=next((c for c in cards if c['id'] not in seen),None)
                if not card:continue
                expiry=min(card['ends_at'],now+3600,datetime.combine(local.date(),__import__('datetime').time(23),IST).timestamp())
                n=dict(id=nid,user_id=uid,job_id='',destination='promotion',alert_kind='promotion',title=card['title'],body=card['body'],campaign_id=card['id'],campaign_version=card['version'],created_at=now,expires_at=expiry,local_date=date)
                u.put('notifications',nid,n);did=hashlib.sha256((nid+devices[0]['id']).encode()).hexdigest();u.put('deliveries',did,dict(id=did,notification_id=nid,device_id=devices[0]['id'],kind='promotion',status='pending',created_at=now));queued+=1
                if queued>=50:break
            return {'queued':queued}
        return store.run(schedule)
    core.promotions_tick=tick;core.app.include_router(r)
