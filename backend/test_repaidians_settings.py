from test_repaidians import api,auth,profile,post,expire


def test_generated_handles_fit_limit_and_legacy_handles_do_not_block_other_edits(api):
    import re
    api.core.operations_store.run(lambda u:u.put('workers','alice',{'id':'alice','name':'Paramesh Prasad Mohapatra','categories':['electrician']}))
    member=profile(api)
    assert re.fullmatch(r'[a-z0-9][a-z0-9._]{2,29}',member['handle'])
    assert len(member['handle'])==30
    legacy='historical.worker.name.12345678'
    assert len(legacy)==31
    def old_profile(u):
        row=u.get('rp_members','alice');row['handle']=legacy;u.put('rp_members','alice',row)
    api.core.operations_store.run(old_profile)
    updated=api.patch('/repaidians/profile',headers=auth(),json={'name':'Worker Name','headline':'Electrical repairs'})
    assert updated.status_code==200,updated.text
    assert updated.json()['member']['handle']==legacy
    failed=api.patch('/repaidians/profile',headers=auth(),json={'handle':'paramesh electrician','headline':'Must not save'})
    assert failed.status_code==422
    assert api.get('/repaidians/members/alice',headers=auth()).json()['member']['headline']=='Electrical repairs'


def test_unique_handles_and_private_settings(api):
    profile(api);profile(api,'bob')
    assert api.patch('/repaidians/profile',headers=auth(),json={'handle':'sipun.mahanta'}).status_code==200
    assert [row['id'] for row in api.get('/repaidians/members?search=sipun.mah',headers=auth('bob')).json()['members']]==['alice']
    assert api.patch('/repaidians/profile',headers=auth('bob'),json={'handle':'sipun.mahanta'}).status_code==409
    assert api.patch('/repaidians/profile',headers=auth(),json={'handle':'Bad handle'}).status_code==422
    assert api.get('/repaidians/settings').status_code==401
    assert api.patch('/repaidians/settings',headers=auth(),json={'messagePrivacy':'nobody','likeNotifications':False}).status_code==200
    config=api.get('/repaidians/settings',headers=auth()).json()['settings']
    assert config['messagePrivacy']=='nobody' and config['likeNotifications'] is False
    assert api.get('/repaidians/settings',headers=auth('bob')).json()['settings']['messagePrivacy']=='everyone'
    assert 'settings' not in api.get('/repaidians/members/alice',headers=auth('bob')).json()['member']
    assert api.patch('/repaidians/settings',headers=auth(),json={'reviewed':True}).status_code==422
    assert api.patch('/repaidians/settings',headers=auth(),json={'likeNotifications':'false'}).status_code==422


def test_message_privacy_and_real_notification_controls(api):
    profile(api);profile(api,'bob')
    item=post(api)['id']
    api.patch('/repaidians/settings',headers=auth(),json={'likeNotifications':False,'messagePrivacy':'following'})
    assert api.put('/repaidians/activity/likes/'+item,headers=auth('bob'),json={'active':True}).status_code==200
    assert api.get('/repaidians/notifications',headers=auth()).json()['notifications']==[]
    assert api.post('/repaidians/messages/alice',headers=auth('bob'),json={'text':'Interested in your work'}).status_code==403
    assert api.put('/repaidians/follow/bob',headers=auth(),json={'active':True}).status_code==200
    assert api.post('/repaidians/messages/alice',headers=auth('bob'),json={'text':'Interested in your work'}).status_code==201
    api.patch('/repaidians/settings',headers=auth(),json={'messagePrivacy':'nobody'})
    assert api.post('/repaidians/messages/alice',headers=auth('bob'),json={'text':'Hello'}).status_code==403
    assert api.get('/repaidians/messages/bob',headers=auth()).status_code==200


def test_block_management_and_preferences_remain_available_after_trial(api):
    profile(api);profile(api,'bob')
    assert api.put('/repaidians/blocks/bob',headers=auth(),json={'active':True}).status_code==200
    expire(api)
    assert api.get('/repaidians/blocks',headers=auth()).json()['members']==[{'id':'bob','name':'Bob Professional'}]
    assert api.get('/repaidians/blocks',headers=auth('bob')).json()['members']==[]
    assert api.patch('/repaidians/settings',headers=auth(),json={'messagePrivacy':'nobody'}).status_code==200
    assert api.put('/repaidians/blocks/bob',headers=auth(),json={'active':False}).status_code==200
    assert api.get('/repaidians/blocks',headers=auth()).json()['members']==[]
