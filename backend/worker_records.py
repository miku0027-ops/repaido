"""Own-account work records and public professional profiles; no public contact/GPS/KYC."""
import io, os, time, uuid
from datetime import datetime, timezone, timedelta
import calendar, re
from html import escape
from typing import Literal
from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field
from operations import Input, fail
from integrations import audit
from workspace import photo_body
from evidence import upload_object, download_object

class Profile(Input):
    bio: str = Field(default='', max_length=1000)
    languages: list[str] = Field(default_factory=list, max_length=10)
    specialties: list[str] = Field(default_factory=list, max_length=20)
    portrait_id: str | None = None
    cover_id: str | None = None

def public_profile(u, w, jobs=None):
    profile=u.get('worker_profiles',w['id']) or {}
    reviews=[]
    for j in (u.all('jobs') if jobs is None else jobs):
        if j.get('worker_id')==w['id'] and j['state']=='completed' and j.get('review'):
            r=j['review']
            reviews.append(dict(service=j['service_name'],rating=r['rating'],text=r.get('text',''),at=r.get('created_at',j.get('completed_at')),reply=(r.get('worker_reply') or {}).get('text'),verified=True))
    return {**{k:w.get(k) for k in ('id','name','role','city','categories','skills','tools','experience_years','radius_km','completed_tasks')},
        'bio':profile.get('bio',''),'languages':profile.get('languages',[]),'specialties':profile.get('specialties',[]),
        'portrait_url':f"/api/operations/professional-media/{profile['portrait_id']}" if profile.get('portrait_id') else None,
        'cover_url':f"/api/operations/professional-media/{profile['cover_id']}" if profile.get('cover_id') else None,
        'verification':'Team-reviewed professional','reviews':sorted(reviews,key=lambda r:r['at'] or 0,reverse=True)[:20],
        'rating':sum(r['rating'] for r in reviews)/len(reviews) if reviews else None,'review_count':len(reviews),
        'distribution':{str(i):sum(r['rating']==i for r in reviews) for i in range(1,6)}}

def task_record(u,j):
    settlement=u.get('settlements',j['id']);payout=u.get('payouts',j['id'])
    # Explicit allowlists: no bank account, private documents, home address or raw GPS in reports.
    return {**{k:j.get(k) for k in ('id','service_name','category','state','starts_at','created_at','accepted_at','reminder_at','reminder_ack_at','departed_at','started_at','completed_at','completion_notes','work_seconds','visit_id','payment_status','payout_status','base_price_paise','total_paise','terms','service_terms','settlement_policy')},
        'penalties':j.get('penalties',[]),'events':j.get('events',[]),'review':j.get('review'),
        'parts_assessments':[{k:o.get(k) for k in ('id','assessment_paise','assessment_status','assessment_reason','assessment_reviewed_at','picked_up_at','returned_at')} for oid in j.get('parts_order_ids',[]) if (o:=u.get('parts_orders',oid))],
        'settlement':{k:settlement.get(k) for k in ('gross_paise','deduction_paise','net_paise','vendor_discount_paise','status','created_at','bonus_reserve_paise','travel_reimbursement_paise','hire_bonus_paise')} if settlement else None,
        'payout':{k:payout.get(k) for k in ('status','amount_paise','checked_at','utr')} if payout else None,
        'schedule_history':j.get('schedule_history',[]),'points_awarded':j.get('points_awarded',10 if j.get('state')=='completed' else 0), 'generated_at':time.time()}

IST = timezone(timedelta(hours=5, minutes=30))

def profile_progress(u, w):
    p = u.get('worker_profiles', w['id']) or {}
    v = u.get('verification', w['id']) or {}
    portrait = u.get('worker_media', p['portrait_id']) if p.get('portrait_id') else None
    checks = [
        ('name', 'Legal name', bool(w.get('name')), 'application'),
        ('dob', 'Date of birth', bool(w.get('dob')), 'application'),
        ('address', 'Service address', bool(w.get('city') and w.get('home_address') and w.get('location')), 'application'),
        ('skills', 'Skills & categories', bool(w.get('skills') and w.get('categories')), 'application'),
        ('tools', 'Tools & experience', bool(w.get('tools') and w.get('experience_years') is not None), 'application'),
        ('portrait', 'Profile photo', bool(portrait and portrait.get('worker_id') == w['id'] and portrait.get('kind') == 'portrait'), 'edit'),
        ('bio', 'About your work', bool(p.get('bio', '').strip()), 'edit'),
        ('languages', 'Languages', any(str(x).strip() for x in p.get('languages', [])), 'edit'),
        ('identity', 'Identity review', v.get('identity_status') == 'approved', 'verification'),
    ]
    completed = sum(bool(c[2]) for c in checks)
    return dict(percent=round(completed / len(checks) * 100),
                verified=completed == len(checks) and w.get('status') == 'approved',
                missing=[dict(id=c[0], label=c[1], target=c[3]) for c in checks if not c[2]],
                approval_status=w.get('status'))

def calendar_record(u, w, month):
    if not re.fullmatch(r'20[0-9]{2}-(0[1-9]|1[0-2])', month):
        fail('INVALID_MONTH', 'Choose a valid calendar month.', 422)
    year, mon = map(int, month.split('-'))
    def day_key(value):
        if value is None: return None
        try:
            d = datetime.fromtimestamp(value, IST) if isinstance(value, (int, float)) else datetime.fromisoformat(value).astimezone(IST)
            return d.date().isoformat()
        except (ValueError, TypeError): return None
    days = {f'{month}-{n:02d}': dict(date=f'{month}-{n:02d}', tasks=[], presence=[], points=0, earned_paise=0, paid_paise=0, deduction_paise=0, completed=0, reviews=[]) for n in range(1, calendar.monthrange(year, mon)[1]+1)}
    tasks = [j for j in u.all('jobs') if j.get('worker_id') == w['id']]
    completed = []
    for j in tasks:
        r = task_record(u, j)
        completed_day = day_key(j.get('completed_at'))
        scheduled = day_key(j.get('starts_at'))
        history = j.get('schedule_history', [])
        touched = {scheduled, completed_day}
        touched.update(day_key(h.get('from')) for h in history)
        touched.update(day_key(e.get('occurred_at_server_time')) for e in j.get('events', []))
        for key in touched:
            if key in days: days[key]['tasks'].append(r)
        if completed_day in days and j.get('state') == 'completed':
            d = days[completed_day]; d['completed'] += 1
            # The original completion command has always awarded 10 points. New jobs persist the award explicitly.
            d['points'] += j.get('points_awarded', 10)
            settlement = r['settlement']
            if settlement:
                d['earned_paise'] += settlement.get('net_paise') or 0
                d['deduction_paise'] += settlement.get('deduction_paise') or 0
            if r['review']: d['reviews'].append(r['review'])
            completed.append(r)
        payout = r.get('payout')
        if payout and payout.get('status') in ('processed', 'paid'):
            journal = u.get('journals', 'payout_'+j['id']) or {}
            key = day_key(journal.get('posted_at') or payout.get('checked_at'))
            if key in days: days[key]['paid_paise'] += payout.get('amount_paise') or 0
    for sample in u.all('availability_samples'):
        if sample.get('worker_id') == w['id'] and day_key(sample.get('at')) in days:
            days[day_key(sample['at'])]['presence'].append(dict(at=sample['at'], online=True, kind='location_check'))
    for e in u.all('availability_events'):
        if e.get('worker_id') == w['id'] and day_key(e.get('at')) in days:
            days[day_key(e['at'])]['presence'].append(dict(at=e['at'], online=e['online'], kind='status_change'))
    for d in days.values():
        d['presence'].sort(key=lambda x: x['at'])
        d['online_recorded'] = any(x['online'] for x in d['presence'])
        d['offline_recorded'] = any(not x['online'] for x in d['presence'])
        d['tone'] = 'mixed' if d['deduction_paise'] and d['earned_paise'] else 'penalty' if d['deduction_paise'] else 'earning' if d['earned_paise'] else 'worked' if d['completed'] else 'online' if d['online_recorded'] else 'offline' if d['offline_recorded'] else 'scheduled' if d['tasks'] else 'unknown'
    settled = [r for r in completed if r['settlement']]
    reviewed = [r for r in completed if r['review']]
    components = []
    if settled: components.append(dict(label='Settled work without deductions', weight=60, value=round(100*sum(not (r['settlement'].get('deduction_paise') or 0) for r in settled)/len(settled)), count=len(settled)))
    if reviewed: components.append(dict(label='Customer ratings', weight=40, value=round(20*sum(r['review']['rating'] for r in reviewed)/len(reviewed)), count=len(reviewed)))
    score = round(sum(c['value']*c['weight'] for c in components)/sum(c['weight'] for c in components)) if components else None
    tips = []
    if any((r['settlement'] or {}).get('deduction_paise', 0) for r in completed): tips.append('Open assessed tasks, check the reason and agreed work rules. Dispute an incorrect deduction through task support.')
    if any(r['review']['rating'] < 4.5 for r in reviewed): tips.append('Read recent feedback, confirm the scope before starting, and explain the completed checks to your customer.')
    if not settled: tips.append('Completed work needs a calculated settlement before the deduction-free measure is available.')
    if not reviewed: tips.append('Customer ratings appear after customers review completed bookings. Missing reviews do not reduce your score.')
    if score is not None and score >= 85: tips.append('You are at the 85% target. Keep clear work notes, respond to task reminders and maintain your service quality.')
    return dict(month=month, timezone='Asia/Kolkata', days=list(days.values()), score=score, components=components, suggestions=tips,
                score_note='Work quality indicator, not pay or a penalty rule. 60% settled work without deductions + 40% customer ratings. Missing measures are excluded and remaining weights are normalized. Online/offline time never lowers this score.',
                summary=dict(completed=len(completed), points=sum(d['points'] for d in days.values()), earned_paise=sum(d['earned_paise'] for d in days.values()), paid_paise=sum(d['paid_paise'] for d in days.values()), deduction_paise=sum(d['deduction_paise'] for d in days.values()), online_days=sum(d['online_recorded'] for d in days.values()), offline_days=sum(d['offline_recorded'] for d in days.values()), working_days=sum(bool(d['completed']) for d in days.values())))

def stamp(value):
    if not value:return 'Not recorded'
    return datetime.fromtimestamp(value,timezone.utc).strftime('%d %b %Y, %H:%M:%S UTC') if isinstance(value,(float,int)) else str(value)

def report_pdf(record):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    styles=getSampleStyleSheet();styles['BodyText'].fontSize=9;styles['BodyText'].leading=13
    styles['Heading1'].textColor=colors.HexColor('#10235A');styles['Heading2'].fontSize=12
    def p(t):return Paragraph(escape(str(t)).replace('\n','<br/>'),styles['BodyText'])
    out=io.BytesIO();doc=SimpleDocTemplate(out,pagesize=A4,rightMargin=40,leftMargin=40,topMargin=40,bottomMargin=40)
    blocks=[Paragraph('Repaido | Task & earnings record',styles['Heading1']),p(record['service_name']),p('Task '+record['id']),p('Generated '+stamp(record['generated_at'])),Spacer(1,16)]
    def section(title,rows):
        table=Table([[p(a),p(b)] for a,b in rows],colWidths=[145,370],hAlign='LEFT')
        table.setStyle(TableStyle([('BOX',(0,0),(-1,-1),.6,colors.HexColor('#C8D3E5')),('INNERGRID',(0,0),(-1,-1),.35,colors.HexColor('#DFE5EF')),('BACKGROUND',(0,0),(0,-1),colors.HexColor('#F3F6FA')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
        blocks.extend([Paragraph(title,styles['Heading2']),table,Spacer(1,12)])
    section('Task outcome',[(k.replace('_',' ').title(),record.get(k) or 'Not recorded') for k in ('state','starts_at','completion_notes','payment_status','payout_status')])
    section('Visit SLA timestamps',[(k.replace('_',' ').title(),stamp(record.get(k))) for k in ('accepted_at','reminder_at','reminder_ack_at','departed_at','started_at','completed_at')])
    s=record.get('settlement')
    section('Earnings & deductions',[(k.replace('_paise','').replace('_',' ').title(),f'INR {s.get(k,0)/100:.2f}') for k in ('gross_paise','deduction_paise','travel_reimbursement_paise','hire_bonus_paise','net_paise','bonus_reserve_paise')] if s else [('Settlement','Not calculated. Completion is not proof of payment or payout.')])
    section('Agreed work SLA',[(k.replace('_',' ').title(),str(v)) for k,v in (record.get('terms') or {}).items()] or [('Terms','No snapshot recorded')])
    section('Earnings policy',[(k.replace('_',' ').title(),str(v)) for k,v in (record.get('settlement_policy') or {}).items() if k!='reason'] or [('Policy','No accepted snapshot recorded')])
    for i,penalty in enumerate(record['penalties']):
        section(f'Penalty assessment {i+1}',[(k.replace('_',' ').title(),stamp(v) if k.endswith('_at') else str(v)) for k,v in penalty.items() if k!='worker_id'])
    if not record['penalties']:blocks.append(p('No task penalty assessments recorded.'))
    for a in record['parts_assessments']:
        if a.get('assessment_paise'):section('Parts-return assessment',[(k.replace('_',' ').title(),v) for k,v in a.items()])
    r=record.get('review')
    section('Customer review',[('Rating',str(r['rating'])+'/5'),('Feedback',r.get('text',''))] if r else [('Review','No customer review yet.')])
    section('Event timeline',[(stamp(e['occurred_at_server_time']),e['event_type']) for e in record['events']] or [('Events','None recorded')])
    blocks.extend([p('Assessments are separate from actual ledger deductions. The accepted earnings policy determines deductions; percentages must not be added together.'),p('This is a task record, not a tax invoice. Report a disputed assessment using task support.')])
    def footer(c,d):c.setFont('Helvetica',8);c.drawString(40,22,'Repaido - private worker record');c.drawRightString(A4[0]-40,22,f'Page {d.page}')
    doc.build(blocks,onFirstPage=footer,onLaterPages=footer);return out.getvalue()

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations',tags=['Worker records'])
    def own(u,user):
        w=u.get('workers',user['id'])
        if not w or not user.get('phone_verified'):fail('WORKER_REQUIRED','Sign in with your registered worker phone.',403)
        return w
    @r.get('/worker/profile-progress')
    def progress(user=Depends(core.current_user)):
        return store.run(lambda u:profile_progress(u,own(u,user)))
    @r.get('/worker/calendar')
    def calendar_view(month:str,user=Depends(core.current_user)):
        return store.run(lambda u:calendar_record(u,own(u,user),month))
    @r.get('/worker/records')
    def records(user=Depends(core.current_user)):
        def read(u):
            w=own(u,user);rows=[task_record(u,j) for j in u.all('jobs') if j.get('worker_id')==w['id']]
            rows.sort(key=lambda j:j.get('created_at') or 0,reverse=True)
            settlements=[x['settlement'] for x in rows if x['settlement']]
            return dict(tasks=rows,summary={'paid_paise':sum(x['net_paise'] for x in settlements if x['status']=='paid'),'pending_paise':sum(x['net_paise'] for x in settlements if x['status']!='paid'),'deduction_paise':sum(x['deduction_paise'] for x in settlements),'assessments':sum(len(x['penalties']) for x in rows)})
        return store.run(read)
    def report_data(jid,user):
        def read(u):
            own(u,user);j=u.get('jobs',jid)
            if not j or j.get('worker_id')!=user['id']:fail('NOT_FOUND','Task record unavailable.',404)
            audit(u,'WorkerReportViewed',user['id'],job_id=jid);return task_record(u,j)
        return store.run(read)
    @r.get('/worker/tasks/{jid}/report')
    def report(jid:str,user=Depends(core.current_user)):return report_data(jid,user)
    @r.get('/worker/tasks/{jid}/report.pdf')
    def pdf(jid:str,user=Depends(core.current_user)):
        data=report_data(jid,user)
        return Response(report_pdf(data),media_type='application/pdf',headers={'Cache-Control':'no-store','Content-Disposition':f'attachment; filename="Repaido-task-{uuid.UUID(jid)}.pdf"','X-Content-Type-Options':'nosniff'})
    @r.get('/worker/public-profile')
    def profile(user=Depends(core.current_user)):
        return store.run(lambda u:{'profile':u.get('worker_profiles',own(u,user)['id']) or {}})
    @r.put('/worker/public-profile')
    def update(body:Profile,user=Depends(core.current_user)):
        def save(u):
            own(u,user)
            for kind,mid in [('portrait',body.portrait_id),('cover',body.cover_id)]:
                if mid:
                    m=u.get('worker_media',mid)
                    if not m or m['worker_id']!=user['id'] or m['kind']!=kind:fail('INVALID_PHOTO','Use a photo uploaded to your own profile.',422)
            data={**body.model_dump(),'updated_at':time.time()};u.put('worker_profiles',user['id'],data);audit(u,'PublicProfileUpdated',user['id']);return {'profile':data}
        return store.run(save)
    @r.post('/worker/profile-photo/{kind}')
    async def photo(kind:Literal['portrait','cover'],request:Request,user=Depends(core.current_user)):
        def check(u):
            own(u,user)
            if sum(m['worker_id']==user['id'] and m['created_at']>time.time()-86400 for m in u.all('worker_media'))>=10:fail('UPLOAD_LIMIT','Daily photo limit reached. Retry tomorrow.',429)
        store.run(check)
        if not os.getenv('REPAIDO_PROFILE_BUCKET'):fail('STORAGE_UNAVAILABLE','Public profile photo storage is not configured. Your text changes can still be saved.',503)
        data=await photo_body(request);mid=str(uuid.uuid4());key='worker-profile/'+mid
        try:
            from google.cloud import storage
            blob=storage.Client().bucket(os.environ['REPAIDO_PROFILE_BUCKET']).blob(key)
            blob.cache_control='private,max-age=300';blob.upload_from_string(data,content_type='image/jpeg',if_generation_match=0)
        except Exception:fail('UPLOAD_FAILED','Photo upload failed. Retry this photo.',503)
        store.run(lambda u:u.put('worker_media',mid,dict(id=mid,worker_id=user['id'],kind=kind,object=key,created_at=time.time())))
        return {'id':mid}
    @r.get('/professionals/{wid}')
    def professional(wid:str):
        def read(u):
            w=u.get('workers',wid)
            if not w or w['status']!='approved':fail('NOT_FOUND','Professional unavailable.',404)
            return public_profile(u,w)
        return store.run(read)
    @r.get('/professional-media/{mid}')
    def media(mid:str):
        def read(u):
            m=u.get('worker_media',mid)
            if not m:fail('NOT_FOUND','Photo unavailable.',404)
            w=u.get('workers',m['worker_id']);p=u.get('worker_profiles',m['worker_id']) or {}
            if not w or w['status']!='approved' or mid not in (p.get('portrait_id'),p.get('cover_id')):fail('NOT_FOUND','Photo not published.',404)
            return m
        m=store.run(read)
        try:
            from google.cloud import storage
            data=storage.Client().bucket(os.environ['REPAIDO_PROFILE_BUCKET']).blob(m['object']).download_as_bytes()
        except Exception:fail('PHOTO_UNAVAILABLE','Photo unavailable. Retry later.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'public,max-age=300','X-Content-Type-Options':'nosniff'})
    core.app.include_router(r)
