"""Private bike/cab push events carried by the existing durable FCM relay."""
import time


def role_for(ride, uid, kind):
    if uid == ride.get('customer_id'):
        return 'customer'
    if uid == ride.get('driver_id') and (kind != 'bike' or ride.get('assigned_at')):
        return 'driver'
    if kind == 'cab' and (uid == ride.get('owner_id') or
            (ride.get('state') == 'requested' and uid in ride.get('candidate_owner_ids', []))):
        return 'cab_owner'
    return None


def enqueue(u, ride, uid, notification_id, kind):
    role = role_for(ride, uid, kind)
    if not role or (kind == 'cab' and ride.get('mode') != 'cab'):
        return
    events = ride.get('events', [])
    if events and events[-1].get('actor') == uid:
        return
    state = ride['state']
    if state in ('dispatch_pending', 'declined', 'expired'):
        return
    now = time.time()
    request = state in ('offered', 'queued', 'requested') and role != 'customer' and not ride.get('accepted_by_driver')
    expiry = min(now + 900, ride.get('expires_at' if kind == 'bike' else 'offer_expires_at', now + 900)) if request else now + 900
    if expiry <= now:
        return
    u.put('rp_work_delivery', notification_id, {
        'id': notification_id, 'notification_id': notification_id, 'event': 'ride_update',
        'target_id': ride['id'], 'recipient_id': uid, 'sender_id': '',
        'ride_kind': kind, 'ride_role': role, 'ride_version': ride['version'],
        'ride_state': state, 'alert_kind': 'request' if request else 'arrival' if state == 'arrived' and role == 'customer' else 'update',
        'delivery_status': 'pending', 'created_at': now, 'expires_at': expiry,
    })


def delivery_allowed(u, delivery):
    kind = delivery.get('ride_kind')
    if kind not in ('bike', 'cab') or delivery.get('expires_at', 0) <= time.time():
        return False
    ride = u.get('bike_rides' if kind == 'bike' else 'mobility_rides', delivery['target_id'])
    if not ride or ride.get('version') != delivery.get('ride_version') or ride.get('state') != delivery.get('ride_state'):
        return False
    if role_for(ride, delivery['recipient_id'], kind) != delivery.get('ride_role'):
        return False
    if delivery.get('alert_kind') == 'request':
        return not ride.get('accepted_by_driver') and ride.get('expires_at' if kind == 'bike' else 'offer_expires_at', 0) > time.time()
    return True
