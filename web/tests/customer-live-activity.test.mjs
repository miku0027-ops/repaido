import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../src/services/customerLiveActivity.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {selectCustomerLiveActivity:select}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const now=10000,source=rows=>({rows,receivedAt:now,serverTime:now}),bike=(state='accepted',extra={})=>({id:'bike-one',customer_id:'customer',state,created_at:now,dropoff_address:'Confirmed destination',...extra});
test('Home projects only the actual booked customer and never phone or coordinate data',()=>{
 const rows=[bike('in_progress',{rider_phone:'+919111111111',position:{lat:21,lng:86,received_at:now}}),bike('in_progress',{id:'foreign',customer_id:'someone-else'})];
 const result=select({bike:source(rows)},'customer',now);assert.equal(result.length,1);assert.equal(result[0].target.id,'bike-one');assert.equal(JSON.stringify(result).includes('919111111111'),false);assert.equal(JSON.stringify(result).includes('received_at'),false);assert.deepEqual(select({bike:source(rows)},'',now),[]);
});
test('physical completion and outstanding payment records disappear from Home',()=>{
 for(const state of ['completion_pending','payment_due','payment_reported','completed','cancelled','declined','expired','unavailable','disputed'])assert.deepEqual(select({bike:source([bike(state)])},'customer',now),[],state);
 assert.equal(select({ride:source([{...bike('balance_due'),mode:'cab'}]),job:source([bike('completed')])},'customer',now).length,0);
});
test('scheduled pickups use a one-hour window instead of surfacing distant bookings',()=>{
 const ride=starts_at=>({...bike('reserved'),starts_at,ends_at:starts_at+3600,mode:'cab'});
 assert.equal(select({ride:source([ride(now+3601)])},'customer',now).length,0);
 assert.equal(select({ride:source([ride(now+3600)])},'customer',now).length,1);
 assert.equal(select({ride:source([ride(now-10000)])},'customer',now).length,0);
 assert.equal(select({ride:source([{...ride(now+99999),state:'in_progress'}])},'customer',now).length,1,'an actual in-progress state wins over a stale planned date');
});
test('arrival requires valid fresh server proximity and loses its live styling after data gets old',()=>{
 const row=bike('on_the_way',{position:{lat:21,lng:86,received_at:now},stop_status:{pickup:{status:'inside',valid_until:now+75}}});
 assert.equal(select({bike:source([row])},'customer',now)[0].mode,'arrival');
 const expired=select({bike:source([row])},'customer',now+76)[0];assert.equal(expired.mode,'moving');assert.equal(expired.stale,true);
 assert.equal(select({bike:source([{...row,position:null}])},'customer',now)[0].mode,'moving');
 assert.equal(select({bike:{...source([row]),error:'Delayed'}},'customer',now)[0].mode,'moving');
 const agedArrival=select({bike:source([{...row,state:'arrived',position:{lat:21,lng:86,received_at:now-90}}])},'customer',now)[0];assert.equal(agedArrival.mode,'waiting');assert.equal(agedArrival.status,'Pickup reached · check your ride');
});
test('server time governs schedule and expiry even when the device clock differs',()=>{
 const value={rows:[bike('accepted',{expires_at:now+10})],receivedAt:300,serverTime:now};
 assert.equal(select({bike:value},'customer',305).length,1);assert.equal(select({bike:value},'customer',310).length,0);
});
test('shared summaries require the exact active passenger and exclude operator/other passenger data',()=>{
 const departure={id:'shared-one',owner_id:'owner',driver_id:'driver',state:'scheduled',starts_at:now+1800,ends_at:now+3000,destination_address:'Shared destination',passengers:[{id:'mine',customer_id:'customer',state:'accepted'},{id:'other',customer_id:'other',state:'boarded'}]};
 assert.equal(select({shared:source([departure])},'customer',now)[0].status,'Waiting for your shared pickup');
 assert.equal(select({shared:source([{...departure,state:'in_progress'}])},'customer',now)[0].mode,'waiting','another passenger being on board does not mean this customer is travelling');
 for(const state of ['completed','cancelled','declined','expired'])assert.equal(select({shared:source([{...departure,passengers:[{...departure.passengers[0],state}]}])},'customer',now).length,0);
 assert.deepEqual(select({shared:source([{...departure,owner_id:'customer'}])},'customer',now),[]);
 assert.deepEqual(select({shared:source([{...departure,passengers:[departure.passengers[1]]}])},'customer',now),[]);
});
test('shared pickup and drop-off cues refer to the booked passenger only',()=>{
 const departure={id:'shared-one',state:'in_progress',starts_at:now-100,ends_at:now+900,passengers:[{id:'mine',customer_id:'customer',state:'boarded'}],stop_status:{passengers:{other:{status:'inside',valid_until:now+75}}}};
 assert.equal(select({shared:source([departure])},'customer',now)[0].mode,'moving');
 departure.stop_status.passengers.mine={status:'inside',valid_until:now+75};assert.equal(select({shared:source([departure])},'customer',now)[0].status,'Your shared drop-off is close');
});
test('searching and next-slot statuses never promise a confirmed reservation',()=>{
 assert.match(select({bike:source([bike('dispatch_pending')])},'customer',now)[0].detail,/No rider is reserved/);
 assert.equal(select({bike:source([bike('queued',{accepted_by_driver:false})])},'customer',now)[0].status,'Next slot requested');
 assert.equal(select({bike:source([bike('queued',{accepted_by_driver:true})])},'customer',now)[0].status,'Your next slot is accepted');
});
test('service and hourly-hire activities link to their native booking lifecycle',()=>{
 const result=select({job:source([bike('in_progress',{id:'hire',service_id:'day-hire-general',service_name:'Personal help'}),bike('arrived',{id:'visit',service_id:'ac-service',service_name:'AC service'})])},'customer',now);
 assert.deepEqual(result.map(row=>row.target),[{kind:'job',id:'visit',bookingKind:'visits'},{kind:'job',id:'hire',bookingKind:'hiring'}]);assert.equal(result[0].status,'Your professional has arrived');
});
test('ongoing parts collection and requested work stops stay connected beyond their original visit time',()=>{
 for(const [state,status] of [['collecting_parts','Your professional is collecting parts'],['stop_requested','Work stop requested']]){
  const row=bike(state,{id:state,starts_epoch:now-86400,service_id:'ac-service',service_name:'AC repair'});
  const result=select({job:source([row,{...row,id:'foreign-'+state,customer_id:'other'}])},'customer',now);
  assert.equal(result.length,1);assert.equal(result[0].status,status);assert.equal(result[0].mode,'waiting');assert.equal(result[0].target.id,state);
  assert.deepEqual(select({job:source([{...row,state:'completion_pending'}])},'customer',now),[],'completion review stays in Bookings rather than an ongoing Home card');
 }
});
test('follow-up Home reminders require a real scheduled epoch inside the next-visit window',()=>{
 const row=bike('follow_up_scheduled',{id:'follow-up',service_id:'ac-service',service_name:'AC return visit'});
 assert.deepEqual(select({job:source([row])},'customer',now),[],'missing date cannot invent a follow-up visit');
 assert.deepEqual(select({job:source([{...row,starts_epoch:now+86400}])},'customer',now),[],'tomorrow stays in Bookings');
 const result=select({job:source([{...row,starts_epoch:now+1800}])},'customer',now);
 assert.equal(result.length,1);assert.equal(result[0].status,'Your follow-up visit is scheduled');assert.equal(result[0].mode,'waiting');assert.equal(result[0].target.bookingKind,'visits');
 assert.deepEqual(select({job:source([{...row,starts_epoch:now-86400}])},'customer',now),[],'an old unstarted follow-up cannot remain on Home indefinitely');
});
