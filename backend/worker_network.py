"""Own-task search, consent-based worker connections, annual-plan messaging and communities."""
import hashlib, os, time, uuid
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import Field
from operations import Input, fail
from integrations import audit, enabled, configured, razorpay
from contract_work import public_hiring
from worker_records import public_profile

YEAR=365*86400
PLAN_PRICES={'technician':1200000,'specialist':1800000}

def network_worker(u,user):
    w=u.get('workers',user['id'])
    if not user.get('phone_verified') or not w or w.get('status')!='approved':fail('WORKER_REQUIRED','Use an approved Repaido worker account.',403)
    if (u.get('network_suspensions',user['id']) or {}).get('active'):fail('NETWORK_SUSPENDED','Network access is under review. Contact Repaido support.',403)
    return w

def pair(a,b):return hashlib.sha256(':'.join(sorted([a,b])).encode()).hexdigest()
def blocked(u,a,b):return any((u.get('network_blocks',key) or {}).get('active',False) for key in (a+':'+b,b+':'+a))
def throttle(u,uid,kind,limit,seconds=60):
    now=time.time();key=f'{uid}:{kind}:{int(now//seconds)}';r=u.get('network_limits',key) or {'count':0}
    if r['count']>=limit:fail('SLOW_DOWN','Please wait before trying again.',429)
    u.put('network_limits',key,dict(count=r['count']+1))
def notice(u,uid,title):
    key=str(uuid.uuid4());u.put('notifications',key,dict(id=key,user_id=uid,title=title,body='Open your Repaido work network.',destination='worker',created_at=time.time()))
def plan_access(u,w):
    e=u.get('network_memberships',w['id']) or {}
    if not e.get('fee_id'):return False
    fee=u.get('network_fees',e['fee_id']) or {}
    return bool(e.get('status')=='active' and e.get('role')==w.get('role') and e.get('starts_at',0)<=time.time()<e.get('ends_at',0) and fee.get('status')=='paid' and fee.get('worker_id')==w['id'] and fee.get('payment_id') and fee.get('days')==365 and fee.get('role')==w.get('role') and fee.get('amount')==PLAN_PRICES.get(w.get('role')))
def messaging(u,w):
    if not plan_access(u,w):fail('ANNUAL_PLAN_REQUIRED','A paid yearly plan is required to send messages or post in communities.',403)
def person_card(u,w):
    if not w or w.get('status')!='approved':return None
    p=u.get('worker_profiles',w['id']) or {};count=w.get('rating_count',0)
    return dict(id=w['id'],name=w['name'],city=w.get('city',''),role=w.get('role','technician'),contractor=bool(w.get('contractor_verified')),skills=w.get('skills',[]),categories=w.get('categories',[]),experience_years=w.get('experience_years',0),completed_tasks=w.get('completed_tasks',0),rating=round(w.get('rating_sum',0)/count,2) if count else None,review_count=count,bio=p.get('bio',''),portrait_url=f"/api/operations/professional-media/{p['portrait_id']}" if p.get('portrait_id') else None)
def safe_profile(u,w):
    # Published professional work summaries only. No customer address, payout, GPS or KYC.
    p=public_profile(u,w)
    return {**person_card(u,w),'languages':p['languages'],'specialties':p['specialties'],'reviews':p['reviews'],'distribution':p['distribution']}

class Connection(Input):
    action:Literal['request','accept','decline','cancel','remove']
class Text(Input):
    request_id:str=Field(min_length=16,max_length=100)
    text:str=Field(min_length=1,max_length=3000)
class Group(Input):
    request_id:str=Field(min_length=16,max_length=100)
    name:str=Field(min_length=3,max_length=100)
    description:str=Field(min_length=10,max_length=1000)
    category:str=Field(min_length=2,max_length=80)
    city:str=Field(default='',max_length=80)
class Topic(Text):
    title:str=Field(min_length=3,max_length=150)
class Report(Input):
    kind:Literal['person','message','group','post']
    target_id:str=Field(min_length=1,max_length=150)
    reason:str=Field(min_length=5,max_length=1000)
class Moderate(Input):
    action:Literal['hide','restore','suspend','unsuspend']
    reason:str=Field(min_length=5,max_length=1000)
class PlanOrder(Input):
    accepted_terms:Literal[True]
    role:Literal['technician','specialist']
    version:Literal['network-annual-v1']

def install(core):
    r=APIRouter(prefix='/operations/network',tags=['Work network']);store=core.operations_store
    @r.get('/search')
    def search(q:str=Query(default='',max_length=120),kind:Literal['all','people','contractors','projects','tasks']='all',city:str=Query(default='',max_length=80),skill:str=Query(default='',max_length=80),sort:Literal['relevant','rating','experience']='relevant',offset:int=Query(default=0,ge=0,le=10000),user=Depends(core.current_user)):
        def read(u):
            network_worker(u,user);uid=user['id'];needle=q.strip().casefold()
            def matches(values):return not needle or all(word in ' '.join(str(x) for x in values).casefold() for word in needle.split())
            workers=[w for w in u.all('workers') if w['id']!=uid and w.get('status')=='approved' and not blocked(u,uid,w['id']) and not (u.get('network_suspensions',w['id']) or {}).get('active')]
            people=[person_card(u,w) for w in workers if (kind!='contractors' or w.get('contractor_verified')) and (not city or city.casefold() in w.get('city','').casefold()) and (not skill or skill.casefold() in ' '.join(w.get('skills',[])+w.get('categories',[])).casefold()) and matches([w['name'],w.get('city'),*w.get('skills',[]),*w.get('categories',[])])]
            people.sort(key=lambda p:(-(p['rating'] or 0) if sort=='rating' else -p['experience_years'] if sort=='experience' else -p['completed_tasks'],p['name']))
            projects=[]
            for p in u.all('contract_projects'):
                owner=u.get('workers',p['owner_id']) or {};h=p.get('hiring')
                from contract_work import hiring_source_authorized
                if not h or not hiring_source_authorized(u,p) or blocked(u,uid,p['owner_id']) or (u.get('network_suspensions',p['owner_id']) or {}).get('active'):continue
                if city and city.casefold() not in h['city'].casefold():continue
                if skill and skill.casefold() not in ' '.join(h['skills']).casefold():continue
                if matches([p['title'],p['owner_name'],h['summary'],h['city'],h['area'],h['sector'],*h['skills']]):projects.append(public_hiring(p))
            projects.sort(key=lambda p:(p['hiring']['status']!='open',-p['hiring']['updated_at']))
            tasks=[{k:j.get(k) for k in ('id','service_name','category','state','starts_at','completed_at')} for j in u.all('jobs') if j.get('worker_id')==uid and matches([j['service_name'],j['id'],j['state'],j.get('category','')])]
            tasks.sort(key=lambda t:t.get('starts_at') or '',reverse=True)
            groups=[g for g in u.all('network_groups') if not g.get('hidden') and not blocked(u,uid,g['owner_id']) and matches([g['name'],g['description'],g['category'],g['city']])]
            return dict(people=people[offset:offset+24] if kind in ('all','people','contractors') else [],projects=projects[offset:offset+24] if kind in ('all','projects') else [],tasks=tasks[offset:offset+24] if kind in ('all','tasks') else [],groups=[{k:g[k] for k in ('id','name','category','city','description')} for g in groups[:12]] if kind=='all' else [],counts=dict(people=len(people),projects=len(projects),tasks=len(tasks)),offset=offset,limit=24)
        return store.run(read)
    @r.get('/people/{wid}')
    def professional(wid:str,user=Depends(core.current_user)):
        def read(u):
            network_worker(u,user);w=u.get('workers',wid)
            if not w or w.get('status')!='approved' or blocked(u,user['id'],wid) or (u.get('network_suspensions',wid) or {}).get('active'):fail('NOT_FOUND','Profile unavailable.',404)
            return dict(profile=safe_profile(u,w),projects=[public_hiring(p) for p in u.all('contract_projects') if p['owner_id']==wid and p.get('hiring')],connection=u.get('network_connections',pair(user['id'],wid)))
        return store.run(read)
    @r.get('/connections')
    def connections(user=Depends(core.current_user)):
        def read(u):
            network_worker(u,user);uid=user['id'];rows=[]
            for c in u.all('network_connections'):
                if uid not in (c['from_id'],c['to_id']) or c['status'] not in ('pending','accepted'):continue
                other=c['to_id'] if c['from_id']==uid else c['from_id']
                if not blocked(u,uid,other):rows.append({**c,'person':person_card(u,u.get('workers',other) or {})})
            return dict(connections=rows,blocked=[dict(id=b['other_id'],name=(u.get('workers',b['other_id']) or {}).get('name','Member')) for b in u.all('network_blocks') if b['owner_id']==uid and b.get('active')])
        return store.run(read)
    @r.post('/connections/{wid}')
    def connection(wid:str,body:Connection,user=Depends(core.current_user)):
        def save(u):
            network_worker(u,user);uid=user['id'];w=u.get('workers',wid)
            if wid==uid or not w or w.get('status')!='approved' or blocked(u,uid,wid):fail('UNAVAILABLE','Connection unavailable.',404)
            key=pair(uid,wid);c=u.get('network_connections',key);a=body.action
            if a=='request':
                if c and c['status'] in ('pending','accepted'):return c
                if c and time.time()-c['updated_at']<86400:fail('WAIT','Wait 24 hours before sending another request.',429)
                throttle(u,uid,'connection',20,86400);c=dict(id=key,from_id=uid,to_id=wid,status='pending',created_at=time.time());notice(u,wid,'New connection request')
            elif not c:fail('NOT_FOUND','Connection unavailable.',404)
            elif a in ('accept','decline'):
                if c['to_id']!=uid or c['status']!='pending':fail('STATE','This is not an incoming pending request.',409)
                c['status']='accepted' if a=='accept' else 'declined'
                if a=='accept':notice(u,wid,'Connection accepted')
            elif a=='cancel':
                if c['from_id']!=uid or c['status']!='pending':fail('STATE','This is not your pending request.',409)
                c['status']='cancelled'
            elif a=='remove':c['status']='removed'
            c['updated_at']=time.time();u.put('network_connections',key,c);return c
        return store.run(save)
    @r.post('/blocks/{wid}')
    def block(wid:str,user=Depends(core.current_user)):
        def save(u):
            network_worker(u,user)
            if user['id']==wid:fail('INVALID','Choose another member.',422)
            u.put('network_blocks',user['id']+':'+wid,dict(owner_id=user['id'],other_id=wid,active=True,at=time.time()))
            from repaidians_network import disconnect
            disconnect(u,user['id'],wid,reason='blocked')
            return dict(blocked=True)
        return store.run(save)
    @r.delete('/blocks/{wid}')
    def unblock(wid:str,user=Depends(core.current_user)):
        def save(u):
            network_worker(u,user);u.put('network_blocks',user['id']+':'+wid,dict(owner_id=user['id'],other_id=wid,active=False,at=time.time()));return dict(blocked=False)
        return store.run(save)
    def conversation(u,uid,wid):
        c=u.get('network_connections',pair(uid,wid)) or {};other=u.get('workers',wid) or {}
        if blocked(u,uid,wid) or other.get('status')!='approved' or (u.get('network_suspensions',wid) or {}).get('active') or c.get('status')!='accepted':fail('CONNECTION_REQUIRED','Accept a connection before messaging. Blocked connections cannot chat.',403)
        return pair(uid,wid)
    @r.get('/inbox')
    def inbox(user=Depends(core.current_user)):
        def read(u):
            network_worker(u,user);uid=user['id'];threads={}
            for m in u.all('network_messages'):
                if uid not in (m['sender_id'],m['recipient_id']) or m.get('hidden'):continue
                other=m['recipient_id'] if m['sender_id']==uid else m['sender_id']
                if blocked(u,uid,other):continue
                if other not in threads or threads[other]['at']<m['at']:threads[other]=dict(person=person_card(u,u.get('workers',other) or {}),at=m['at'],preview=m['text'][:90])
            return dict(threads=sorted(threads.values(),key=lambda m:m['at'],reverse=True))
        return store.run(read)
    @r.get('/messages/{wid}')
    def messages(wid:str,before:float|None=None,user=Depends(core.current_user)):
        def read(u):
            w=network_worker(u,user);cid=conversation(u,w['id'],wid)
            rows=sorted([m for m in u.all('network_messages') if m['conversation_id']==cid and not m.get('hidden') and (before is None or m['at']<before)],key=lambda m:m['at'])
            return dict(messages=rows[-60:],has_older=len(rows)>60,can_send=plan_access(u,w))
        return store.run(read)
    @r.post('/messages/{wid}')
    def send(wid:str,body:Text,user=Depends(core.current_user)):
        def save(u):
            w=network_worker(u,user);messaging(u,w);cid=conversation(u,w['id'],wid);key=hashlib.sha256((user['id']+':'+body.request_id).encode()).hexdigest();old=u.get('network_messages',key)
            if not body.text.strip():fail('EMPTY','Write a message first.',422)
            if old:
                if old['recipient_id']!=wid or old['text']!=body.text.strip():fail('REQUEST_REUSED','Use a fresh request for a changed message.',409)
                return old
            throttle(u,w['id'],'message',30);row=dict(id=key,conversation_id=cid,sender_id=w['id'],recipient_id=wid,text=body.text.strip(),at=time.time());u.put('network_messages',key,row);notice(u,wid,'New work-network message');return row
        return store.run(save)
    def group_access(u,gid,uid,member=False):
        g=u.get('network_groups',gid)
        if not g or g.get('hidden') or blocked(u,uid,g['owner_id']):fail('NOT_FOUND','Community unavailable.',404)
        if member and uid not in g['members']:fail('JOIN_REQUIRED','Join this community to participate.',403)
        return g
    def group_view(g,uid):return {**{k:v for k,v in g.items() if k!='members'},'member_count':len(g['members']),'joined':uid in g['members']}
    @r.get('/groups')
    def groups(user=Depends(core.current_user)):
        def read(u):
            network_worker(u,user);return dict(groups=[group_view(g,user['id']) for g in u.all('network_groups') if not g.get('hidden') and not blocked(u,user['id'],g['owner_id'])])
        return store.run(read)
    @r.post('/groups')
    def create_group(body:Group,user=Depends(core.current_user)):
        def save(u):
            w=network_worker(u,user);messaging(u,w);key=hashlib.sha256((w['id']+':'+body.request_id).encode()).hexdigest();old=u.get('network_groups',key)
            payload=body.model_dump(exclude={'request_id'})
            if old:
                if any(old[k]!=v for k,v in payload.items()):fail('REQUEST_REUSED','Use a new request for changed community details.',409)
                return group_view(old,w['id'])
            throttle(u,w['id'],'group',3,86400);g=dict(**payload,id=key,owner_id=w['id'],owner_name=w['name'],members=[w['id']],created_at=time.time());u.put('network_groups',key,g);return group_view(g,w['id'])
        return store.run(save)
    @r.post('/groups/{gid}/join')
    def join(gid:str,user=Depends(core.current_user)):
        def save(u):
            network_worker(u,user);g=group_access(u,gid,user['id'])
            if user['id'] not in g['members']:
                if len(g['members'])>=1000:fail('FULL','Community is full.',409)
                g['members'].append(user['id']);u.put('network_groups',gid,g)
            return group_view(g,user['id'])
        return store.run(save)
    @r.post('/groups/{gid}/leave')
    def leave(gid:str,user=Depends(core.current_user)):
        def save(u):
            network_worker(u,user);g=group_access(u,gid,user['id'])
            if g['owner_id']==user['id']:fail('OWNER','The community owner cannot leave their own community.',409)
            g['members']=[x for x in g['members'] if x!=user['id']];u.put('network_groups',gid,g);return group_view(g,user['id'])
        return store.run(save)
    @r.get('/groups/{gid}/posts')
    def posts(gid:str,user=Depends(core.current_user)):
        def read(u):
            network_worker(u,user);g=group_access(u,gid,user['id']);rows=[p for p in u.all('network_posts') if p['group_id']==gid and not p.get('hidden') and not blocked(u,user['id'],p['author_id'])]
            rows.sort(key=lambda p:p['at'],reverse=True);return dict(group=group_view(g,user['id']),posts=[{**p,'replies':[reply for reply in p['replies'] if not blocked(u,user['id'],reply['author_id'])]} for p in rows[:150]])
        return store.run(read)
    @r.post('/groups/{gid}/posts')
    def post(gid:str,body:Topic,user=Depends(core.current_user)):
        def save(u):
            w=network_worker(u,user);messaging(u,w);group_access(u,gid,user['id'],True);key=hashlib.sha256((w['id']+':'+body.request_id).encode()).hexdigest();old=u.get('network_posts',key)
            if old:
                if old['group_id']!=gid or old['text']!=body.text or old['title']!=body.title:fail('REQUEST_REUSED','Use a new request for changed post content.',409)
                return old
            if not body.text.strip():fail('EMPTY','Write a post first.',422)
            throttle(u,w['id'],'post',10);row=dict(id=key,group_id=gid,author_id=w['id'],author_name=w['name'],title=body.title,text=body.text,at=time.time(),replies=[]);u.put('network_posts',key,row);return row
        return store.run(save)
    @r.post('/posts/{pid}/replies')
    def reply(pid:str,body:Text,user=Depends(core.current_user)):
        def save(u):
            w=network_worker(u,user);messaging(u,w);p=u.get('network_posts',pid)
            if not p or p.get('hidden') or blocked(u,w['id'],p['author_id']):fail('NOT_FOUND','Discussion unavailable.',404)
            group_access(u,p['group_id'],w['id'],True)
            old=next((x for x in p['replies'] if x['id']==body.request_id and x['author_id']==w['id']),None)
            if old:
                if old['text']!=body.text:fail('REQUEST_REUSED','Use a new request for a changed reply.',409)
                return p
            if len(p['replies'])>=200:fail('FULL','Start a new discussion to continue.',409)
            if not body.text.strip():fail('EMPTY','Write a reply first.',422)
            throttle(u,w['id'],'post',10);p['replies'].append(dict(id=body.request_id,author_id=w['id'],author_name=w['name'],text=body.text,at=time.time()));u.put('network_posts',pid,p);return p
        return store.run(save)
    @r.post('/posts/{pid}/hide')
    def hide_post(pid:str,user=Depends(core.current_user)):
        def save(u):
            network_worker(u,user);p=u.get('network_posts',pid)
            if not p:fail('NOT_FOUND','Post unavailable.',404)
            g=group_access(u,p['group_id'],user['id'])
            if user['id'] not in (g['owner_id'],p['author_id']):fail('FORBIDDEN','Only the author or community owner can remove this post.',403)
            p['hidden']=True;u.put('network_posts',pid,p);return dict(hidden=True)
        return store.run(save)
    @r.post('/reports')
    def report(body:Report,user=Depends(core.current_user)):
        def save(u):
            network_worker(u,user);throttle(u,user['id'],'report',10,3600);key=str(uuid.uuid4());u.put('network_reports',key,dict(id=key,reporter_id=user['id'],**body.model_dump(),at=time.time(),status='open'));return dict(id=key,status='open')
        return store.run(save)
    @r.get('/admin/reports')
    def reports(admin=Depends(core.operator)):
        def read(u):
            rows=[]
            for report in u.all('network_reports'):
                kind={'person':'workers','message':'network_messages','group':'network_groups','post':'network_posts'}[report['kind']]
                content=u.get(kind,report['target_id']) or {}
                # Review only the reported content, never unrelated private conversations or KYC.
                context={k:content[k] for k in ('name','text','title','description','author_name','at','hidden') if k in content}
                rows.append({**report,'context':context})
            return dict(reports=sorted(rows,key=lambda row:row['at'],reverse=True)[:200])
        return store.run(read)
    @r.post('/admin/reports/{rid}')
    def moderate(rid:str,body:Moderate,admin=Depends(core.operator)):
        def save(u):
            report=u.get('network_reports',rid)
            if not report:fail('NOT_FOUND','Report unavailable.',404)
            if body.action in ('suspend','unsuspend'):
                if report['kind']!='person':fail('INVALID','Choose a member report.',422)
                u.put('network_suspensions',report['target_id'],dict(active=body.action=='suspend',reason=body.reason,at=time.time()))
            else:
                kind={'message':'network_messages','group':'network_groups','post':'network_posts'}.get(report['kind']);row=u.get(kind,report['target_id']) if kind else None
                if not row:fail('NOT_FOUND','Content unavailable.',404)
                row['hidden']=body.action=='hide';u.put(kind,report['target_id'],row)
            report.update(status='reviewed',decision=body.action,review_note=body.reason);u.put('network_reports',rid,report);audit(u,'NetworkModerated',admin['id'],report_id=rid,decision=body.action);return report
        return store.run(save)
    @r.get('/plan')
    def plan(user=Depends(core.current_user)):
        def read(u):
            w=network_worker(u,user);e=u.get('network_memberships',w['id'])
            return dict(user_id=w['id'],version='network-annual-v1',role=w['role'],prices=PLAN_PRICES,days=365,gst_included=True,active=plan_access(u,w),membership=e,checkout_ready=enabled('REPAIDO_PAYMENTS_ENABLED') and configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'),terms='One prepaid year from confirmed payment. GST included. No auto-renewal. Sending private messages, creating communities and posting or replying requires an active plan. Connections, search and project applications are free. Payment does not guarantee projects, ratings or hiring. Refund requests go through Repaido support.')
        return store.run(read)
    @r.post('/plan/order')
    def order(body:PlanOrder,user=Depends(core.current_user)):
        if not enabled('REPAIDO_PAYMENTS_ENABLED') or not configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):fail('CHECKOUT_UNAVAILABLE','Annual plans are configured; payment checkout is not enabled yet. No charge was made.',503)
        def reserve(u):
            w=network_worker(u,user)
            if w['role']!=body.role:fail('ROLE_CHANGED','Refresh your approved role before choosing a plan.',409)
            if plan_access(u,w):fail('ALREADY_ACTIVE','Your annual plan is already active.',409)
            e=u.get('network_memberships',w['id']) or {};key=hashlib.sha256(f"{w['id']}:{w['role']}:{e.get('ends_at',0)}".encode()).hexdigest();old=u.get('network_fees',key)
            if old:return old,False
            fee=dict(id=key,worker_id=w['id'],role=w['role'],days=365,amount=PLAN_PRICES[w['role']],gst_included=True,receipt='nw_'+uuid.uuid4().hex[:30],status='creating',version=body.version,created_at=time.time(),accepted_at=time.time());u.put('network_fees',key,fee);return fee,True
        fee,new=store.run(reserve)
        if new:
            result=razorpay('orders',{'amount':fee['amount'],'currency':'INR','receipt':fee['receipt'],'notes':{'network_annual':fee['worker_id'],'role':fee['role']}})
            if result.get('amount')!=fee['amount'] or result.get('currency')!='INR' or result.get('receipt')!=fee['receipt']:fail('PROVIDER_MISMATCH','Payment order needs reconciliation.',503)
            def attach(u):
                f=u.get('network_fees',fee['id']);f.update(order_id=result['id'],status='created');u.put('network_fees',f['id'],f);return f
            fee=store.run(attach)
        if not fee.get('order_id'):fail('RECONCILING','Check payment before retrying. A previous order is being reconciled.',409)
        if fee.get('status')=='refunded':fail('REFUNDED','This payment was refunded. Contact support before purchasing again.',409)
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'],order_id=fee['order_id'],amount=fee['amount'],currency='INR')
    def reconcile(fee):
        if not fee.get('order_id'):
            rows=[o for o in razorpay('orders?receipt='+fee['receipt']).get('items',[]) if o.get('receipt')==fee['receipt'] and o.get('amount')==fee['amount'] and o.get('currency')=='INR']
            if len(rows)!=1:return
            def recover(u):
                f=u.get('network_fees',fee['id']);f['order_id']=rows[0]['id'];u.put('network_fees',f['id'],f);return f
            fee=store.run(recover)
        for pay in razorpay('orders/'+fee['order_id']+'/payments').get('items',[]):
            if pay.get('order_id')!=fee['order_id'] or pay.get('amount')!=fee['amount'] or pay.get('currency')!='INR':continue
            if pay.get('status') not in ('captured','refunded'):continue
            def apply(u):
                f=u.get('network_fees',fee['id']);e=u.get('network_memberships',f['worker_id'])
                if pay.get('amount_refunded',0) or pay['status']=='refunded':
                    f['status']='refunded'
                    if e and e.get('fee_id')==f['id']:e['status']='refunded';u.put('network_memberships',f['worker_id'],e)
                elif pay.get('captured') is True and f['status']!='refunded':
                    if f.get('payment_id') and f['payment_id']!=pay['id']:fail('DUPLICATE_PAYMENT','A duplicate payment needs support review.',409)
                    if f['status']!='paid':
                        now=time.time();f.update(status='paid',payment_id=pay['id'],paid_at=now);u.put('network_memberships',f['worker_id'],dict(worker_id=f['worker_id'],role=f['role'],fee_id=f['id'],starts_at=now,ends_at=now+YEAR,status='active'));audit(u,'NetworkAnnualPlanPaid','razorpay',worker_id=f['worker_id'],fee_id=f['id'])
                f['checked_at']=time.time();u.put('network_fees',f['id'],f)
            store.run(apply)
    @r.post('/plan/check')
    def check(user=Depends(core.current_user)):
        def read(u):
            network_worker(u,user);throttle(u,user['id'],'plan_check',4);return [f for f in u.all('network_fees') if f['worker_id']==user['id'] and f['status']!='refunded']
        for fee in store.run(read):reconcile(fee)
        return plan(user)
    def tick():
        if not enabled('REPAIDO_PAYMENTS_ENABLED'):return dict(checked=0)
        fees=store.run(lambda u:[f for f in u.all('network_fees') if f['status']!='refunded' and time.time()-f.get('checked_at',0)>300 and (f['status']!='paid' or f.get('paid_at',0)+YEAR>time.time())][:25]);count=0
        for fee in fees:
            try:reconcile(fee);count+=1
            except Exception:pass
        return dict(checked=count)
    core.network_tick=tick
    core.app.include_router(r)
