"""Recheck private conversation ownership and read state at push dispatch time."""


def market_chat_delivery_allowed(u, notification):
    chat = u.get('market_chats', notification.get('market_chat_id', ''))
    if not chat or chat.get('buyer_blocked') or chat.get('seller_blocked'):
        return False
    uid = notification.get('user_id')
    role = 'buyer' if uid == chat.get('buyer_id') else 'seller' if uid == chat.get('seller_id') else None
    seq = notification.get('market_message_seq')
    return bool(role and type(seq) is int and chat.get(role + '_read_seq', 0) < seq <= chat.get('latest_seq', 0))
