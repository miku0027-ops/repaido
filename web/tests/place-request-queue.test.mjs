import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaceRequestQueue} from '../src/services/placeRequestQueue.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('search bursts are bounded and selected-place work has reserved capacity',async()=>{
 const pool=createPlaceRequestQueue(),work=Array.from({length:8},deferred),started=[];
 const promises=work.map((job,i)=>pool.run(()=>{started.push(i);return job.promise;}));
 await tick();assert.deepEqual(started,[0,1]);
 assert.equal(await pool.run(async()=>42,{kind:'selection'}),42);await tick();
 assert.deepEqual(pool.stats(),{active:2,searches:2,queued:6});
 work.forEach(job=>job.resolve());await Promise.all(promises);await tick();assert.deepEqual(pool.stats(),{active:0,searches:0,queued:0});
});
test('replaced queued searches never execute and active cancellation does not free real capacity',async()=>{
 const pool=createPlaceRequestQueue({concurrency:1,searchConcurrency:1}),running=deferred(),first=new AbortController(),second=new AbortController();
 const a=pool.run(()=>running.promise,{signal:first.signal});await tick();
 let called=false;const b=pool.run(async()=>{called=true;},{signal:second.signal});
 second.abort();await assert.rejects(b,{name:'AbortError'});
 first.abort();await assert.rejects(a,{name:'AbortError'});
 assert.equal(pool.stats().active,1);assert.equal(called,false);
 running.resolve();await tick();assert.equal(pool.stats().active,0);
});
test('full queues reject excess work and expired work is not replayed',async()=>{
 const pool=createPlaceRequestQueue({concurrency:1,searchConcurrency:1,maxQueued:1,queueTtl:15}),running=deferred();
 const a=pool.run(()=>running.promise);let called=false;
 const b=pool.run(async()=>{called=true;});
 await assert.rejects(pool.run(async()=>0),/busy/);await assert.rejects(b,/expired/);
 running.resolve();await a;await tick();assert.equal(called,false);assert.equal(pool.stats().queued,0);
});
test('timeouts release the caller but do not start more SDK work than the cap',async()=>{
 const pool=createPlaceRequestQueue({concurrency:1,searchConcurrency:1,responseTimeout:15}),running=deferred();
 const a=pool.run(()=>running.promise);await assert.rejects(a,/timed out/);assert.equal(pool.stats().active,1);
 let called=false;const b=pool.run(async()=>{called=true;return 7;});await tick();assert.equal(called,false);
 running.resolve();assert.equal(await b,7);await tick();assert.equal(pool.stats().active,0);
});
test('provider failures do not poison subsequent requests or cache bad results',async()=>{
 const pool=createPlaceRequestQueue();await assert.rejects(pool.run(async()=>{throw Error('quota');}),/quota/);
 assert.equal(await pool.run(async()=>99),99);await tick();assert.equal(pool.stats().active,0);
});
test('multiple search sessions remain independent',async()=>{
 const pool=createPlaceRequestQueue(),old=deferred(),cancel=new AbortController();
 const a=pool.run(()=>old.promise,{signal:cancel.signal});const b=pool.run(async()=>['other session']);
 cancel.abort();await assert.rejects(a,{name:'AbortError'});assert.deepEqual(await b,['other session']);old.resolve();await tick();
});
