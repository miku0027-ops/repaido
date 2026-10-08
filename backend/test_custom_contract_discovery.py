"""Customer publication is discoverable only through authorized contract views."""
import json
import time

import pytest
import main
import repaidians_opportunities as bridge
from test_operations import api, auth
from test_custom_contract_integration import finance_api, custom_api, custom_query, custom_bid
from test_worker_network import get, put


def discover(client, uid='worker', **filters):
    response = client.get('/repaidians/opportunities', headers=auth(uid) if uid else {},
                          params={'kind': 'tenders', **filters})
    assert response.status_code == 200, response.text
    return response.json()


def test_publication_reaches_matching_contractor_and_community_without_private_site(custom_api):
    q = custom_query(custom_api)
    matched = custom_api.get('/operations/custom-contracts/queries?scope=matched', headers=auth('worker'))
    assert matched.status_code == 200, matched.text
    assert q['id'] in {item['id'] for item in matched.json()['items']}
    q = custom_bid(custom_api, q)
    for uid, filters in [('worker', {'trade': 'ac', 'city': 'Balasore'}), ('shop', {'mode': 'mine'})]:
        cards = discover(custom_api, uid, **filters)['items']
        card = next(item for item in cards if item['id'] == q['id'])
        assert card['action'] == {'source': 'contract', 'id': q['id'], 'route': 'custom_contracts'}
        assert card['trade'] == 'ac' and card['kind'] == 'tender'
        assert card['title'] == q['title'] and card['shareable'] is False
        assert not {'site', 'location', 'scope', 'bids', 'terms', 'details'} & card.keys()
        assert 'PRIVATE exact customer entrance' not in json.dumps(card)
        detail = custom_api.get('/repaidians/opportunities/contract/' + q['id'], headers=auth(uid))
        assert detail.status_code == 200 and detail.json() == card
    assert not discover(custom_api, 'worker', trade='spares')['items']
    for uid in (None, 'stranger', 'customer'):
        assert q['id'] not in json.dumps(discover(custom_api, uid))
        assert custom_api.get('/repaidians/opportunities/contract/' + q['id'], headers=auth(uid) if uid else {}).status_code == 404


@pytest.mark.parametrize('changes', [dict(categories=['plumber']), dict(city='Cuttack'),
    dict(experience_years=0), dict(contractor_verified=False), dict(status='pending')])
def test_changed_professional_eligibility_removes_saved_and_discovery_cards(custom_api, changes):
    q = custom_query(custom_api)
    path = '/repaidians/opportunities/contract/' + q['id']
    saved = custom_api.put(path + '/saved', headers=auth('worker'), json={'active': True})
    assert saved.status_code == 200, saved.text
    put('workers', 'worker', {**get('workers', 'worker'), **changes})
    assert q['id'] not in json.dumps(discover(custom_api))
    assert q['id'] not in json.dumps(discover(custom_api, mode='saved'))
    assert custom_api.get(path, headers=auth('worker')).status_code == 404


@pytest.mark.parametrize('reason', ['block', 'suspension', 'closed', 'deadline', 'ends_at'])
def test_visibility_rechecks_live_privacy_and_contract_status(custom_api, reason):
    q = custom_query(custom_api)
    assert q['id'] in json.dumps(discover(custom_api))
    if reason == 'block':
        put('network_blocks', 'shop:worker', {'active': True})
    elif reason == 'suspension':
        put('network_suspensions', 'worker', {'active': True})
    else:
        changes = {'status': 'closed'} if reason == 'closed' else {reason: time.time() - 1}
        put('contract_tenders', q['id'], {**get('contract_tenders', q['id']), **changes})
    assert q['id'] not in json.dumps(discover(custom_api))
    assert custom_api.get('/repaidians/opportunities/contract/' + q['id'], headers=auth('worker')).status_code == 404


def test_existing_live_queries_are_reindexed_after_old_backfill_finished(custom_api):
    q = custom_query(custom_api)
    def old_index(u):
        marker = u.get('rp_opportunity_refs', 'contract:' + q['id'])
        for channel in marker['channels']:
            u.conn.execute('DELETE FROM operation_records WHERE kind=?', (channel,))
        old_channel = 'rp_opportunities_' + bridge.digest(json.dumps(
            ['contract', 'all', '', 'spares', 'balasore'], separators=(',', ':')))
        u.put(old_channel, q['id'], dict(id=q['id'], sortKey=q['id'], source='contract', origin='live', active=True))
        u.put('rp_opportunity_refs', 'contract:' + q['id'], dict(origin='live', channels=[old_channel]))
        u.put('rp_opportunity_backfill', 'contract', dict(after=q['id'], done=True))
    main.operations_store.run(old_index)
    first = discover(custom_api, trade='ac', city='Balasore')
    assert [card['id'] for card in first['items']] == [q['id']]
    assert [card['id'] for card in discover(custom_api, trade='ac', city='Balasore')['items']] == [q['id']]
    marker = get('rp_opportunity_refs', 'contract:' + q['id'])
    assert marker['version'] == 2
    assert bridge.lane('contract', trade='ac', city='Balasore') in marker['channels']
    assert get('rp_opportunity_backfill', bridge.backfill_key('contract'))['done']
