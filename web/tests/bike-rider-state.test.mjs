import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBikePosition,bikeAllowedActions,bikeArrivalCueKeys,bikeCollectionSummary,bikeRiderSections,riderIsOnline} from '../src/services/bikeRiderState.mjs';

test('rider presence requires current precise GPS rather than an online flag',()=>{
 const availability={online:true,updated_at:1000,position:{captured_at:1000,received_at:1000,accuracy:12}};
 assert.equal(riderIsOnline(availability,1020),true);
 assert.equal(riderIsOnline(availability,1121),false);
 assert.equal(riderIsOnline(availability,1076),false);
 assert.equal(riderIsOnline({...availability,position:{captured_at:1000,received_at:1000,accuracy:101}},1020),false);
 assert.equal(riderIsOnline({...availability,position:undefined},1020),false);
 assert.equal(riderIsOnline({...availability,position:{captured_at:2000,accuracy:10}},1020),false);
 assert.equal(riderIsOnline({...availability,online:false},1020),false);
});

test('only server-supplied supported lifecycle actions become buttons',()=>{
 assert.deepEqual(bikeAllowedActions({state:'in_progress'}),[]);
 assert.deepEqual(bikeAllowedActions({allowed_actions:['complete','cancel','complete','autostart','toString']}),['complete','cancel']);
 assert.deepEqual(bikeAllowedActions({allowed_actions:'accept'}),[]);
});

test('a reserved next trip is separate from offers and the current trip',()=>{
 const sections=bikeRiderSections([
  {id:'offer',state:'queued',queued:true,accepted_by_driver:false,created_at:3},
  {id:'current',state:'in_progress',created_at:1},
  {id:'next',state:'queued',queued:true,accepted_by_driver:true,created_at:2},
  {id:'completed',state:'completed',created_at:0},
  {id:'expired',state:'expired',created_at:4},
 ]);
 assert.deepEqual(sections.current.map(ride=>ride.id),['current']);
 assert.deepEqual(sections.next.map(ride=>ride.id),['next']);
 assert.deepEqual(sections.offers.map(ride=>ride.id),['offer']);
 assert.deepEqual(sections.history.map(ride=>ride.id),['expired','completed']);
});

test('only the approved collection total is shown, without deriving internal rates or trip earnings',()=>{
 const free=bikeCollectionSummary({pricing:{free:true,customer_total_paise:0,total_paise:4200,promo_compensation_paise:4200}});
 assert.deepEqual(free,{free:true,customerPaise:0});
 assert.equal(bikeCollectionSummary({pricing:{total_paise:4200}}).customerPaise,null);
 assert.equal(bikeCollectionSummary({pricing:{customer_total_paise:-1}}).customerPaise,null);
});

test('GPS sent for ride actions rejects stale, inaccurate or impossible readings',()=>{
 const fresh={lat:21.49,lng:86.91,accuracy:8,captured_at:1000};
 assert.deepEqual(assertBikePosition(fresh,1020),fresh);
 assert.throws(()=>assertBikePosition({...fresh,accuracy:101},1020),/Precise GPS/);
 assert.throws(()=>assertBikePosition({...fresh,captured_at:1},1020),/too old/);
 assert.throws(()=>assertBikePosition({...fresh,captured_at:2000},1020),/too old/);
 assert.throws(()=>assertBikePosition({...fresh,lat:91},1020),/valid GPS/);
 assert.throws(()=>assertBikePosition({...fresh,lng:NaN},1020),/valid GPS/);
});

test('arrival audio cues require opted-in, visible, connected live GPS with a fresh server stop',()=>{
 const ride={id:'ride',state:'in_progress',stop_status:{destination:{status:'inside',valid_until:1075}}};
 const session={now:1000,enabled:true,visible:true,connected:true,sharing:true};
 assert.deepEqual(bikeArrivalCueKeys([ride],session),['ride:destination']);
 for(const field of ['enabled','visible','connected','sharing'])assert.deepEqual(bikeArrivalCueKeys([ride],{...session,[field]:false}),[]);
 assert.deepEqual(bikeArrivalCueKeys([ride],{...session,now:1076}),[]);
 assert.deepEqual(bikeArrivalCueKeys([{...ride,queued:true}],session),[]);
 assert.deepEqual(bikeArrivalCueKeys([{...ride,state:'completed'}],session),[]);
 assert.deepEqual(bikeArrivalCueKeys([{...ride,stop_status:{destination:{status:'outside',valid_until:1075}}}],session),[]);
});
