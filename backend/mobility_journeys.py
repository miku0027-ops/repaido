"""Scheduled car/bike journeys and consented, expiring transport location access."""
import copy, json, math, os, secrets, time, urllib.request, uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Response, Query
from pydantic import Field
from operations import Input, Pin, Position, fail, metres
from local_business import current, digest, event, fingerprint, live_vehicle, schedule, reservation_guard, vehicle_public

ACTIVE = {'on_the_way', 'in_progress'}
PASSENGERS = {'accepted', 'boarded'}
HEADERS = {'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer', 'X-Robots-Tag':'noindex, nofollow'}
class Departure(Input):
    request_id:str=Field(min_length=16,max_length=100)
    vehicle_id:str
    origin:Pin
    destination:Pin
    origin_address:str=Field(min_length=5,max_length=300)
    destination_address:str=Field(min_length=5,max_length=300)
    starts_at:float
    ends_at:float
    seats:int=Field(ge=1,le=12)
    price_paise:int=Field(gt=0,le=10000000,strict=True)
    pickup_mode:Literal['meeting_point','collect_on_route']='meeting_point'
    terms:str=Field(min_length=20,max_length=2000)
class Search(Input):
    pickup:Pin
    dropoff:Pin
    starts_at:float
    until:float
    seats:int=Field(default=1,ge=1,le=12)
class Join(Input):
    request_id:str=Field(min_length=16,max_length=100)
    expected_version:int=Field(ge=1)
    pickup:Pin
    dropoff:Pin
    seats:int=Field(ge=1,le=12)
    consent:Literal[True]
class Action(Input):
    command_id:str=Field(min_length=16,max_length=100)
    expected_version:int=Field(ge=1)
    action:Literal['accept','decline','cancel','board','start','dropoff','complete','payment_reported','payment_received']
    passenger_id:str|None=None
class Consent(Input):
    enabled:bool
class Driver(Input):
    driver_id:str=Field(min_length=1,max_length=100)
class DriverAnswer(Input):
    accept:bool
class Share(Input):
    passenger_id:str|None=None

def road_route(origin,destination,vehicle_kind="car"):
    key=os.getenv('GOOGLE_ROUTES_API_KEY','').strip()
    if not key:fail('ROUTING_UNAVAILABLE','Route publication is unavailable until the driving route provider is connected.',503)
    point=lambda p:{'location':{'latLng':{'latitude':p['lat'],'longitude':p['lng']}}}
    req=urllib.request.Request('https://routes.googleapis.com/directions/v2:computeRoutes',data=json.dumps({'origin':point(origin),'destination':point(destination),'travelMode':'TWO_WHEELER' if vehicle_kind=='bike' else 'DRIVE','polylineQuality':'HIGH_QUALITY','polylineEncoding':'GEO_JSON_LINESTRING'}).encode(),headers={'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters,routes.polyline.geoJsonLinestring'})
    try:
        with urllib.request.urlopen(req,timeout=12) as response:r=json.load(response)['routes'][0]
        points=[{'lat':float(p[1]),'lng':float(p[0])} for p in r['polyline']['geoJsonLinestring']['coordinates']]
        if not 2<=len(points)<=20000 or not 100<=r['distanceMeters']<=500000:raise ValueError()
        if any(not math.isfinite(p['lat']) or not math.isfinite(p['lng']) or not -90<=p['lat']<=90 or not -180<=p['lng']<=180 for p in points):raise ValueError()
        if metres(origin,points[0])>2000 or metres(destination,points[-1])>2000:raise ValueError()
        return {'points':points,'distance_metres':r['distanceMeters'],'provider':'google_routes'}
    except Exception:fail('ROUTE_FAILED','The road route could not be confirmed. Check the pins and retry.',503)

def project(point,points):
    """Nearest point and cumulative distance along the actual provider road polyline."""
    best=(float('inf'),0,None);travelled=0
    for a,b in zip(points,points[1:]):
        scale=math.cos(math.radians(point['lat']));x=lambda p:(p['lng']-point['lng'])*111320*scale;y=lambda p:(p['lat']-point['lat'])*111320
        ax,ay,bx,by=x(a),y(a),x(b),y(b);dx,dy=bx-ax,by-ay;length=math.hypot(dx,dy)
        t=max(0,min(1,-(ax*dx+ay*dy)/(length*length))) if length else 0
        distance=math.hypot(ax+t*dx,ay+t*dy)
        if distance<best[0]:best=(distance,travelled+t*length,{'lat':a['lat']+t*(b['lat']-a['lat']),'lng':a['lng']+t*(b['lng']-a['lng'])})
        travelled+=length
    return best

def match(row,pickup,dropoff):
    a=project(pickup,row['route']['points']);b=project(dropoff,row['route']['points'])
    if a[0]>2000 or b[0]>2000 or b[1]-a[1]<500:return None
    return {'pickup':a[2],'dropoff':b[2],'pickup_walk_metres':round(a[0]),'dropoff_walk_metres':round(b[0]),'route_metres':round(b[1]-a[1])}

def passenger_rows(u,identifier):return u.find('shared_passengers','departure_id',identifier)
def capacity(u,row):return row['seats']-sum(p['seats'] for p in passenger_rows(u,row['id']) if p['state'] in PASSENGERS)
def actor(row,uid):return uid in (row.get('owner_id'),row.get('driver_id'))
def public(row,available):
    return {k:copy.deepcopy(row.get(k)) for k in ('id','vehicle_name','vehicle_kind','owner_name','origin','destination','origin_address','destination_address','starts_at','ends_at','seats','price_paise','pickup_mode','terms','state','version')}|{'available_seats':available}
def notify(u,row,uid,title,discriminator=""):
    identifier=digest('journey:'+row['id']+':'+str(row['version'])+':'+uid+':'+title+':'+discriminator)
    body='Open Shared rides in your business app to review passengers and pickup details.' if actor(row,uid) else 'Open Bookings → Rides for the pickup pin and journey status.'
    u.put('notifications',identifier,{'id':identifier,'user_id':uid,'title':title,'body':body,'kind':'local_business','destination':'mobility','business_id':row['id'],'created_at':time.time(),'read':False})
def get_row(u,kind,identifier):
    row=u.get('shared_departures' if kind=='shared' else 'mobility_rides',identifier)
    if not row:fail('NOT_FOUND','Journey unavailable.',404)
    return row

def allowed(u,kind,row,uid):
    if actor(row,uid):return True
    if kind=='rides':return uid==row['customer_id']
    return any(p['customer_id']==uid and p['state'] in (*PASSENGERS,'completed') for p in passenger_rows(u,row['id']))
def fresh(pos):
    if not all(math.isfinite(v) for v in (pos.lat,pos.lng,pos.accuracy,pos.captured_at)) or not 0<pos.accuracy<=100 or abs(time.time()-pos.captured_at)>120:fail('PRECISE_LOCATION_REQUIRED','Get a fresh, precise GPS reading within 100 metres.',422)
def location_value(u,kind,row):return u.get('journey_locations',kind+':'+row['id'])
def inside(u,kind,row,pin):
    loc=location_value(u,kind,row)
    if not loc or time.time()-loc['received_at']>75 or metres(loc,pin)+loc['accuracy']>300:fail('GEOFENCE_REQUIRED','Send a fresh GPS reading within 300 metres of the agreed pickup or stop.',409)
def tracking_value(u,kind,row):
    loc=location_value(u,kind,row);active=row['state'] in ACTIVE
    return {'id':row['id'],'kind':kind,'state':row['state'],'server_time':time.time(),'vehicle_name':row.get('vehicle_name') or (row.get('quote') or {}).get('vehicle',{}).get('name','Vehicle'),'position':loc if active and loc and time.time()-loc['received_at']<=75 else None,'location_status':'live' if active and loc and time.time()-loc['received_at']<=75 else 'ended' if not active else 'waiting','origin':row.get('origin',row.get('pickup')),'destination':row.get('destination',row.get('dropoff')),'route':row.get('route',{}).get('points',[]),'sharing_active':active}
def write_position(u,kind,row,pos,source):
    fresh(pos)
    if row['state'] not in ACTIVE:fail('NOT_ACTIVE','Location updates are accepted only during an active journey.',409)
    key=kind+':'+row['id'];previous=u.get('journey_locations',key)
    if previous and pos.captured_at<=previous['captured_at']:fail('STALE_POSITION','A newer position has already arrived.',409)
    if previous and time.time()-previous['received_at']<5:fail('POSITION_RATE_LIMIT','Wait before sending another location.',429)
    distance=project(pos.model_dump(),row['route']['points'])[0] if row.get('route') else None
    loc={**pos.model_dump(),'received_at':time.time(),'source':source,'outside_route':distance>1000+pos.accuracy if distance is not None else None}
    u.put('journey_locations',key,loc)
    if loc['outside_route'] and not (previous or {}).get('outside_route'):
        for uid in {row['owner_id'],*([row['customer_id']] if kind=='rides' else [p['customer_id'] for p in passenger_rows(u,row['id']) if p['state']=='boarded'])}:notify(u,row,uid,'Vehicle location is outside the planned route')
    return loc

def native_position(u,authorization,body=None):
    key=digest(authorization.removeprefix('Bearer '));session=u.get('journey_tracking',key)
    if not session:return None
    if session['expires_at']<=time.time():fail('TRACKING_EXPIRED','Reopen the journey to renew location sharing.',410)
    kind=session['kind'];row=get_row(u,kind,session['record_id']);uid=session['user_id']
    consent=u.get('journey_consents',kind+':'+row['id']+':'+uid) or {}
    if not actor(row,uid) or not consent.get('enabled') or consent.get('generation')!=session['generation']:fail('TRACKING_ENDED','Location sharing has ended.',410)
    if body is None:
        consent['enabled']=False;u.put('journey_consents',kind+':'+row['id']+':'+uid,consent)
        loc=location_value(u,kind,row)
        if loc:loc['received_at']=0;u.put('journey_locations',kind+':'+row['id'],loc)
        return {'status':'stopped'}
    current(u,uid,('cab_owner','driver'))
    if body.sequence<=session['sequence']:return {'status':'already_received'}
    if time.time()-session.get('last_at',0)<10:fail('POSITION_RATE_LIMIT','Wait before another reading.',429)
    live={**row,'state':'on_the_way'} if ((kind=='shared' and row['state']=='scheduled') or (kind=='rides' and row['state']=='reserved')) and row['starts_at']-3600<=time.time()<=row['ends_at'] else row
    if live['state'] not in ACTIVE:fail('TRACKING_ENDED','This journey has ended.',410)
    write_position(u,kind,live,Position(**body.model_dump(exclude={'sequence'})),'driver_phone')
    session.update(sequence=body.sequence,last_at=time.time());u.put('journey_tracking',key,session)
    return {'status':'received'}

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations/local-business',tags=['Shared journeys and tracking'])
    @r.get('/transport/nearby')
    def nearby(lat:float=Query(ge=-90,le=90),lng:float=Query(ge=-180,le=180)):
        from transport_discovery import candidates, RADIUS_METRES
        if not math.isfinite(lat) or not math.isfinite(lng):fail('LOCATION_REQUIRED','Choose your pickup area on the map.',422)
        pin={'lat':lat,'lng':lng};now=time.time()
        def read(u):
            departures=[]
            nearby_rows=sorted(candidates(u,pin,now),key=lambda row:(row['starts_at'],metres(pin,row['origin']),row['id']))
            u.prefetch([('mobility_vehicles',row['vehicle_id']) for row in nearby_rows])
            for row in nearby_rows:
                distance=metres(pin,row['origin'])
                if row['state']!='scheduled' or row['starts_at']<=now or distance>RADIUS_METRES:continue
                available=capacity(u,row)
                if available and live_vehicle(u,u.get('mobility_vehicles',row['vehicle_id']),'cab',row['starts_at'],row['ends_at'],row['id']):
                    departures.append(public(row,available)|{'distance_metres':round(distance)})
                    if len(departures)==16:break
            vehicles=[]
            catalogue=sorted(u.find('mobility_vehicles','status','approved'),key=lambda v:(metres(pin,v['location']),v['id']))
            for v in catalogue:
                distance=metres(pin,v['location'])
                # Discovery is a catalogue, not a reservation or a final quote.
                # Cab pickup coverage remains 8 km; shared departures use 20 km.
                if distance>8000:break
                modes=[mode for mode in ('cab','rental') if live_vehicle(u,v,mode,now+300,now+1200)]
                if modes:
                    vehicles.append(vehicle_public(u,v)|{'distance_metres':round(distance),'offered_modes':modes})
                    if len(vehicles)==12:break
            return {'radius_km':20,'vehicle_radius_km':8,'departures':sorted(departures,key=lambda row:(row['starts_at'],row['distance_metres'],row['id']))[:16],
                    'vehicles':sorted(vehicles,key=lambda row:(row['distance_metres'],row['id']))[:12]}
        return store.run(read)
    @r.post('/shared',status_code=201)
    def publish(body:Departure,user=Depends(core.current_user)):
        identifier=digest(user['id']+':departure:'+body.request_id)
        def check(u):
            old=u.get('shared_departures',identifier)
            if old:
                if old['request_hash']!=fingerprint(body):fail('IDEMPOTENCY_CONFLICT','Use a new key for a different journey.',409)
                return old,None
            p=current(u,user['id'],('cab_owner',));v=u.get('mobility_vehicles',body.vehicle_id)
            if not v or v['owner_id']!=user['id'] or not live_vehicle(u,v,'cab',body.starts_at,body.ends_at):fail('UNAVAILABLE','Choose an approved available vehicle.',409)
            if body.seats>v['seats'] or v.get('vehicle_kind')=='bike' and body.seats>1:fail('SEATS','The offered seats exceed this vehicle’s passenger capacity.',422)
            if v.get('driver_id'):current(u,v['driver_id'],('driver',))
            return None,(p,v)
        old,details=store.run(check)
        if old:return public(old,store.run(lambda u:capacity(u,old)))
        schedule(body.starts_at,body.ends_at);route=road_route(body.origin.model_dump(),body.destination.model_dump(),vehicle_kind='bike') if details[1].get('vehicle_kind')=='bike' else road_route(body.origin.model_dump(),body.destination.model_dump())
        def save(u):
            old,details=check(u)
            if old:return public(old,capacity(u,old))
            p,v=details;reservation_guard(u,v);row={**body.model_dump(exclude={'request_id'}),'id':identifier,'owner_id':user['id'],'driver_id':v.get('driver_id'),'owner_name':p['name'],'vehicle_name':v['name'],'vehicle_kind':v.get('vehicle_kind','car'),'state':'scheduled','version':1,'route':route,'request_hash':fingerprint(body),'created_at':time.time(),'events':[]}
            u.put('shared_departures',identifier,row);return public(row,row['seats'])
        return store.run(save)
    @r.post('/shared/search')
    def search(body:Search):
        if not all(math.isfinite(t) for t in (body.starts_at,body.until)) or not time.time()-3600<=body.starts_at<body.until<=time.time()+181*86400 or body.until-body.starts_at>7*86400:fail('DATES','Search a period of up to seven days.',422)
        def read(u):
            out=[]
            for row in u.find('shared_departures','state','scheduled'):
                if not max(time.time(),body.starts_at)<=row['starts_at']<=body.until:continue
                v=u.get('mobility_vehicles',row['vehicle_id'])
                if not live_vehicle(u,v,'cab',row['starts_at'],row['ends_at'],row['id']):continue
                matched=match(row,body.pickup.model_dump(),body.dropoff.model_dump());available=capacity(u,row)
                if matched and available>=body.seats:out.append(public(row,available)|{'match':matched})
            return {'departures':sorted(out,key=lambda x:x['starts_at'])[:40]}
        return store.run(read)
    @r.get('/shared')
    def mine(user=Depends(core.current_user)):
        def read(u):
            uid=user['id'];own=u.find('shared_departures','owner_id',uid);driven=u.find('shared_departures','driver_id',uid);requests=u.find('shared_passengers','customer_id',uid)
            ids={p['departure_id'] for p in requests};rows={x['id']:x for x in own+driven};rows.update({i:u.get('shared_departures',i) for i in ids})
            out=[]
            for row in rows.values():
                if not row:continue
                ps=passenger_rows(u,row['id']) if actor(row,uid) else [p for p in requests if p['departure_id']==row['id']]
                out.append(public(row,capacity(u,row))|{'owner_id':row['owner_id'],'driver_id':row.get('driver_id'),'passengers':ps,'events':row.get('events',[])})
            return {'departures':sorted(out,key=lambda x:x['starts_at'],reverse=True)[:100]}
        return store.run(read)
    @r.post('/shared/{identifier}/join',status_code=201)
    def join(identifier:str,body:Join,user=Depends(core.current_user)):
        def save(u):
            row=get_row(u,'shared',identifier);uid=user['id'];key=digest(uid+':join:'+body.request_id);old=u.get('shared_passengers',key)
            if old:
                if old['request_hash']!=fingerprint(body) or old['departure_id']!=identifier:fail('IDEMPOTENCY_CONFLICT','Request key belongs to different details.',409)
                return old
            if actor(row,uid):fail('SELF_BOOKING','You cannot join your own journey.',422)
            if row['version']!=body.expected_version or row['state']!='scheduled' or row['starts_at']<=time.time():fail('STALE','This departure changed. Search again.',409)
            v=u.get('mobility_vehicles',row['vehicle_id'])
            if not live_vehicle(u,v,'cab',row['starts_at'],row['ends_at'],identifier):fail('UNAVAILABLE','This departure is unavailable.',409)
            if any(p['customer_id']==uid and p['state'] in ('requested',*PASSENGERS) for p in passenger_rows(u,identifier)):fail('ALREADY_REQUESTED','You already have a request for this departure.',409)
            matched=match(row,body.pickup.model_dump(),body.dropoff.model_dump())
            if not matched or capacity(u,row)<body.seats:fail('NO_MATCH','The route direction or available seats no longer match.',409)
            p={'id':key,'departure_id':identifier,'customer_id':uid,'customer_name':user.get('name','Passenger'),'seats':body.seats,'state':'requested','price_paise':row['price_paise']*body.seats,'pickup_mode':row['pickup_mode'],'terms':row['terms'],'match':matched,'requested_pickup':body.pickup.model_dump(),'requested_dropoff':body.dropoff.model_dump(),'request_hash':fingerprint(body),'created_at':time.time()}
            u.put('shared_passengers',key,p)
            for recipient in {row['owner_id'],row.get('driver_id')} - {None}:
                notify(u,row,recipient,'New shared-ride join request',key)
            return p
        return store.run(save)
    @r.post('/shared/{identifier}/commands')
    def command(identifier:str,body:Action,user=Depends(core.current_user)):
        def save(u):
            row=get_row(u,'shared',identifier);uid=user['id'];driver=actor(row,uid);owner=uid==row['owner_id'];p=u.get('shared_passengers',body.passenger_id) if body.passenger_id else None
            if p and p['departure_id']!=identifier:fail('NOT_FOUND','Passenger unavailable.',404)
            customer=p and p['customer_id']==uid
            if not driver and not customer:fail('NOT_FOUND','Journey unavailable.',404)
            key=digest(uid+':shared-command:'+body.command_id);old=u.get('business_commands',key)
            if old:
                if old['fingerprint']!=fingerprint(body) or old['record_id']!=identifier:fail('IDEMPOTENCY_CONFLICT','Use a new action key.',409)
                return public(row,capacity(u,row))
            if row['version']!=body.expected_version:fail('STALE','Refresh this departure.',409)
            a=body.action
            if a in ('accept','decline'):
                if not owner or not p or p['state']!='requested' or row['state']!='scheduled' or time.time()>=row['starts_at']:fail('INVALID_ACTION','Only the owner can decide a pending request before departure.',409)
                current(u,uid,('cab_owner',))
                if a=='accept' and capacity(u,row)<p['seats']:fail('FULL','The remaining seats were just reserved.',409)
                p['state']='accepted' if a=='accept' else 'declined'
            elif a=='cancel':
                if row['state']!='scheduled':fail('STARTED','Contact support to resolve an active journey.',409)
                if customer and p['state'] in ('requested','accepted'):p['state']='cancelled'
                elif owner and not p:
                    row['state']='cancelled'
                    for item in passenger_rows(u,identifier):
                        if item['state'] in ('requested',*PASSENGERS):item['state']='cancelled';u.put('shared_passengers',item['id'],item);notify(u,row,item['customer_id'],'Shared ride cancelled')
                else:fail('INVALID_ACTION','This request cannot be cancelled.',409)
            elif a=='board':
                if not driver or not p or p['state']!='accepted' or row['state'] not in ('scheduled','in_progress'):fail('INVALID_ACTION','Only an accepted passenger can be boarded.',409)
                if not row['starts_at']-3600<=time.time()<=row['ends_at']:fail('PICKUP_WINDOW','Board within the departure window.',409)
                # A scheduled departure becomes on-the-way when the operator enables live location.
                inside(u,'shared',row,p['match']['pickup']);p['state']='boarded';p['boarded_at']=time.time()
            elif a=='start':
                if not row['starts_at']-3600<=time.time()<=row['ends_at']:fail('PICKUP_WINDOW','Start within the scheduled journey window.',409)
                if not driver or row['state']!='scheduled' or not any(x['state']=='boarded' for x in passenger_rows(u,identifier)):fail('BOARDING_REQUIRED','Mark a passenger boarded before starting.',409)
                current(u,uid,('cab_owner','driver'))
                if not live_vehicle(u,u.get('mobility_vehicles',row['vehicle_id']),'cab',row['starts_at'],row['ends_at'],identifier):fail('UNAVAILABLE','Vehicle approval or availability changed.',409)
                loc=location_value(u,'shared',row)
                if not loc or time.time()-loc['received_at']>75:fail('LOCATION_REQUIRED','Enable live location before starting.',409)
                row.update(state='in_progress',started_at=time.time())
            elif a=='dropoff':
                if not driver or not p or p['state']!='boarded' or row['state']!='in_progress':fail('INVALID_ACTION','Only a boarded passenger can be dropped off.',409)
                inside(u,'shared',row,p['match']['dropoff']);p.update(state='completed',completed_at=time.time())
            elif a=='complete':
                if not driver or row['state']!='in_progress':fail('INVALID_ACTION','Only an active journey can finish.',409)
                if any(x['state']=='boarded' for x in passenger_rows(u,identifier)):fail('PASSENGERS_ABOARD','Record every passenger’s drop-off before finishing.',409)
                row.update(state='completed',completed_at=time.time())
                for item in passenger_rows(u,identifier):
                    if item['state'] in ('requested','accepted'):item['state']='expired';u.put('shared_passengers',item['id'],item)
            elif a=='payment_reported':
                if not customer or p['state'] not in (*PASSENGERS,'completed'):fail('INVALID_ACTION','Confirm only your accepted fare payment.',409)
                p['payment_reported_at']=time.time()
            elif a=='payment_received':
                if not owner or not p or not p.get('payment_reported_at'):fail('INVALID_ACTION','Confirm the passenger-reported payment after receiving it.',409)
                p['payment_received_at']=time.time();p['payment_source']='owner_confirmed_receipt'
            if p:u.put('shared_passengers',p['id'],p)
            event(u,row,a,uid);u.put('shared_departures',identifier,row);u.put('business_commands',key,{'record_id':identifier,'fingerprint':fingerprint(body)})
            for target in {row['owner_id'],*([p['customer_id']] if p else [x['customer_id'] for x in passenger_rows(u,identifier) if x['state'] in (*PASSENGERS,'completed')])}:
                if target!=uid:notify(u,row,target,'Shared ride '+a.replace('_',' '))
            return public(row,capacity(u,row))
        return store.run(save)
    @r.post('/journeys/{kind}/{identifier}/consent')
    def consent(kind:Literal['rides','shared'],identifier:str,body:Consent,user=Depends(core.current_user)):
        def save(u):
            row=get_row(u,kind,identifier)
            rental=kind=='rides' and row['mode']=='rental'
            if (rental and user['id']!=row['customer_id']) or (not rental and not actor(row,user['id'])):fail('NOT_FOUND','You cannot change this location consent.',404)
            u.put('journey_consents',kind+':'+identifier+':'+user['id'],{'enabled':body.enabled,'at':time.time()})
            if not body.enabled:
                loc=location_value(u,kind,row)
                if loc:loc['received_at']=0;u.put('journey_locations',kind+':'+identifier,loc)
            return {'enabled':body.enabled}
        return store.run(save)
    @r.post('/journeys/{kind}/{identifier}/tracking-session')
    def session(kind:Literal['rides','shared'],identifier:str,body:Consent,response:Response,user=Depends(core.current_user)):
        response.headers.update(HEADERS);token=secrets.token_urlsafe(32)
        def save(u):
            row=get_row(u,kind,identifier);uid=user['id']
            if not body.enabled or not actor(row,uid) or (kind=='rides' and row['mode']=='rental') or row['state'] not in ('scheduled','reserved',*ACTIVE):fail('NOT_ACTIVE','Only the assigned driver can share this journey location.',403)
            current(u,uid,('cab_owner','driver'));generation=str(uuid.uuid4())
            u.put('journey_consents',kind+':'+identifier+':'+uid,{'enabled':True,'at':time.time(),'generation':generation})
            u.put('journey_tracking',digest(token),{'kind':kind,'record_id':identifier,'user_id':uid,'generation':generation,'expires_at':time.time()+8*3600,'sequence':0})
            return {'token':token,'expires_in':8*3600}
        return store.run(save)
    @r.post('/journeys/{kind}/{identifier}/position')
    def position(kind:Literal['rides','shared'],identifier:str,body:Position,user=Depends(core.current_user)):
        def save(u):
            row=get_row(u,kind,identifier);uid=user['id'];rental=kind=='rides' and row['mode']=='rental'
            if (rental and uid!=row['customer_id']) or (not rental and not actor(row,uid)):fail('NOT_FOUND','You cannot report this vehicle’s position.',404)
            if not (u.get('journey_consents',kind+':'+identifier+':'+uid) or {}).get('enabled'):fail('CONSENT_REQUIRED','Enable journey location sharing first.',409)
            if ((kind=='shared' and row['state']=='scheduled') or (kind=='rides' and row['state']=='reserved')) and row['starts_at']-3600<=time.time()<=row['ends_at']:
                live={**row,'state':'on_the_way'}
            else:live=row
            if not rental:current(u,uid,('cab_owner','driver'))
            return write_position(u,kind,live,body,'renter_phone' if rental else 'driver_phone')
        return store.run(save)
    @r.get('/journeys/{kind}/{identifier}/tracking')
    def tracking(kind:Literal['rides','shared'],identifier:str,response:Response,user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        def read(u):
            row=get_row(u,kind,identifier)
            if not allowed(u,kind,row,user['id']):fail('NOT_FOUND','Journey unavailable.',404)
            data=tracking_value(u,kind,row)
            if kind=='shared' and not actor(row,user['id']) and not any(p['customer_id']==user['id'] and p['state'] in PASSENGERS for p in passenger_rows(u,identifier)):
                return {**data,'position':None,'location_status':'ended','sharing_active':False}
            if kind=='shared' and row['state']=='scheduled':
                loc=location_value(u,kind,row);data['position']=loc if loc and time.time()-loc['received_at']<=75 else None;data['location_status']='live' if data['position'] else 'waiting'
            return data
        return store.run(read)
    @r.post('/journeys/{kind}/{identifier}/share')
    def share(kind:Literal['rides','shared'],identifier:str,body:Share,response:Response,user=Depends(core.current_user)):
        response.headers.update(HEADERS);token=secrets.token_urlsafe(32)
        def save(u):
            row=get_row(u,kind,identifier);p=u.get('shared_passengers',body.passenger_id) if kind=='shared' and body.passenger_id else None
            if row['state']!='in_progress' or (kind=='rides' and user['id']!=row['customer_id']) or (kind=='shared' and (not p or p['departure_id']!=identifier or p['customer_id']!=user['id'] or p['state']!='boarded')):fail('NOT_ACTIVE','Share only your own active boarded journey.',409)
            key=kind+':'+identifier+':'+user['id'];old=u.get('journey_share_owners',key)
            if old:u.put('journey_shares',old['token_hash'],{'expires_at':0})
            hashed=digest(token);u.put('journey_shares',hashed,{'kind':kind,'record_id':identifier,'passenger_id':body.passenger_id,'customer_id':user['id'],'expires_at':time.time()+86400});u.put('journey_share_owners',key,{'token_hash':hashed});return {'token':token,'expires_at':time.time()+86400}
        return store.run(save)
    @r.delete('/journeys/{kind}/{identifier}/share')
    def revoke(kind:Literal['rides','shared'],identifier:str,user=Depends(core.current_user)):
        def save(u):
            key=kind+':'+identifier+':'+user['id'];old=u.get('journey_share_owners',key)
            if old:u.put('journey_shares',old['token_hash'],{'expires_at':0});u.put('journey_share_owners',key,{'token_hash':old['token_hash']})
            return {'revoked':True}
        return store.run(save)
    @r.get('/guest-tracking/{token}')
    def guest(token:str,response:Response):
        response.headers.update(HEADERS)
        def read(u):
            link=u.get('journey_shares',digest(token)) if len(token)<=100 else None
            if not link or link['expires_at']<=time.time():fail('LINK_ENDED','This journey link has ended or was revoked.',404)
            row=get_row(u,link['kind'],link['record_id']);p=u.get('shared_passengers',link['passenger_id']) if link.get('passenger_id') else None
            if row['state']!='in_progress' or link['kind']=='shared' and (not p or p['state']!='boarded'):fail('LINK_ENDED','This journey link has ended.',404)
            data=tracking_value(u,link['kind'],row)
            if data['position']:data['position']={k:v for k,v in data['position'].items() if k not in ('source',)}
            return data
        return store.run(read)
    @r.put('/vehicles/{identifier}/driver')
    def invite_driver(identifier:str,body:Driver,user=Depends(core.current_user)):
        def save(u):
            current(u,user['id'],('cab_owner',));current(u,body.driver_id,('driver',));v=u.get('mobility_vehicles',identifier)
            if not v or v['owner_id']!=user['id']:fail('NOT_FOUND','Vehicle unavailable.',404)
            invitation={'id':identifier,'vehicle_id':identifier,'vehicle_name':v['name'],'owner_id':user['id'],'driver_id':body.driver_id,'state':'pending','created_at':time.time()};u.put('driver_invitations',identifier,invitation);return invitation
        return store.run(save)
    @r.get('/driver-invitations')
    def invitations(user=Depends(core.current_user)):
        return store.run(lambda u:{'invitations':u.find('driver_invitations','driver_id',user['id'])})
    @r.post('/driver-invitations/{identifier}')
    def answer(identifier:str,body:DriverAnswer,user=Depends(core.current_user)):
        def save(u):
            current(u,user['id'],('driver',));i=u.get('driver_invitations',identifier)
            if not i or i['driver_id']!=user['id'] or i['state']!='pending':fail('NOT_FOUND','Invitation unavailable.',404)
            v=u.get('mobility_vehicles',identifier)
            if body.accept:
                for collection in ('mobility_rides','shared_departures'):
                    if any(x.get('vehicle_id')==identifier and x['state'] not in ('completed','cancelled','expired') for x in u.find(collection,'owner_id',v['owner_id'])):fail('BOOKED','Finish this vehicle’s outstanding bookings before changing its driver.',409)
                reservation_guard(u,v);reservation_guard(u,{**v,'driver_id':user['id']});v['driver_id']=user['id'];v['version']+=1;u.put('mobility_vehicles',identifier,v)
            i['state']='accepted' if body.accept else 'declined';u.put('driver_invitations',identifier,i);return i
        return store.run(save)
    @r.post('/vehicles/{identifier}/tracker')
    def pair_tracker(identifier:str,response:Response,user=Depends(core.current_user)):
        response.headers.update(HEADERS);token=secrets.token_urlsafe(32)
        def save(u):
            v=u.get('mobility_vehicles',identifier);current(u,user['id'],('cab_owner',))
            if not v or v['owner_id']!=user['id']:fail('NOT_FOUND','Vehicle unavailable.',404)
            u.put('vehicle_trackers',identifier,{'token_hash':digest(token),'expires_at':time.time()+90*86400});return {'token':token,'vehicle_id':identifier,'expires_at':time.time()+90*86400}
        return store.run(save)
    @r.post('/vehicles/{identifier}/telemetry')
    def telemetry(identifier:str,body:Position,x_vehicle_token:str=Header(default='')):
        def save(u):
            paired=u.get('vehicle_trackers',identifier)
            if not paired or paired['expires_at']<=time.time() or not secrets.compare_digest(paired['token_hash'],digest(x_vehicle_token)):fail('NOT_FOUND','Tracker unavailable.',404)
            v=u.get('mobility_vehicles',identifier)
            for kind,collection in (('rides','mobility_rides'),('shared','shared_departures')):
                for row in u.find(collection,'owner_id',v['owner_id']):
                    if row.get('vehicle_id')==identifier and row['state'] in ACTIVE:
                        if kind=='rides' and row['mode']=='rental' and not (u.get('journey_consents',kind+':'+row['id']+':'+row['customer_id']) or {}).get('enabled'):fail('CONSENT_REQUIRED','The renter must accept vehicle location sharing at handover.',409)
                        return write_position(u,kind,row,body,'vehicle_tracker')
            fail('NOT_ACTIVE','No active journey for this vehicle.',409)
        return store.run(save)
    core.app.include_router(r)
