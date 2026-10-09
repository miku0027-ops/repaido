"""Publication, pickup-area discovery and operator alerts through isolated HTTP."""
import io
import json
import math
import time
import uuid

import pytest
from fastapi import HTTPException
import main
import mobility_journeys as journeys
from operations import metres
from transport_discovery import cell, lane, nearby_lanes
from test_operations import api, auth, PIN
from test_local_business import BASE, vehicle, register
from test_mobility_journeys import make, join, command


def nearby(api, pin=PIN):
    response=api.get(BASE+'/transport/nearby',params=pin)
    assert response.status_code==200,response.text
    return response.json()


def test_twenty_km_discovery_is_live_private_and_read_only(api,monkeypatch):
    row,_=make(api,monkeypatch)
    within={'lat':PIN['lat']+.175,'lng':PIN['lng']}
    outside={'lat':PIN['lat']+.185,'lng':PIN['lng']}
    assert metres(within,PIN)<20000<metres(outside,PIN)
    before=main.operations_store.run(lambda u:len(u.all('notifications')))
    response=nearby(api,within)
    assert [ride['id'] for ride in response['departures']]==[row['id']]
    assert response['radius_km']==20
    assert not {'owner_id','driver_id','passengers','route','request_hash','events'} & response['departures'][0].keys()
    assert nearby(api,outside)['departures']==[]
    assert main.operations_store.run(lambda u:len(u.all('notifications')))==before
    passenger=join(api,row).json()
    # An unaccepted request does not consume capacity. Acceptance does.
    assert nearby(api)['departures'][0]['available_seats']==1
    command(api,row,'accept',passenger)
    assert nearby(api)['departures']==[]
    command(api,row,'cancel')
    assert nearby(api)['departures']==[]


def test_discovery_rechecks_vehicle_and_driver_approval(api,monkeypatch):
    row,_=make(api,monkeypatch)
    assert nearby(api)['departures']
    def revoke(u):
        v=u.get('mobility_vehicles',row['vehicle_id']) if 'vehicle_id' in row else u.get('mobility_vehicles',u.get('shared_departures',row['id'])['vehicle_id'])
        v['active']=False;u.put('mobility_vehicles',v['id'],v)
    main.operations_store.run(revoke)
    assert nearby(api)['departures']==[]
    assert nearby(api)['vehicles']==[]


def test_catalogue_modes_and_prices_come_from_owner(api):
    vid=vehicle(api,mode='both',per_km_paise=2468,daily_paise=234567)
    result=nearby(api)['vehicles'][0]
    assert result['id']==vid and result['offered_modes']==['cab','rental']
    assert result['per_km_paise']==2468 and result['daily_paise']==234567
    assert not {'registration','document_ids','location','origin_address','owner_id','driver_id'} & result.keys()
    assert nearby(api,{'lat':PIN['lat']+.09,'lng':PIN['lng']})['vehicles']==[]
    assert api.get(BASE+'/transport/nearby',params={'lat':91,'lng':0}).status_code==422


def test_assigned_driver_receives_exactly_one_join_notification(api,monkeypatch):
    row,body=make(api,monkeypatch);command(api,row,'cancel')
    register(api,'worker2','driver')
    assert api.put(BASE+'/vehicles/'+body['vehicle_id']+'/driver',headers=auth('worker'),json={'driver_id':'worker2'}).status_code==200
    invitation=api.get(BASE+'/driver-invitations',headers=auth('worker2')).json()['invitations'][0]
    assert api.post(BASE+'/driver-invitations/'+invitation['id'],headers=auth('worker2'),json={'accept':True}).status_code==200
    body['request_id']=str(uuid.uuid4())
    row=api.post(BASE+'/shared',headers=auth('worker'),json=body).json()
    request_id=str(uuid.uuid4())
    first=join(api,row,request_id=request_id);second=join(api,row,request_id=request_id)
    assert first.status_code==second.status_code==201 and first.json()['id']==second.json()['id']
    notices=main.operations_store.run(lambda u:u.all('notifications'))
    new=[n for n in notices if n['title']=='New shared-ride join request']
    assert sorted(n['user_id'] for n in new)==['worker','worker2']
    assert all('Shared rides in your business app' in n['body'] for n in new)
    assigned=api.get(BASE+'/shared',headers=auth('worker2')).json()['departures'][0]
    assert assigned['passengers'][0]['id']==first.json()['id']
    # Being notified does not grant authority to change the owner's seat decisions.
    command(api,row,'accept',first.json(),user='worker2',status=409)


def test_geo_lanes_cover_boundaries_date_line_and_poles():
    for origin in ({'lat':21.5,'lng':86.99},{'lat':0,'lng':179.99},{'lat':89.99,'lng':-179},{'lat':-89.99,'lng':20}):
        lanes=nearby_lanes(origin)
        assert len(lanes)<40
        # Destination points at 19.99 km on a sphere, around each origin.
        for bearing in range(0,360,15):
            phi=math.radians(origin['lat']);lam=math.radians(origin['lng']);theta=math.radians(bearing);d=19990/6371000
            p=math.asin(math.sin(phi)*math.cos(d)+math.cos(phi)*math.sin(d)*math.cos(theta))
            q=lam+math.atan2(math.sin(theta)*math.sin(d)*math.cos(phi),math.cos(d)-math.sin(phi)*math.sin(p))
            target={'lat':math.degrees(p),'lng':(math.degrees(q)+180)%360-180}
            assert lane(*cell(target)) in lanes,(origin,target)


def test_real_route_request_checks_geometry_and_vehicle_profile(monkeypatch):
    monkeypatch.setenv('GOOGLE_ROUTES_API_KEY',' test-only-key ')
    destination={'lat':PIN['lat']+.1,'lng':PIN['lng']}
    payload={'routes':[{'distanceMeters':11132,'polyline':{'geoJsonLinestring':{'coordinates':[[PIN['lng'],PIN['lat']],[destination['lng'],destination['lat']]]}}}]}
    def response(request,timeout):
        assert timeout==12
        assert json.loads(request.data)['travelMode']=='TWO_WHEELER'
        assert request.get_header('X-goog-api-key')=='test-only-key'
        return io.BytesIO(json.dumps(payload).encode())
    monkeypatch.setattr(journeys.urllib.request,'urlopen',response)
    route=journeys.road_route(PIN,destination,'bike')
    assert route['provider']=='google_routes' and len(route['points'])==2
    payload['routes'][0]['polyline']['geoJsonLinestring']['coordinates']=[[0,0],[1,1]]
    with pytest.raises(HTTPException) as error:journeys.road_route(PIN,destination,'bike')
    assert error.value.status_code==503


def test_unconnected_route_does_not_publish_a_fake_departure(api,monkeypatch):
    vid=vehicle(api);monkeypatch.delenv('GOOGLE_ROUTES_API_KEY',raising=False)
    body=dict(request_id=str(uuid.uuid4()),vehicle_id=vid,origin=PIN,destination={'lat':PIN['lat']+.1,'lng':PIN['lng']},origin_address='Public origin place',destination_address='Public destination place',starts_at=time.time()+7200,ends_at=time.time()+18000,seats=1,price_paise=10000,terms='The published terms must be reviewed before joining.')
    response=api.post(BASE+'/shared',headers=auth('worker'),json=body)
    assert response.status_code==503
    assert main.operations_store.run(lambda u:u.all('shared_departures'))==[]


def test_transport_suggestions_respect_consent_and_reset(api):
    path='/operations/discovery'
    event={'event_id':str(uuid.uuid4()),'kind':'search','category':'transport'}
    assert api.post(path+'/events',headers=auth('customer'),json=event).status_code==403
    assert api.put(path+'/preferences',headers=auth('customer'),json={'enabled':True,'consent_version':2}).status_code==200
    assert api.post(path+'/events',headers=auth('customer'),json=event).json()['recorded']
    assert api.get(path+'/feed/personal',headers=auth('customer')).json()['transport_interest']
    assert not api.get(path+'/feed').json()['transport_interest']
    api.post(path+'/preferences/reset',headers=auth('customer'))
    assert not api.get(path+'/feed/personal',headers=auth('customer')).json()['transport_interest']
