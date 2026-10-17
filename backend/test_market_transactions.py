"""Real HTTP handover lifecycle, access, race and retry boundaries."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import main
import market_transactions
from test_operations import api, auth
from test_market_messaging import listing, open_chat, send, BASE


def accepted(api, row=None, buyer='worker2'):
    row = row or listing()
    opened, _ = open_chat(api, row, uid=buyer)
    cid = opened['chat']['id']
    changes = dict(amount_paise=90000) if row['mode'] == 'second_hand' else dict(exchange_listing_id=listing(uid=buyer, mode='exchange')['id'])
    offered, _ = send(api, cid, uid=buyer, kind='offer', body='', **changes)
    mid = offered['message']['id']
    result = api.post(f'{BASE}/{cid}/offers/{mid}', headers=auth('worker'), json={'decision': 'accepted'})
    assert result.status_code == 200, result.text
    return cid, mid, row


def meeting(api, cid, mid, uid='worker2', **changes):
    body = dict(expected_version=0, request_id=str(uuid.uuid4()), offer_message_id=mid,
                starts_at=time.time() + 3600, place='Public library entrance', note='Inspect accessories together.')
    body.update(changes)
    response = api.post(f'{BASE}/{cid}/transaction/meeting', headers=auth(uid), json=body)
    assert response.status_code == 200, response.text
    return response.json()['transaction'], body


def action(api, cid, row, name, uid='worker', status=200, **changes):
    body = dict(expected_version=row['version'], request_id=str(uuid.uuid4()), action=name)
    body.update(changes)
    response = api.post(f'{BASE}/{cid}/transaction/actions', headers=auth(uid), json=body)
    assert response.status_code == status, response.text
    return response.json().get('transaction'), body


def advance(monkeypatch):
    now = time.time() + 3700
    monkeypatch.setattr(market_transactions.time, 'time', lambda: now)


def test_mutual_handover_closes_listing_once_and_reviews_require_completion(api, monkeypatch):
    cid, mid, item = accepted(api)
    row, body = meeting(api, cid, mid)
    assert row['my_agreement'] and not row['other_agreement']
    repeat = api.post(f'{BASE}/{cid}/transaction/meeting', headers=auth('worker2'), json=body)
    assert repeat.json()['transaction']['version'] == row['version']
    assert api.post(f'{BASE}/{cid}/transaction/meeting', headers=auth('worker2'), json={**body,'place':'Changed meeting place'}).status_code == 409
    review = dict(request_id=str(uuid.uuid4()), rating=5, text='Item matched the agreed condition.')
    assert api.post(f'{BASE}/{cid}/transaction/review', headers=auth('worker2'), json=review).status_code == 409
    action(api, cid, row, 'confirm_completion', status=409)
    row, _ = action(api, cid, row, 'agree')
    action(api, cid, row, 'confirm_completion', status=409)
    advance(monkeypatch)
    # Expired paid access must not stop the participants closing an existing handover.
    main.operations_store.run(lambda u:u.put('market_access_trials','worker2',dict(id='worker2',starts_at=time.time()-91*86400)))
    row, first = action(api, cid, row, 'confirm_completion', uid='worker2')
    assert row['state'] == 'completion_pending'
    assert main.operations_store.run(lambda u:u.get('market_listings',item['id']))['status'] == 'published'
    action(api, cid, row, 'cancel', note='Cannot cancel a confirmed handover', status=409)
    row, _ = action(api, cid, row, 'confirm_completion')
    assert row['state'] == 'completed'
    assert main.operations_store.run(lambda u:u.get('market_listings',item['id']))['status'] == 'closed'
    assert api.post(f'{BASE}/{cid}/transaction/actions', headers=auth('worker2'), json=first).json()['transaction']['state'] == 'completed'
    result = api.post(f'{BASE}/{cid}/transaction/review', headers=auth('worker2'), json=review)
    assert result.status_code == 200 and result.json()['transaction']['my_review']['rating'] == 5
    assert api.post(f'{BASE}/{cid}/transaction/review', headers=auth('worker2'), json=review).status_code == 200
    assert api.post(f'{BASE}/{cid}/transaction/review', headers=auth('worker2'), json={**review,'request_id':str(uuid.uuid4())}).status_code == 409
    assert api.get(f'{BASE}/{cid}/transaction', headers=auth('worker')).json()['transaction']['other_review']['rating'] == 5
    assert api.get(f'{BASE}/{cid}/transaction', headers=auth('stranger')).status_code == 404


def test_reschedule_revokes_agreement_and_cancel_preserves_history(api):
    cid, mid, _ = accepted(api)
    row, _ = meeting(api, cid, mid)
    old = row
    row, _ = action(api, cid, row, 'agree')
    action(api, cid, old, 'agree', status=409)
    row, _ = meeting(api, cid, mid, expected_version=row['version'], uid='worker', place='Other public meeting location')
    assert row['my_agreement'] and not row['other_agreement'] and row['state'] == 'proposed'
    row, _ = action(api, cid, row, 'cancel', uid='worker2', note='The new time does not work for me.')
    assert row['state'] == 'cancelled'
    assert api.get(f'{BASE}/{cid}/transaction', headers=auth('worker')).json()['transaction']['cancel_note']


def test_swap_closes_both_items_and_prevents_competing_handover(api, monkeypatch):
    cid, mid, item = accepted(api, listing(mode='exchange'))
    row, _ = meeting(api, cid, mid)
    swap = row['offer']['exchange_listing']['id']
    row, _ = action(api, cid, row, 'agree')
    advance(monkeypatch)
    row, _ = action(api, cid, row, 'confirm_completion')
    row, _ = action(api, cid, row, 'confirm_completion', uid='worker2')
    for lid in (item['id'],swap):
        stored = main.operations_store.run(lambda u:u.get('market_listings',lid))
        assert stored['status'] == 'closed' and stored['completion_chat_id'] == cid


def test_same_listing_racing_handover_has_one_winner(api, monkeypatch):
    item = listing()
    first, m1, _ = accepted(api,item)
    second, m2, _ = accepted(api,item,buyer='shop')
    r1, _ = meeting(api,first,m1)
    r2, _ = meeting(api,second,m2,uid='shop')
    r1, _ = action(api,first,r1,'agree')
    r2, _ = action(api,second,r2,'agree')
    advance(monkeypatch)
    def confirm(pair):
        cid,row=pair
        return api.post(f'{BASE}/{cid}/transaction/actions',headers=auth('worker'),json=dict(action='confirm_completion',expected_version=row['version'],request_id=str(uuid.uuid4()))).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses=list(pool.map(confirm,[(first,r1),(second,r2)]))
    assert sorted(statuses)==[200,409]


def test_unaccepted_foreign_offer_and_blocked_meeting_rejected(api):
    cid, mid, _ = accepted(api)
    other, foreign, _ = accepted(api)
    payload=dict(expected_version=0,request_id=str(uuid.uuid4()),offer_message_id=foreign,starts_at=time.time()+500,place='Public meeting place')
    assert api.post(f'{BASE}/{cid}/transaction/meeting',headers=auth('worker2'),json=payload).status_code==409
    assert api.post(f'{BASE}/{cid}/transaction/meeting',headers=auth('stranger'),json={**payload,'offer_message_id':mid}).status_code==404
    api.post(f'{BASE}/{cid}/block',headers=auth('worker'),json={'blocked':True})
    assert api.post(f'{BASE}/{cid}/transaction/meeting',headers=auth('worker2'),json={**payload,'offer_message_id':mid}).status_code==409


def test_expiry_sweep_does_not_block_an_agreed_handover(api, monkeypatch):
    import marketplace
    cid, mid, item = accepted(api)
    row, _ = meeting(api, cid, mid)
    row, _ = action(api, cid, row, 'agree')
    advance(monkeypatch)
    def expire_access(u):
        u.put('market_access_trials', 'worker', dict(id='worker', starts_at=time.time()-91*86400))
        u.put('market_listings', item['id'], {**u.get('market_listings', item['id']), 'fee_status': 'free_trial'})
    main.operations_store.run(expire_access)
    main.operations_store.run(marketplace.expire_trials)
    assert main.operations_store.run(lambda u:u.get('market_listings', item['id']))['status'] == 'expired'
    row, _ = action(api, cid, row, 'confirm_completion', uid='worker2')
    row, _ = action(api, cid, row, 'confirm_completion')
    assert row['state'] == 'completed'
    assert main.operations_store.run(lambda u:u.get('market_listings', item['id']))['status'] == 'closed'


def test_owner_cannot_close_an_item_during_confirmed_swap_handover(api, monkeypatch):
    cid, mid, item = accepted(api, listing(mode='exchange'))
    row, _ = meeting(api, cid, mid)
    row, _ = action(api, cid, row, 'agree')
    advance(monkeypatch)
    row, _ = action(api, cid, row, 'confirm_completion')
    for lid, uid in ((item['id'], 'worker'), (row['offer']['exchange_listing']['id'], 'worker2')):
        response = api.post('/operations/market/'+lid+'/close', headers=auth(uid))
        assert response.status_code == 409, response.text
        assert response.json()['detail']['code'] == 'HANDOVER_IN_PROGRESS'
    row, _ = action(api, cid, row, 'confirm_completion', uid='worker2')
    assert row['state'] == 'completed'
    assert api.post('/operations/market/'+item['id']+'/close', headers=auth('worker')).status_code == 200
