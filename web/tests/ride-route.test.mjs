import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRideStops,soonestCabWindow,cabWindowValid} from '../src/services/rideRoute.mjs';
import {rideMapView} from '../src/services/rideMapView.mjs';

const pickup={lat:21.4934,lng:86.9135},dropoff={lat:21.5014,lng:86.9135};
test('route readiness rejects missing, malformed, identical and out-of-range stops',()=>{
 assert.equal(validateRideStops(null,dropoff).field,'pickup');
 for(const invalid of [{lat:NaN,lng:86},{lat:91,lng:0},{lat:0,lng:181}])assert.equal(validateRideStops(pickup,invalid).ready,false);
 assert.equal(validateRideStops(pickup,pickup).ready,false);
 assert.equal(validateRideStops(pickup,{lat:22,lng:87},4000).ready,false);
 assert.equal(validateRideStops(pickup,dropoff,4000).ready,true);
 assert.equal(validateRideStops(pickup,dropoff,4000,true).ready,false);
 assert.equal(validateRideStops({...pickup,address:'College pickup entrance'},{...dropoff,address:'Hospital drop-off entrance'},4000,true).ready,true);
 assert.equal(validateRideStops({lat:0,lng:0},{lat:.001,lng:0}).ready,true);
});
test('quick cab uses an explicit valid soonest booking window, which expires before the API cutoff',()=>{
 const now=1792640000000,slot=soonestCabWindow(now);
 assert(slot.starts_at>=now/1000+600&&slot.starts_at<now/1000+660);
 assert.equal(slot.ends_at-slot.starts_at,7200);
 assert.equal(cabWindowValid(slot,now),true);
 assert.equal(cabWindowValid(slot,(slot.starts_at-299)*1000),false);
 assert.equal(cabWindowValid({...slot,ends_at:slot.starts_at+899},now),false);
 assert.equal(cabWindowValid({...slot,ends_at:slot.starts_at+31*86400},now),false);
 assert.equal(cabWindowValid({...slot,starts_at:now/1000+181*86400},now),false);
});
test('camera frames actual route points, with separate search, empty, arrival and assigned views',()=>{
 const base={origin:pickup,destination:dropoff,width:466,height:260};
 const overview=rideMapView(base);
 assert(overview.center.lat>pickup.lat&&overview.center.lat<dropoff.lat);
 assert.equal(rideMapView({...base,phase:'searching'}).zoom,13.5);
 assert.equal(rideMapView({...base,phase:'empty'}).zoom,13);
 assert.equal(rideMapView({...base,phase:'arrived'}).zoom,17);
 assert.deepEqual(rideMapView({...base,phase:'assigned',position:dropoff}).center,dropoff);
 assert(rideMapView({...base,route:[{lat:21.6,lng:87.1}]}).zoom<overview.zoom);
 assert.equal(rideMapView({origin:{lat:NaN,lng:0}}),null);
});
test('route overview handles the antimeridian without spanning the world',()=>{
 const view=rideMapView({origin:{lat:0,lng:179.9},destination:{lat:0,lng:-179.9}});
 assert(Math.abs(view.center.lng)>179);
 assert(view.zoom>8);
});
