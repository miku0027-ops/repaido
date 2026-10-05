"""Public catalogue discovery and opt-in, account-scoped category preferences.

No location/query history, inferred urgency, discounts, or marketing subscriptions.
Booking and payouts remain authoritative in the existing operations pipeline.
"""
import time
import re
import hashlib
import math
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import Field
from operations import Input, Pin, metres, fail


class Search(Input):
    query: str = Field(default='', max_length=120)
    category: str = Field(default='', max_length=60)
    city: str = Field(max_length=80)
    location: Pin | None = None
    radius_km: float = Field(default=8, gt=0, le=8)
    sort: Literal['relevance', 'price', 'price_desc', 'duration', 'distance', 'rating', 'experience'] = 'relevance'
    max_price_paise: int | None = Field(default=None, ge=0, le=100000000)
    role: Literal['', 'technician', 'specialist'] = ''
    min_price_paise: int = Field(default=0, ge=0, le=100000000)
    max_duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    min_rating: float = Field(default=0, ge=0, le=5)
    min_experience: int = Field(default=0, ge=0, le=50)


class Consent(Input):
    enabled: bool
    consent_version: Literal[2] | None = None


class Behaviour(Input):
    event_id: str = Field(min_length=16, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    kind: Literal['search', 'category_view', 'service_view', 'banner_open']
    service_id: str = Field(default='', max_length=100)
    category: str = Field(default='', max_length=60)
    query: str = Field(default='', max_length=120)


class Interest(Input):
    service_id: str = Field(min_length=1, max_length=100)


ALIASES = {'plumber': 'plumbing', 'electrician': 'electrical', 'aircon': 'ac',
           'air conditioning': 'ac', 'car wash': 'vehicle car', 'fridge': 'refrigerator',
           'geyser': 'water heater', 'cleaner': 'cleaning'}


def terms(text):
    text = text.casefold().strip()
    for key, value in ALIASES.items():
        text = re.sub(r'\b'+re.escape(key)+r'\b', value, text)
    return set(re.findall(r'\w+', text))


def relevance(query, text):
    words = terms(query)
    haystack = terms(text)
    return sum(any(t.startswith(w) for t in haystack) for w in words) / max(1, len(words)) if words else 1


def install(core):
    router = APIRouter(prefix='/operations/discovery', tags=['Discovery'])
    store = core.operations_store

    @router.post('/search')
    def search(body: Search):
        from home_plans import OFFERINGS
        if body.max_price_paise is not None and body.min_price_paise > body.max_price_paise:
            fail('INVALID_BUDGET', 'Minimum price must not exceed maximum price.', 422)
        catalog = core.catalog()
        services = [s for s in catalog['services'] if s.get('active', True) and (not body.category or s['category'] == body.category)]
        category_names = {c['id']: c['name'] for c in catalog['categories']}
        categories = list(catalog['categories'])
        for s in catalog['services']:
            if s.get('active', True) and s['category'] not in category_names:
                label = {'car': 'Vehicle services', 'gardening': 'Gardening', 'moving': 'Moving'}.get(s['category'], s['category'].replace('_', ' ').title())
                category_names[s['category']] = label
                categories.append({'id': s['category'], 'name': label})
        scored = [(relevance(body.query, ' '.join([s['name'], s['category'], category_names.get(s['category'], ''), s.get('description', '')])), s) for s in services]
        services = [s for score, s in sorted(scored, key=lambda pair: (-pair[0], pair[1]['name'])) if score > 0 and s['price_paise'] >= body.min_price_paise and (body.max_price_paise is None or s['price_paise'] <= body.max_price_paise) and (body.max_duration_minutes is None or s['duration_minutes'] <= body.max_duration_minutes)]
        if body.sort == 'price': services.sort(key=lambda s: (s['price_paise'], s['name']))
        if body.sort == 'price_desc': services.sort(key=lambda s: (-s['price_paise'], s['name']))
        if body.sort == 'duration': services.sort(key=lambda s: (s['duration_minutes'], s['name']))
        matching_categories = {s['category'] for s in services}
        def read(u):
            workers = []
            if body.location and body.city in core.CITIES:
                for w in u.all('workers'):
                    p = w.get('position')
                    if w.get('status') != 'approved' or not w.get('online') or w['city'].casefold() != body.city.casefold(): continue
                    if not p or not 0 <= time.time()-p.get('received_at', 0) <= 900 or p.get('accuracy', 1000) > 100: continue
                    if body.category and body.category not in w['categories']: continue
                    if body.role and body.role != w['role']: continue
                    if (w.get('experience_years') or 0) < body.min_experience: continue
                    if body.min_rating and (not w['rating_count'] or w['rating_sum']/w['rating_count'] < body.min_rating): continue
                    match = relevance(body.query, ' '.join([w['name'], *w['skills'], *w['categories']]))
                    if body.query and match == 0 and not matching_categories.intersection(w['categories']): continue
                    distance = metres(body.location.model_dump(), p)/1000
                    # The discovery radius never overrides the professional's accepted travel limit.
                    if distance > min(body.radius_km, w['radius_km'], 6): continue
                    safe = {k: w[k] for k in ('id','name','role','categories','skills','tools','experience_years','completed_tasks','rating_count','rating_sum')}
                    safe['distance_km'] = round(distance, 1)
                    safe['rating'] = round(w['rating_sum']/w['rating_count'], 2) if w['rating_count'] else None
                    # Five neutral 4/5 prior observations prevent one review dominating ranking.
                    score = (w['rating_sum']+20)/(w['rating_count']+5)
                    safe['_rank'] = (match, score, -distance)
                    workers.append(safe)
            workers.sort(key=lambda w: (w['distance_km'], w['id']) if body.sort == 'distance' else (*(-v for v in w['_rank']), w['id']))
            if body.sort == 'rating': workers.sort(key=lambda w: (-(w['rating'] or 0), -w['rating_count'], w['distance_km'], w['id']))
            if body.sort == 'experience': workers.sort(key=lambda w: (-w['experience_years'], w['distance_km'], w['id']))
            for w in workers: w.pop('_rank')
            return workers[:24]
        workers = store.run(read)
        public_services = [{k: s[k] for k in ('id','name','category','description','price_paise','duration_minutes','included','excluded')} for s in services[:60]]
        home_services = [s for s in OFFERINGS if (not body.category or s['category']==body.category) and relevance(body.query,s['name']+' '+s['description'])>0] if body.max_price_paise is None and not body.min_price_paise and body.max_duration_minutes is None else []
        return {'services': public_services, 'home_services': home_services, 'professionals': workers, 'categories': categories,
                'suggestion_catalog': [{'label':s['name'],'category':s['category'],'kind':'Service'} for s in catalog['services'] if s.get('active',True)]+[{'label':s['name'],'category':s['category'],'kind':'Home plan'} for s in OFFERINGS]+[{'label':c['name'],'category':c['id'],'kind':'Category'} for c in categories],
                'radius_km': body.radius_km, 'distance_type': 'straight_line',
                'location_required': body.location is None, 'covered': body.city in core.CITIES,
                'offers': [], 'offers_status': 'No active, bookable offers are configured.',
                'ranking': 'Service match, review confidence, then distance. Only approved, online professionals with a location updated in the last 15 minutes are shown. Each worker’s travel limit and the current 6 km booking coverage still apply. Availability is confirmed after your request.'}

    def settings(row):
        row = row or {}
        enabled = bool(row.get('enabled') and row.get('consent_version') == 2)
        return {'enabled': enabled, 'categories': row.get('categories', {}) if enabled else {}, 'consent_version': 2}

    @router.get('/preferences')
    def preferences(user=Depends(core.current_user)):
        return store.run(lambda u: settings(u.get('discovery_preferences', user['id'])))

    @router.put('/preferences')
    def consent(body: Consent, user=Depends(core.current_user)):
        if body.enabled and body.consent_version != 2: fail('CONSENT_UPDATED', 'Refresh Repaido to review the current personalisation options.', 409)
        def save(u):
            previous = u.get('discovery_preferences', user['id']) or {}
            row = previous if body.enabled and settings(previous)['enabled'] else {}
            row.update(enabled=body.enabled, consent_version=2, updated_at=time.time())
            row.setdefault('categories', {})
            u.put('discovery_preferences', user['id'], row)
            return settings(row)
        return store.run(save)

    @router.post('/preferences/reset')
    def reset(user=Depends(core.current_user)):
        def save(u):
            enabled = settings(u.get('discovery_preferences', user['id']))['enabled']
            row = dict(enabled=enabled, consent_version=2, categories={}, updated_at=time.time())
            u.put('discovery_preferences', user['id'], row)
            return settings(row)
        return store.run(save)

    def record(body, user):
        from home_plans import OFFERINGS
        catalog = core.catalog()
        services = [s for s in catalog['services'] if s.get('active', True)]+[{**s,'id':'home:'+s['id']} for s in OFFERINGS]
        categories = {s['category'] for s in services}
        targets = []
        # Queries are resolved transiently; never store raw keywords, locations or form contents.
        if body.kind == 'search':
            if len(body.query.strip()) >= 2:
                scored = [(relevance(body.query, ' '.join([s['name'], s['category']])), s['category']) for s in services]
                top = max((v for v, _ in scored), default=0)
                targets = sorted({c for v, c in scored if v == top and v >= .67})[:3]
            target = 'search:' + ','.join(targets)
        elif body.kind == 'category_view':
            if body.category not in categories: fail('CATEGORY_UNAVAILABLE', 'Choose a listed category.', 404)
            targets = [body.category]; target = 'category:' + body.category
        else:
            service = next((s for s in services if s['id'] == body.service_id), None)
            if not service: fail('SERVICE_UNAVAILABLE', 'This service is no longer listed.', 404)
            targets = [service['category']]; target = 'service:' + service['id']
        def save(u):
            row = u.get('discovery_preferences', user['id']) or {}
            if not settings(row)['enabled']: fail('CONSENT_REQUIRED', 'Enable optional personalised suggestions first.', 403)
            now = time.time()
            seen = {k:v for k,v in row.get('seen', {}).items() if now-v < 86400}
            if body.event_id in seen: return {'recorded': False, 'reason': 'duplicate'}
            if not targets: return {'recorded': False, 'reason': 'no_catalogue_match'}
            recent = {k:v for k,v in row.get('recent', {}).items() if now-v < 60}
            if target in recent or now-row.get('last_event_at', 0) < 1: return {'recorded': False, 'reason': 'frequency_limit'}
            day = int(now//86400)
            total = row.get('daily_count', 0) if row.get('event_day') == day else 0
            if total >= 100: return {'recorded': False, 'reason': 'daily_limit'}
            weight = {'search': 1.5, 'category_view': 1, 'service_view': 2, 'banner_open': .5}[body.kind]
            signals = {k:v for k,v in row.get('signals', {}).items() if k in categories and now-v.get('at', 0) < 30*86400}
            for category in targets:
                old = signals.get(category, {})
                score = old.get('score', 0) * math.exp(-max(0,now-old.get('at', now))/(7*86400))
                signals[category] = {'score': min(30,score+weight/len(targets)), 'visits': min(100,old.get('visits',0)+1), 'at':now}
            seen[body.event_id] = now; recent[target] = now
            row.update(signals=signals, categories={k:v['visits'] for k,v in signals.items()},
                       seen=dict(sorted(seen.items(),key=lambda kv:kv[1])[-100:]), recent=recent,
                       last_event_at=now, event_day=day, daily_count=total+1)
            u.put('discovery_preferences', user['id'], row)
            return {'recorded': True, 'categories': targets}
        return store.run(save)

    @router.post('/events')
    def event(body: Behaviour, user=Depends(core.current_user)):
        return record(body, user)

    @router.post('/interest')
    def interest(body: Interest, user=Depends(core.current_user)):
        # Backward-compatible entry for older customer shells.
        return record(Behaviour(event_id=hashlib.sha256((body.service_id+str(time.time_ns())).encode()).hexdigest(), kind='service_view', service_id=body.service_id), user)

    def hydrate(city, user=None):
        catalog = core.catalog()
        names = {c['id']:c['name'] for c in catalog['categories']}
        groups = {}
        for service in catalog['services']:
            if service.get('active',True): groups.setdefault(service['category'], []).append(service)
        now = time.time()
        row = store.run(lambda u: u.get('discovery_preferences', user['id'])) if user else None
        enabled = settings(row)['enabled']
        row = row or {}
        scores = {k:v.get('score',0)*math.exp(-max(0,now-v.get('at',now))/(7*86400)) for k,v in row.get('signals',{}).items()
                  if enabled and k in groups and v.get('visits',0)>=2 and now-v.get('at',0)<30*86400}
        # Daily deterministic rotation adds variety without reshuffling while someone reads.
        seed = city.casefold()+str(int(now//86400))
        varied = sorted(groups,key=lambda c:hashlib.sha256((seed+c).encode()).hexdigest())
        interested = sorted((c for c in scores if scores[c]>=1),key=lambda c:(-scores[c],c))[:3]
        remaining = [c for c in varied if c not in interested]
        selected = []
        for n in range(3):
            if n<len(interested): selected.append(interested[n])
            if remaining: selected.append(remaining.pop(0))
        selected = (selected+remaining)[:6]
        cards=[]
        for category in selected:
            rows=sorted(groups[category],key=lambda s:s['id'])
            service=rows[int(hashlib.sha256((seed+category).encode()).hexdigest()[:8],16)%len(rows)]
            cards.append({'category':category,'category_name':names.get(category,category.replace('_',' ').title()),
                          'reason':'Based on categories you explored' if category in interested else 'Explore another category',
                          'personalised':category in interested,
                          'service':{k:service[k] for k in ('id','name','category','description','price_paise','duration_minutes','included','excluded')}})
        return {'cards':cards, 'personalised':enabled, 'covered':city in core.CITIES,
                'policy_version':2, 'basis':'Repeated catalogue searches and service/category visits, with recent interests weighted more. Some categories stay varied. Suggestions do not diagnose a need or change prices. Availability is confirmed when booking.'}

    @router.get('/feed')
    def general_feed(city:str='Balasore'):
        if len(city)>80:fail('INVALID_CITY','Choose a service city.',422)
        return hydrate(city)

    @router.get('/feed/personal')
    def personal_feed(city:str='Balasore',user=Depends(core.current_user)):
        if len(city)>80:fail('INVALID_CITY','Choose a service city.',422)
        return hydrate(city,user)

    core.app.include_router(router)
