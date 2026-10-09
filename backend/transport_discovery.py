"""Bounded pickup-area discovery references; native records remain authoritative."""
import hashlib
import math

RADIUS_METRES = 20000


def columns(band):
    latitude = -90 + (band + .5) * .25
    return max(1, round(360 * 111320 * math.cos(math.radians(latitude)) / 25000))


def cell(pin):
    band = min(719, max(0, int((pin['lat'] + 90) / .25)))
    count = columns(band)
    col = int(((pin['lng'] + 180) % 360) / 360 * count) % count
    return band, col


def lane(band, col):
    return 'transport_shared_' + hashlib.sha256(f'{band}:{col}'.encode()).hexdigest()[:24]


def nearby_lanes(pin):
    # A spherical bounding box includes every pickup within the discovery radius,
    # including across the date line and close to the poles.
    angular = RADIUS_METRES / 6371000
    delta_lat = math.degrees(angular)
    first = max(0, int((pin['lat'] - delta_lat + 90) / .25))
    last = min(719, int((pin['lat'] + delta_lat + 90) / .25))
    polar = abs(pin['lat']) + delta_lat >= 90
    delta_lng = 180 if polar else math.degrees(math.asin(min(1, math.sin(angular) / math.cos(math.radians(pin['lat'])))))
    out = set()
    for band in range(first, last + 1):
        count = columns(band)
        lo = math.floor((pin['lng'] - delta_lng + 180) / 360 * count)
        hi = math.floor((pin['lng'] + delta_lng + 180) / 360 * count)
        for col in range(lo, hi + 1):
            out.add(lane(band, col % count))
    return sorted(out)


def index_record(u, key, row):
    reference = {'lane': lane(*cell(row['origin'])), 'key': f"{int(row['starts_at'] * 1000):016d}:{key}"}
    previous = u.get('transport_shared_refs', key)
    if previous and previous != reference:
        u.put(previous['lane'], previous['key'], {'id': previous['key'], 'active': False, 'departure_id': key})
    u.put(reference['lane'], reference['key'], {'id': reference['key'], 'active': row['state'] == 'scheduled', 'departure_id': key})
    u.put('transport_shared_refs', key, reference)


def candidates(u, pin, now):
    from repaidians_work import active_query
    after = f'{int(now * 1000):016d}:\uffff'
    ids = {ref['departure_id'] for channel in nearby_lanes(pin) for ref in active_query(u, channel, 32, after)}
    u.prefetch([('shared_departures', key) for key in ids])
    return [row for key in ids if (row := u.get('shared_departures', key))]
