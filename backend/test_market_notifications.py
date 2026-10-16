import main
from market_delivery import market_chat_delivery_allowed
from test_market_messaging import api, auth, listing, open_chat, send, BASE


def test_market_delivery_rechecks_recipient_read_marker_and_block_at_dispatch(api):
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    notes = main.operations_store.run(lambda u: u.find('notifications', 'user_id', 'worker'))
    first = notes[0]
    allowed = lambda note: main.operations_store.run(lambda u: market_chat_delivery_allowed(u, note))
    assert allowed(first)
    assert not allowed({**first, 'user_id': 'stranger'})
    assert not allowed({**first, 'market_message_seq': 1000})
    assert not allowed({**first, 'market_message_seq': '1'})
    assert api.post(f'{BASE}/{cid}/read', headers=auth('worker'), json={'through_seq': 1}).status_code == 200
    assert not allowed(first)
    send(api, cid)
    second = max(main.operations_store.run(lambda u: u.find('notifications', 'user_id', 'worker')), key=lambda n: n['market_message_seq'])
    assert allowed(second)
    assert api.post(f'{BASE}/{cid}/block', headers=auth('worker2'), json={'blocked': True}).status_code == 200
    assert not allowed(second)


def test_market_delivery_has_no_fallback_for_a_missing_conversation(api):
    assert not main.operations_store.run(lambda u: market_chat_delivery_allowed(u, {'market_chat_id': 'missing', 'user_id': 'worker', 'market_message_seq': 1}))
