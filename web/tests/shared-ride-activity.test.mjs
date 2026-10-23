import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedRideActivity} from '../src/services/sharedRideActivity.mjs';
test('shared activity never attributes another passenger’s departure event to this seat',()=>{
 const result=sharedRideActivity({state:'scheduled',events:[{action:'accept',at:50},{action:'board',at:60},{action:'payment_received',at:70}]},{state:'requested',created_at:10});
 assert.equal(result.current,0);assert.deepEqual(result.activity,[{label:'Seat requested',at:10}]);
});
test('completed departure does not imply an expired passenger arrived',()=>{
 const result=sharedRideActivity({state:'completed',events:[{action:'start',at:50}]},{state:'expired',created_at:10});
 assert.equal(result.terminal,true);assert.equal(result.steps[3].done,false);assert.equal(result.activity.length,1);
});
test('own boarding, drop-off and receipt form a chronological activity history',()=>{
 const result=sharedRideActivity({state:'in_progress',events:[{action:'start',at:40}]},{state:'completed',created_at:10,boarded_at:30,completed_at:50,payment_reported_at:60,payment_received_at:70});
 assert.equal(result.current,3);assert(result.steps.every(s=>s.done));assert.deepEqual(result.activity.map(a=>a.at),[70,60,50,40,30,10]);assert.equal(result.activity[0].label,'Receipt confirmed by owner');
});
