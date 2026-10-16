"""Participant-authorized work milestones. Private source records never become posts."""
from typing import Literal
from pydantic import Field
from fastapi import Depends
from operations import Input,fail

class Reference(Input):
    source:Literal['service','home','hire','cab','shared','contract','project','scrap','cleanup']
    id:str=Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')

KINDS={'service':'jobs','home':'home_plans','hire':'hires','cab':'mobility_rides','shared':'shared_departures','contract':'contract_tenders','project':'contract_projects','scrap':'scrap_collections','cleanup':'cleanup_reports'}
CITIES={'Balasore','Bhubaneswar','Cuttack'}

def stored_reference(u,reference,uid):
    """Pin the verified passenger row privately, so feed reads stay bounded."""
    result=dict(reference)
    if reference['source']=='shared':
        row=u.get('shared_departures',reference['id']) or {}
        if uid not in (row.get('owner_id'),row.get('driver_id')):
            own=next((p for p in u.find('shared_passengers','customer_id',uid) if p.get('departure_id')==reference['id']),None)
            if own:result['passenger_id']=own['id']
    return result

def prefetch(u,references):
    u.prefetch([(KINDS[ref['source']],ref['id']) for ref in references]+[('shared_passengers',ref['passenger_id']) for ref in references if ref.get('passenger_id')])
    projects=[u.get('contract_tenders',ref['id']) for ref in references if ref['source']=='contract']
    u.prefetch([('contract_projects',row['winning_project_id']) for row in projects if row and row.get('winning_project_id')])

def preview(u,reference,uid,strict=True):
    from repaidians_opportunities import trade_for
    source,identifier=reference['source'],reference['id']
    row=u.get(KINDS[source],identifier)
    def unavailable():
        if strict:fail('MILESTONE_UNAVAILABLE','This work update is not available for your account.',404)
        return None
    if not row:return unavailable()
    people={row.get(key) for key in ('customer_id','client_id','worker_id','owner_id','driver_id','awarded_contractor_id')}-{None}
    state=row.get('state',row.get('status',''))
    if source=='shared' and uid not in people:
        own=u.get('shared_passengers',reference['passenger_id']) if reference.get('passenger_id') else next((p for p in u.find('shared_passengers','customer_id',uid) if p.get('departure_id')==identifier),None)
        if not own or own.get('customer_id')!=uid or own.get('departure_id')!=identifier or own['state'] not in ('requested','accepted','boarded','completed'):return unavailable()
        people.add(uid);state=own['state']
    if source=='project':
        people.update(p.get('worker_id') for p in row.get('team',[]) if p.get('status')=='accepted')
    if uid not in people:return unavailable()
    if state in ('draft','cancelled','declined','rejected','expired','closed','withdrawn','suspended','disputed','referred'):return unavailable()
    if source in ('scrap','cleanup'):
        city=row.get('city','');city=city if city in CITIES else ''
        if source=='scrap':
            if state!='completed' or row.get('payment_source')!='customer_confirmed_receipt':return unavailable()
            points=row.get('customer_points',0) if uid==row['customer_id'] else row.get('collector_points',0)
            return dict(source=source,title='Scrap given a second life',label='Collection completed',city=city,trade='recycling',points_earned=points)
        if row.get('category')=='hazardous':return unavailable()
        labels={'reported':'Cleanup reported · awaiting review','approved':'Cleanup approved','assigned':'Cleanup in progress','verification':'Cleanup awaiting verification','completed':'Cleanup verified'}
        if state not in labels:return unavailable()
        points=row.get('points',0) if uid==row['customer_id'] else row.get('collector_points',0)
        return dict(source=source,title='A cleaner neighbourhood',label=labels[state],city=city,trade='recycling',points_earned=points if state=='completed' else 0)
    title={'service':'Service visit','home':'Home service','hire':'Professional hire','cab':'Self-drive rental' if row.get('mode')=='rental' else 'Cab journey','shared':'Shared ride','contract':'Contract','project':'Contract project'}[source]
    if source=='contract' and row.get('winning_project_id'):
        project=u.get('contract_projects',row['winning_project_id']) or {}
        if project.get('status') in ('active','completed'):state=project['status']
    completed=state in ('completed','fulfilled')
    active=state in ('active','in_progress','boarded','completion_submitted','completion_pending')
    label='Work completed' if completed else 'Work in progress' if active else 'Contract awarded' if source=='contract' and state=='awarded' else 'Booking confirmed' if state in ('accepted','booked','reserved','confirmed') else 'Booking requested' if source in ('service','home','hire','cab','shared') else 'Work update'
    labels={'paused':'Work paused','en_route':'Professional on the way','arrived':'Professional arrived','on_the_way':'Cab on the way','completion_submitted':'Completion under review','completion_pending':'Completion under review','quoted':'Quote offered'}
    label=labels.get(state,label)
    if source=='shared' and uid in (row.get('owner_id'),row.get('driver_id')) and state=='scheduled':label='Departure published'
    city=row.get('city','');city=city if city in CITIES else ''
    return {'source':source,'title':title,'label':label,'city':city,'trade':trade_for(row.get('category',row.get('sector','')))}

def install(core,router,actor):
    @router.post('/milestones/preview')
    def check(body:Reference,a=Depends(actor)):
        from repaidians import signed,pro
        user=signed(a)
        def read(u):
            pro(u,a)
            return preview(u,body.model_dump(),user['id'])
        return core.operations_store.run(read)
