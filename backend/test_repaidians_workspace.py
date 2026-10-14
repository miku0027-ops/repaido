"""Real transactional checks for cold start, retained-feed validation and tools."""
import time

import repaidians as social
import repaidians_network as network
from operations import Unit
from test_repaidians import api, auth, expire, post, profile


def test_bootstrap_only_reads_selected_timeline_and_stories(api, monkeypatch):
    profile(api)
    item = post(api)
    calls = []
    original = social.feed_page
    def tracked(u, actor, kind='post', *args, **kwargs):
        calls.append(kind)
        return original(u, actor, kind, *args, **kwargs)
    monkeypatch.setattr(social, 'feed_page', tracked)
    response = api.get('/repaidians/bootstrap', headers=auth())
    assert response.status_code == 200
    data = response.json()
    assert calls == ['post', 'story']
    assert data['timeline']['items'][0]['id'] == item['id']
    assert not data['state']['data']['posts']
    assert data['state']['capabilities']['professional']
    assert response.headers['cache-control'] == 'private, no-store'
    calls.clear()
    assert api.get('/repaidians/bootstrap?kind=reel', headers=auth()).status_code == 200
    assert calls == ['reel']
    assert api.get('/repaidians/bootstrap?limit=1000', headers=auth()).status_code == 422


def test_expired_bootstrap_exposes_metadata_without_publication_content(api):
    profile(api)
    post(api)
    expire(api)
    data = api.get('/repaidians/bootstrap', headers=auth()).json()
    assert data['state']['remainingMs'] == 0
    assert data['timeline']['items'] == data['stories']['items'] == []


def test_retained_feed_validation_rechecks_blocks_deletion_and_activity(api):
    profile(api)
    profile(api, 'bob')
    own = post(api)
    other = post(api, 'bob')
    path = '/repaidians/feed/validate'
    assert api.put('/repaidians/activity/likes/'+other['id'],headers=auth(),json={'active':True}).status_code == 200
    data = api.post(path, headers=auth(), json={'ids':[own['id'],other['id'],other['id'],'missing']}).json()
    assert len(data['items']) == 2
    assert next(row for row in data['items'] if row['id']==other['id'])['liked']
    assert data['unavailable'] == ['missing']
    api.put('/repaidians/blocks/bob', headers=auth(), json={'active':True})
    api.delete('/repaidians/publications/'+own['id'], headers=auth())
    data = api.post(path, headers=auth(), json={'ids':[own['id'],other['id']]}).json()
    assert data['items'] == []
    assert set(data['unavailable']) == {own['id'],other['id']}
    assert api.post(path,headers=auth(),json={'ids':['x']*101}).status_code == 422
    expire(api)
    assert api.post(path,headers=auth(),json={'ids':[other['id']]}).status_code == 402


def test_workspace_uses_own_records_and_real_profile_progress_without_global_scans(api, monkeypatch):
    profile(api)
    profile(api,'bob')
    post(api)
    api.patch('/repaidians/profile',headers=auth(),json={'headline':'Electrical work','skills':['Wiring'],'bio':'Careful electrical installations.'})
    stamp = social.now_ms()
    def seed(u):
        network.save_connection(u, {'id': network.pair_key('bob','alice'),'senderId':'bob',
            'recipientId':'alice','recipientEpoch':0,'status':'pending','version':1,'generation':1,
            'note':'Let us work together.','createdAt':stamp,'updatedAt':stamp})
        u.put('rp_network_counts','alice',{'connections':7})
        u.put('rp_network_counts','bob',{'connections':999})
    api.core.operations_store.run(seed)
    monkeypatch.setattr(Unit,'all',lambda *_: (_ for _ in ()).throw(AssertionError('Global scan')))
    response = api.get('/repaidians/professional/workspace',headers=auth())
    assert response.status_code == 200, response.text
    data=response.json()
    assert data['member']['id']=='alice'
    assert data['stats']['publications']==1 and data['stats']['connections']==7
    assert data['completed']==sum(row['complete'] for row in data['checklist'])
    assert data['total']==8
    assert data['invitations'][0]['memberId']=='bob'
    assert 'workers' not in data and 'phone' not in str(data)
    assert api.get('/repaidians/professional/workspace').status_code==401
    assert api.get('/repaidians/professional/workspace',headers=auth('customer')).status_code==403


def test_multiword_member_search_matches_all_terms_in_any_order_and_rebuilds_after_edits(api):
    profile(api)
    profile(api,'bob')
    api.patch('/repaidians/profile',headers=auth(),json={'name':'Anita Kumar Electrician','handle':'anita_wiring'})
    api.patch('/repaidians/profile',headers=auth('bob'),json={'name':'Anita Contractor','handle':'anita_contract'})
    def ids(query):
        response=api.get('/repaidians/members',headers=auth(),params={'search':query})
        assert response.status_code==200,response.text
        return [row['id'] for row in response.json()['members']]
    assert ids('Kumar Anita')==['alice']
    assert ids('Anita missing')==[]
    assert ids('anita_wir')==['alice']
    api.patch('/repaidians/profile',headers=auth(),json={'name':'Anita Patra Electrician'})
    assert ids('Kumar Anita')==[]
    assert ids('Patra Anita')==['alice']
