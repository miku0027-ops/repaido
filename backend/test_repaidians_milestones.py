import time,uuid
from test_repaidians import api,auth,grant,profile

def seed(api,kind='jobs',id='real-work',**fields):
    api.core.operations_store.run(lambda u:u.put(kind,id,{'id':id,'customer_id':'customer','worker_id':'alice','state':'in_progress','city':'Balasore','address':'SECRET ADDRESS','phone':'SECRET PHONE','total_paise':999999,'notes':'SECRET NOTES',**fields}))

def draft(source='service',id='real-work',**fields):return {'kind':'post','trade':'spares','visibility':'public','caption':'Sharing a work update','media':[],'clientId':str(uuid.uuid4()),'milestone':{'source':source,'id':id},**fields}

def test_customer_can_share_only_verified_own_work_and_replay_once(api):
    seed(api);body=draft()
    r=api.post('/repaidians/milestones/preview',headers=auth('customer'),json=body['milestone']);assert r.status_code==200,r.text
    assert r.json()['label']=='Work in progress' and 'SECRET' not in r.text
    post=api.post('/repaidians/publications',headers=auth('customer'),json=body);assert post.status_code==201,post.text
    replay=api.post('/repaidians/publications',headers=auth('customer'),json=body)
    assert replay.json()['item']['id']==post.json()['item']['id']
    assert 'milestone' not in post.json()['item'] and 'SECRET' not in post.text and '999999' not in post.text
    assert post.json()['item']['milestoneCard']['label']=='Work in progress'
    denied=api.post('/repaidians/publications',headers=auth('bob'),json=draft());assert denied.status_code==404
    plain=api.post('/repaidians/publications',headers=auth('customer'),json={k:v for k,v in draft().items() if k!='milestone'});assert plain.status_code==403

def test_public_feed_does_not_expose_record_ids_or_private_fields_and_tracks_state(api):
    seed(api);post=api.post('/repaidians/publications',headers=auth(),json=draft()).json()['item']
    api.core.operations_store.run(lambda u:u.put('jobs','real-work',{**u.get('jobs','real-work'),'state':'completed'}))
    feed=api.get('/repaidians/feed?kind=post').json()
    assert next(p for p in feed['items'] if p['id']==post['id'])['milestoneCard']['label']=='Work completed'
    assert 'real-work' not in str(feed) and 'SECRET' not in str(feed)
    api.core.operations_store.run(lambda u:u.put('jobs','real-work',{**u.get('jobs','real-work'),'state':'cancelled'}))
    feed=api.get('/repaidians/feed?kind=post').json()
    assert next(p for p in feed['items'] if p['id']==post['id'])['milestoneUnavailable']

def test_activity_phase_is_checked_again_and_cannot_be_supplied_by_the_author(api):
    seed(api)
    body=draft();body['milestone']['phase']='completed'
    assert api.post('/repaidians/publications',headers=auth(),json=body).status_code==422
    posted=api.post('/repaidians/publications',headers=auth(),json=draft()).json()['item']
    card=posted['milestoneCard']
    assert card['phase']=='active' and card['participant']=='Professional update'
    assert abs(card['checkedAt']-time.time()*1000)<5000
    api.core.operations_store.run(lambda u:u.put('jobs','real-work',{**u.get('jobs','real-work'),'state':'completion_pending'}))
    check=api.post('/repaidians/feed/validate',json={'ids':[posted['id']]}).json()['items'][0]['milestoneCard']
    assert check['phase']=='review' and check['label']=='Completion under review'
    assert 'SECRET' not in str(check) and 'real-work' not in str(check)

def test_ride_cards_distinguish_the_authors_participation(api):
    seed(api,'shared_departures','ride-proof',worker_id=None,owner_id='alice',driver_id='bob',state='in_progress',origin={'lat':21.49,'lng':86.91},starts_at=time.time())
    seed(api,'shared_passengers','seat-proof',worker_id=None,departure_id='ride-proof',state='boarded')
    for uid,label in [('alice','Ride owner update'),('bob','Driver update'),('customer','Passenger update')]:
        response=api.post('/repaidians/publications',headers=auth(uid),json=draft('shared','ride-proof'))
        assert response.status_code==201,response.text
        card=response.json()['item']['milestoneCard']
        assert card['participant']==label and card['phase']=='active' and card['label']=='Ride in progress'
        assert not {'owner_id','driver_id','customer_id','origin','destination','passenger_id'}&set(card)

def test_credibility_counts_only_come_from_approved_worker_records(api):
    for uid,status in [('alice','approved'),('bob','suspended')]:
        profile(api,uid,'electrician')
        api.core.operations_store.run(lambda u:u.put('workers',uid,{**u.get('workers',uid),'status':status,'completed_tasks':7,'rating_sum':9,'rating_count':2}))
    for uid,expected in [('alice',(True,7,4.5,2)),('bob',(False,0,None,0))]:
        member=api.get('/repaidians/members/'+uid).json()['member']
        assert (member['reviewed'],member['completedTasks'],member['rating'],member['reviewCount'])==expected

def test_contract_award_and_fulfillment_use_actual_parties_and_project(api):
    seed(api,'contract_tenders','contract-proof',owner_id='customer',awarded_contractor_id='alice',status='awarded',state='awarded',winning_project_id='project-proof')
    seed(api,'contract_projects','project-proof',owner_id='alice',client_id='customer',state='completed',status='completed')
    body=draft('contract','contract-proof')
    r=api.post('/repaidians/publications',headers=auth('customer'),json=body);assert r.status_code==201,r.text
    assert r.json()['item']['milestoneCard']['label']=='Work completed'
    assert api.post('/repaidians/milestones/preview',headers=auth('bob'),json=body['milestone']).status_code==404

def test_milestone_trade_visibility_uses_the_participants_actual_trade(api):
    seed(api);profile(api,'alice','electrician');profile(api,'bob','plumber')
    r=api.post('/repaidians/publications',headers=auth(),json=draft(visibility='trade',trade='spares'))
    assert r.status_code==201,r.text
    assert r.json()['item']['trade']=='electrician'
    assert api.get('/repaidians/publications/'+r.json()['item']['id'],headers=auth('bob')).status_code==404
    assert api.get('/repaidians/publications/'+r.json()['item']['id'],headers=auth()).status_code==200

def test_shared_passenger_reference_is_private_and_rechecked_without_scanning(api,monkeypatch):
    seed(api,'shared_departures','ride-proof',customer_id=None,worker_id=None,owner_id='alice',state='scheduled',origin={'lat':21.49,'lng':86.91},starts_at=time.time()+3600)
    seed(api,'shared_passengers','passenger-proof',worker_id=None,departure_id='ride-proof',state='accepted')
    r=api.post('/repaidians/publications',headers=auth('customer'),json=draft('shared','ride-proof'))
    assert r.status_code==201,r.text
    assert 'passenger-proof' not in r.text
    item=api.core.operations_store.run(lambda u:u.get('rp_publications',r.json()['item']['id']))
    assert item['milestone']['passenger_id']=='passenger-proof'
    from operations import Unit
    original=Unit.find
    def no_passenger_scan(u,kind,*args,**kwargs):
        assert kind!='shared_passengers'
        return original(u,kind,*args,**kwargs)
    monkeypatch.setattr(Unit,'find',no_passenger_scan)
    assert api.get('/repaidians/feed?kind=post').json()['items'][0]['milestoneCard']['label']=='Booking confirmed'
    api.core.operations_store.run(lambda u:u.put('shared_passengers','passenger-proof',{**u.get('shared_passengers','passenger-proof'),'state':'cancelled'}))
    assert api.get('/repaidians/feed?kind=post').json()['items'][0]['milestoneUnavailable']


def test_recycling_updates_are_opt_in_verified_and_hide_private_evidence(api):
    seed(api,'scrap_collections','scrap-proof',owner_id='alice',state='payment_reported',payment_source='buyer_reported',photo_document_id='SECRET CAMERA',payment_reference='SECRET RECEIPT',customer_points=10,collector_points=10)
    body=draft('scrap','scrap-proof',trade='recycling')
    assert api.post('/repaidians/milestones/preview',headers=auth('customer'),json=body['milestone']).status_code==404
    api.core.operations_store.run(lambda u:u.put('scrap_collections','scrap-proof',{**u.get('scrap_collections','scrap-proof'),'state':'completed','payment_source':'customer_confirmed_receipt'}))
    assert api.post('/repaidians/publications',headers=auth('bob'),json=body).status_code==404
    posted=api.post('/repaidians/publications',headers=auth('customer'),json=body)
    assert posted.status_code==201,posted.text
    card=posted.json()['item']['milestoneCard']
    assert card['label']=='Collection completed' and card['points_earned']==10 and card['trade']=='recycling'
    feed=api.get('/repaidians/feed?kind=post&trade=recycling').json()
    assert len(feed['items'])==1 and feed['items'][0]['id']==posted.json()['item']['id']
    assert 'SECRET' not in str(feed) and 'scrap-proof' not in str(feed)
    assert not api.core.operations_store.run(lambda u:u.all('cleanup_points'))  # Sharing creates no award.


def test_cleanup_posts_distinguish_reports_from_verified_work_and_hide_hazards(api):
    seed(api,'cleanup_reports','cleanup-proof',owner_id='alice',state='reported',category='dry_recyclables',document_ids=['SECRET PHOTO'],points=0)
    body=draft('cleanup','cleanup-proof',trade='recycling')
    published=api.post('/repaidians/publications',headers=auth('customer'),json=body)
    assert published.status_code==201,published.text
    assert published.json()['item']['milestoneCard']['label']=='Cleanup reported · awaiting review'
    api.core.operations_store.run(lambda u:u.put('cleanup_reports','cleanup-proof',{**u.get('cleanup_reports','cleanup-proof'),'state':'completed','points':10}))
    card=api.get('/repaidians/feed?kind=post&trade=recycling').json()['items'][0]['milestoneCard']
    assert card['label']=='Cleanup verified' and card['points_earned']==10
    api.core.operations_store.run(lambda u:u.put('cleanup_reports','cleanup-proof',{**u.get('cleanup_reports','cleanup-proof'),'category':'hazardous'}))
    assert api.post('/repaidians/milestones/preview',headers=auth('customer'),json=body['milestone']).status_code==404
    assert api.get('/repaidians/feed?kind=post&trade=recycling').json()['items'][0]['milestoneUnavailable']
