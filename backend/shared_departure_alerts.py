"""Scheduled shared-ride reminders, with fresh, private arrival checks."""
import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from local_business import digest
from operations import metres

WINDOW = 900
FRESH_SECONDS = 75


def india_time(stamp):
    return datetime.fromtimestamp(stamp, ZoneInfo('Asia/Kolkata')).strftime('%d %b, %I:%M %p')


def index_record(u, key, row):
    previous = u.get('shared_departure_due', key) or {}
    same = previous.get('starts_at') == row['starts_at']
    due = previous.get('next_at', row['starts_at'] - WINDOW) if same else row['starts_at'] - WINDOW
    active = row['state'] == 'scheduled' and not (same and previous.get('done'))
    u.put('shared_departure_due', key, {'id': key, 'starts_at': row['starts_at'],
        'next_at': due, 'done': same and previous.get('done', False),
        'sortKey': f'{max(1,int(due * 1000)):013d}:{key}' if active else '0000000000000:' + key})


def arrival(u, row, passenger, now=None):
    now = time.time() if now is None else now
    cab = u.get('journey_locations', 'shared:' + row['id'])
    person = u.get('shared_arrivals', passenger['id'])
    cab = cab if cab and 0 <= now - cab['received_at'] <= FRESH_SECONDS else None
    person = person if person and 0 <= now - person['received_at'] <= FRESH_SECONDS else None
    distance = metres(cab, person) if cab and person else None
    # Accuracy uncertainty never qualifies someone as safely within the boundary.
    uncertainty = cab['accuracy'] + person['accuracy'] if distance is not None else None
    inside = distance is not None and distance + uncertainty <= 300
    outside = distance is not None and distance - uncertainty > 300
    return {'cab_position': {k: cab[k] for k in ('lat','lng','accuracy','received_at')} if cab else None,
        'location_status': 'inside' if inside else 'outside' if outside else 'unknown',
        'distance_metres': round(distance) if distance is not None else None,
        'radius_metres': 300, 'server_time': now}


def enqueue(u, row, uid, title, body, event, key, passenger=None):
    old = u.get('notifications', key)
    if old:
        return False
    now = time.time()
    role = 'cab_owner' if uid == row['owner_id'] else 'driver' if uid == row.get('driver_id') else 'customer'
    note = {'id': key, 'user_id': uid, 'kind': 'local_business', 'destination': 'mobility',
        'business_id': row['id'], 'title': title, 'body': body, 'created_at': now, 'read': False,
        'event_type': event, 'scheduled_start': row['starts_at'], 'business_role': role}
    u.put('notifications', key, note)
    u.put('rp_work_delivery', key, {'id': key, 'recipient_id': uid, 'sender_id': row['owner_id'],
        'notification_id': key, 'event': 'shared_transport', 'transport_event': event,
        'target_id': row['id'], 'passenger_id': passenger['id'] if passenger else None,
        'scheduled_start': row['starts_at'], 'business_role': role,
        'delivery_status': 'pending', 'created_at': now, 'expires_at': min(now + 86400, row['starts_at'] + 300 if event in ('departure_reminder','rescheduled') else max(now+900,row['ends_at']+300))})
    return True


def remind_passenger(u, row, p, now):
    if p['state'] != 'accepted' or not row['starts_at'] - WINDOW <= now < row['starts_at']:
        return False
    check = arrival(u, row, p, now)
    if check['location_status'] == 'inside':
        return False
    body = f"Departure is at {india_time(row['starts_at'])} (India time). "
    body += 'You are outside the cab’s 300 m arrival area. Open your ride for directions to its latest location.' if check['location_status'] == 'outside' else 'Open your ride to check the cab’s latest location and directions. Your arrival location has not been confirmed.'
    key = digest(f"shared-reminder:{row['id']}:{row['starts_at']}:{p['id']}")
    return enqueue(u, row, p['customer_id'], 'Your shared ride departs soon', body, 'departure_reminder', key, p)


def process_departures(core, limit=40):
    def select(u):
        floor, ceiling = '0000000000001:', f'{int(time.time()*1000):013d}:~'
        if u.tx is not None:
            q = u.core.fs_collection('ops_shared_departure_due').where('sortKey','>=',floor).where('sortKey','<=',ceiling).order_by('sortKey').limit(limit)
            return [s.to_dict() for s in q.stream(transaction=u.tx)]
        return [json.loads(r['body']) for r in u.conn.execute("SELECT body FROM operation_records WHERE kind='shared_departure_due' AND json_extract(body,'$.sortKey')>=? AND json_extract(body,'$.sortKey')<=? ORDER BY json_extract(body,'$.sortKey') LIMIT ?", (floor,ceiling,limit))]
    changed = 0
    references = core.operations_store.run(select)
    for ref in references:
        def run(u):
            row = u.get('shared_departures', ref['id'])
            due = u.get('shared_departure_due', ref['id'])
            now = time.time()
            if not row or not due or due.get('done') or due['next_at'] > now:
                return 0
            count = 0
            active = row['state'] == 'scheduled' and now < row['starts_at']
            if active and now >= row['starts_at'] - WINDOW:
                from mobility_journeys import capacity, passenger_rows
                available = capacity(u, row)
                for uid in {row['owner_id'], row.get('driver_id')} - {None}:
                    key = digest(f"shared-driver-reminder:{row['id']}:{row['starts_at']}:{uid}")
                    body = f"Departure is at {india_time(row['starts_at'])} (India time). " + (f'{available} seats are still available. Open the departure to review passengers or reschedule with a reason.' if available else 'Review passenger boarding and share the cab’s live location.')
                    count += enqueue(u,row,uid,'Shared ride departure is coming up',body,'departure_reminder',key)
                for p in passenger_rows(u,row['id']):
                    count += remind_passenger(u,row,p,now)
            if not active:
                from mobility_journeys import passenger_rows
                for p in passenger_rows(u,row['id']):
                    point = u.get('shared_arrivals',p['id'])
                    if point and point.get('received_at',0):
                        u.put('shared_arrivals',p['id'],{'received_at':0})
            due.update(next_at=min(now + 30, row['starts_at']), done=not active)
            due['sortKey'] = f"{int(due['next_at']*1000):013d}:{row['id']}" if active else '0000000000000:' + row['id']
            u.put('shared_departure_due', row['id'], due)
            return count
        changed += core.operations_store.run(run)
    return {'processed': len(references), 'notifications': changed}


def backfill(core, limit=20):
    from repaidians_opportunities import native_scan
    def run(u):
        checkpoint = u.get('shared_departure_backfill', 'v1') or {}
        if checkpoint.get('complete'):
            return {'complete': True, 'indexed': 0}
        rows = native_scan(u, 'shared_departures', checkpoint.get('after',''), limit + 1)
        for key, row in rows[:limit]:
            if not u.get('shared_departure_due', key):
                index_record(u,key,row)
        u.put('shared_departure_backfill','v1',{'after': rows[min(limit,len(rows))-1][0] if rows else checkpoint.get('after',''), 'complete': len(rows)<=limit})
        return {'indexed': min(limit,len(rows)), 'complete': len(rows)<=limit}
    return core.operations_store.run(run)


def delivery_allowed(u, delivery):
    from mobility_journeys import actor, passenger_rows
    row = u.get('shared_departures', delivery.get('target_id',''))
    now = time.time()
    if not row or delivery.get('expires_at',0)<=now or row['starts_at'] != delivery.get('scheduled_start'):
        return False
    uid = delivery['recipient_id']
    p = next((p for p in passenger_rows(u,row['id']) if p['customer_id']==uid), None)
    if not actor(row,uid) and not p:
        return False
    if delivery.get('transport_event') == 'departure_reminder':
        return row['state']=='scheduled' and row['starts_at']-WINDOW<=now<row['starts_at'] and (actor(row,uid) or p['state']=='accepted' and arrival(u,row,p,now)['location_status']!='inside')
    return True
