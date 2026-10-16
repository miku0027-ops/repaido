"""HTTP opt-in/privacy and deterministic worker scheduling against real SQLite."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import main
import operations
import saved_alerts as alerts
from test_operations import api, auth
from test_shop_discovery import seed

PREFS = '/operations/customer-hub/notification-preferences'
SAVED = '/operations/customer-hub/saved'


def change_prefs(api, uid='customer', **changes):
    old = api.get(PREFS, headers=auth(uid)).json()
    response = api.put(PREFS, headers=auth(uid), json={**{k:v for k,v in old.items() if k!='version'},
        'expected_version': old['version'], **changes})
    assert response.status_code == 200, response.text
    return response.json()


def save(api, kind='product', reference='wire', uid='customer', **changes):
    response = api.post(SAVED, headers=auth(uid), json=dict(kind=kind, reference=reference, label='Saved item', **changes))
    assert response.status_code == 200, response.text
    return response.json()['id']


def update(kind, key, **changes):
    main.operations_store.run(lambda u:u.put(kind,key,{**u.get(kind,key),**changes}))


def notes(uid='customer'):
    return main.operations_store.run(lambda u:[x for x in u.find('notifications','user_id',uid) if x.get('kind')=='saved_update'])


def home(key, stamp):
    return dict(id=key,title='Public home '+key,status='published',city_key='balasore',city='Balasore',
                bedrooms=2,rent_paise=100000,version=1,updated_at=stamp,photo_id='public-photo',owner_id='worker',address='PRIVATE_ADDRESS')


def test_saves_do_not_opt_in_and_preferences_are_private_validated_versioned(api):
    seed();sid=save(api)
    defaults=api.get(PREFS,headers=auth('customer')).json()
    assert all(defaults[key] is False for key in alerts.FLAGS)
    assert main.operations_store.run(lambda u:u.get(alerts.QUEUE,alerts.digest('customer',sid))) is None
    assert api.get(PREFS).status_code==401
    enabled=change_prefs(api,price_drops=True)
    assert api.get(PREFS,headers=auth('stranger')).json()['price_drops'] is False
    body={**{k:v for k,v in enabled.items() if k!='version'},'expected_version':0}
    assert api.put(PREFS,headers=auth('customer'),json=body).status_code==409
    body['expected_version']=enabled['version']
    assert api.put(PREFS,headers=auth('customer'),json={**body,'timezone':'Invalid/Zone'}).status_code==422
    assert api.put(PREFS,headers=auth('customer'),json={**body,'quiet_enabled':True,'quiet_start':'09:00','quiet_end':'09:00'}).status_code==422
    assert api.put(PREFS,headers=auth('customer'),json={**body,'user_id':'stranger'}).status_code==422
    assert api.get(PREFS,headers=auth('customer')).json()['version']==1
    assert api.post(SAVED,headers=auth('customer'),json={'kind':'product','reference':'','label':'Bad item'}).status_code==422
    assert api.get(SAVED+'/status',headers=auth('customer'),params={'kind':'product','reference':'../private'}).status_code==422


def test_price_drop_idempotency_concurrency_optout_and_unfollow(api,monkeypatch):
    seed();sid=save(api);change_prefs(api,price_drops=True)
    # A scheduled check may not enumerate an entire collection.
    monkeypatch.setattr(operations.Unit,'all',lambda *args:(_ for _ in ()).throw(AssertionError('collection scan')))
    update('inventory','wire',price_paise=8000)
    now=time.time()+1
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:alerts.process_updates(main,now=now),range(2)))
    assert sum(x['delivered'] for x in results)==1 and len(notes())==1
    assert notes('stranger')==[]
    assert 'PRIVATE_' not in json.dumps(notes())
    assert alerts.process_updates(main,now=now+alerts.INTERVAL)['delivered']==0
    # Price bouncing back to the previously notified low cannot repeat it.
    update('inventory','wire',price_paise=9000)
    alerts.process_updates(main,now=now+2*alerts.INTERVAL)
    update('inventory','wire',price_paise=8000)
    assert alerts.process_updates(main,now=now+3*alerts.INTERVAL)['delivered']==0
    change_prefs(api,price_drops=False)
    assert alerts.process_updates(main,now=now+4*alerts.INTERVAL)['checked']==0
    stale=notes()[0]
    assert main.operations_store.run(lambda u:alerts.notification_visible(u,stale,'customer')) is False
    change_prefs(api,price_drops=True)
    api.delete(SAVED+'/'+sid,headers=auth('customer'))
    assert main.operations_store.run(lambda u:u.get(alerts.QUEUE,alerts.digest('customer',sid)))['active'] is False
    update('inventory','wire',price_paise=7000)
    assert alerts.process_updates(main,now=now+5*alerts.INTERVAL)['delivered']==0


def test_quiet_hours_defer_optional_updates_and_release_once(api,monkeypatch):
    stamp=datetime(2026,10,17,23,30,tzinfo=timezone.utc).timestamp()
    monkeypatch.setattr(time,'time',lambda:stamp)
    seed();save(api);change_prefs(api,price_drops=True,quiet_enabled=True,quiet_start='22:00',quiet_end='08:00',timezone='UTC')
    update('inventory','wire',price_paise=8000)
    main.operations_store.run(lambda u:u.put('notifications','urgent',dict(id='urgent',user_id='customer',title='Booking arrival',created_at=stamp,job_id='job')))
    assert alerts.process_updates(main,now=stamp)['delivered']==0
    tomorrow=datetime(2026,10,18,8,0,tzinfo=timezone.utc).timestamp()
    check=main.operations_store.run(lambda u:alerts.due(u,tomorrow,10))[0]
    assert check['next_check_at']==tomorrow
    assert api.get('/operations/notifications',headers=auth('customer')).json()['notifications'][0]['id']=='urgent'
    monkeypatch.setattr(time,'time',lambda:tomorrow)
    assert alerts.process_updates(main,now=tomorrow)['delivered']==1
    assert alerts.process_updates(main,now=tomorrow)['delivered']==0


def test_quiet_hours_handle_overnight_daytime_and_dst():
    prefs={**alerts.DEFAULTS,'quiet_enabled':True,'timezone':'America/New_York','quiet_start':'22:00','quiet_end':'08:00'}
    stamp=datetime(2026,11,1,4,30,tzinfo=timezone.utc).timestamp()
    assert alerts.next_allowed(prefs,stamp)==datetime(2026,11,1,13,0,tzinfo=timezone.utc).timestamp()
    prefs.update(timezone='UTC',quiet_start='10:00',quiet_end='12:00')
    stamp=datetime(2026,10,17,11,30,tzinfo=timezone.utc).timestamp()
    assert alerts.next_allowed(prefs,stamp)==datetime(2026,10,17,12,0,tzinfo=timezone.utc).timestamp()


def test_quiet_hours_changes_release_deferred_checks_and_same_clock_resave_is_new(api,monkeypatch):
    stamp=datetime(2026,10,17,23,30,tzinfo=timezone.utc).timestamp()
    monkeypatch.setattr(time,'time',lambda:stamp)
    seed();sid=save(api);change_prefs(api,price_drops=True,quiet_enabled=True,timezone='UTC')
    update('inventory','wire',price_paise=8000)
    assert alerts.process_updates(main)['delivered']==0
    change_prefs(api,quiet_enabled=False)
    assert alerts.process_updates(main)['delivered']==1
    old=notes()[0]
    api.delete(SAVED+'/'+sid,headers=auth('customer'));save(api)
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,old,'customer'))
    change_prefs(api,price_drops=False);change_prefs(api,price_drops=True)
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,old,'customer'))


def test_saved_search_pages_reach_late_matches_without_scans_or_duplicate_alerts(api,monkeypatch):
    sid=save(api,kind='home_search',reference='',city='Balasore',max_rent=150000,bedrooms=2)
    change_prefs(api,saved_searches=True)
    stamp=time.time()+1
    def populate(u):
        for i in range(55):u.put('home_listings',f'h{i:03}',home(f'h{i:03}',stamp))
    main.operations_store.run(populate)
    monkeypatch.setattr(operations.Unit,'all',lambda *args:(_ for _ in ()).throw(AssertionError('collection scan')))
    calls=[];original=operations.Unit.find
    def bounded(self,kind,field,value,**kwargs):
        if kind=='home_listings':assert kwargs.get('limit')==alerts.PAGE;calls.append(kwargs.get('after'))
        return original(self,kind,field,value,**kwargs)
    monkeypatch.setattr(operations.Unit,'find',bounded)
    for turn in range(3):alerts.process_updates(main,now=stamp+turn*61)
    assert calls==['','h023','h047'] and len(notes())==55
    assert any(n['reference']=='h054' for n in notes())
    for turn in range(3):alerts.process_updates(main,now=stamp+2000+turn*61)
    assert len(notes())==55
    update('home_listings','h054',status='paused')
    stale=next(n for n in notes() if n['reference']=='h054')
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,stale,'customer'))
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,stale,'stranger'))
    api.delete(SAVED+'/'+sid,headers=auth('customer'))
    assert all(not main.operations_store.run(lambda u:alerts.notification_visible(u,n,'customer')) for n in notes())


def test_due_queue_fairness_and_live_visibility(api,monkeypatch):
    seed();change_prefs(api,price_drops=True)
    for pid in ('wire','switch','pipe','lamp'):save(api,reference=pid)
    for pid in ('wire','switch','pipe','lamp'):update('inventory',pid,price_paise=1000)
    stamp=time.time()+1
    for _ in range(4):assert alerts.process_updates(main,limit=1,now=stamp)['delivered']==1
    assert len({n['reference'] for n in notes()})==4
    update('shops','s1',status='suspended')
    for note in notes():
        visible=main.operations_store.run(lambda u:alerts.notification_visible(u,note,'customer'))
        assert visible==(note['reference'] not in ('wire','switch'))
    change_prefs(api,price_drops=False)
    assert not any(n.get('kind')=='saved_update' for n in api.get('/operations/notifications',headers=auth('customer')).json()['notifications'])


def test_follow_catalogue_changes_and_revoked_shop_access(api):
    seed();save(api,kind='shop',reference='s1');change_prefs(api,following=True)
    stamp=time.time()+1
    assert alerts.process_updates(main,now=stamp)['delivered']==0
    update('inventory','wire',stock=2)
    assert alerts.process_updates(main,now=stamp+alerts.INTERVAL)['delivered']==1
    assert notes()[0]['alert_reason']=='catalogue_update'
    update('inventory','wire',shop_id='s2')
    stale=notes()[0]
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,stale,'customer'))
    update('shops','s1',created_at=time.time()-100*86400)
    update('inventory','switch',stock=2)
    assert alerts.process_updates(main,now=stamp+2*alerts.INTERVAL)['delivered']==0


def test_marketplace_saves_use_live_owner_access_without_starting_viewer_trial(api):
    from test_marketplace import draft
    row,_=draft(api,trial=True,mode='second_hand')
    sid=save(api,kind='second_hand',reference=row['id'])
    assert api.get(SAVED+'/status',headers=auth('customer'),params={'kind':'second_hand','reference':row['id']}).json()['id']==sid
    assert main.operations_store.run(lambda u:u.get('market_access_trials','customer')) is None
    change_prefs(api,price_drops=True)
    update('market_listings',row['id'],value_paise=row['value_paise']-10000)
    stamp=time.time()+1
    assert alerts.process_updates(main,now=stamp)['delivered']==1
    update('market_access_trials','worker',starts_at=time.time()-100*86400)
    assert api.get(SAVED,headers=auth('customer')).json()['items'][0]['available'] is False
    stale=notes()[0]
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,stale,'customer'))
    assert api.post(SAVED,headers=auth('stranger'),json={'kind':'second_hand','reference':row['id'],'label':'Expired'}).status_code==404


def test_professional_follow_uses_current_approval_and_resave_hides_old_alert(api):
    from test_operations import onboard
    onboard(api)
    sid=save(api,kind='professional',reference='worker');change_prefs(api,following=True)
    update('workers','worker',city='Bhubaneswar')
    stamp=time.time()+1
    assert alerts.process_updates(main,now=stamp)['delivered']==1
    old=notes()[0]
    assert old['alert_reason']=='profile_update'
    update('workers','worker',status='suspended')
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,old,'customer'))
    update('workers','worker',status='approved')
    api.delete(SAVED+'/'+sid,headers=auth('customer'))
    assert save(api,kind='professional',reference='worker')==sid
    assert not main.operations_store.run(lambda u:alerts.notification_visible(u,old,'customer'))
    update('workers','worker',city='Balasore')
    assert alerts.process_updates(main,now=stamp+alerts.INTERVAL)['delivered']==1
    main.operations_store.run(lambda u:u.put('network_suspensions','customer',{'active':True}))
    update('workers','worker',city='Cuttack')
    assert alerts.process_updates(main,now=stamp+2*alerts.INTERVAL)['delivered']==0


def test_saved_search_previews_share_bounded_city_reads(api,monkeypatch):
    for n in range(5):save(api,kind='home_search',reference='',city='Balasore',max_rent=100000+n)
    calls=[];original=operations.Unit.find
    def measured(self,kind,field,value,**kwargs):
        if kind=='home_listings':calls.append((field,value,kwargs.get('limit')))
        return original(self,kind,field,value,**kwargs)
    monkeypatch.setattr(operations.Unit,'find',measured)
    response=api.get(SAVED,headers=auth('customer'))
    assert response.status_code==200 and len(response.json()['items'])==5
    assert calls==[('city_key','balasore',100)]
    assert all('first 100' in row['match_scope'] for row in response.json()['items'])


def test_malformed_source_backs_off_without_starving_other_saved_items(api):
    seed()
    stamp=time.time()
    main.operations_store.run(lambda u:u.put('home_listings','broken',home('broken',stamp)))
    sid=save(api,kind='home',reference='broken');save(api);change_prefs(api,price_drops=True)
    def corrupt(u):
        row=u.get('home_listings','broken');row.pop('rent_paise');u.put('home_listings','broken',row)
        key=alerts.digest('customer',sid);check=u.get(alerts.QUEUE,key);check['next_check_at']=0;u.put(alerts.QUEUE,key,check)
    main.operations_store.run(corrupt)
    update('inventory','wire',price_paise=8000)
    result=alerts.process_updates(main,limit=2,now=stamp+1)
    assert result=={'checked':2,'delivered':1,'failed':1}
    check=main.operations_store.run(lambda u:u.get(alerts.QUEUE,alerts.digest('customer',sid)))
    assert check['next_check_at']==stamp+121 and check['last_error_code']=='CHECK_FAILED'
    assert alerts.process_updates(main,now=stamp+2)['checked']==0
