import {test} from 'node:test';
import assert from 'node:assert/strict';
import {abortablePause,pollDelay,resilientRead} from '../src/services/resilientReads.mjs';

test('GET honors bounded retry hints and jitter, then returns the actual response',async()=>{
 const waits=[],statuses=[503,429,200];let calls=0;
 const result=await resilientRead('/api/test',{},{fetcher:async()=>{calls++;return new Response('{}',{status:statuses.shift(),headers:{'Retry-After':'99'}});},random:()=>.5,pause:async ms=>waits.push(ms)});
 assert.equal(result.status,200);assert.equal(calls,3);assert.deepEqual(waits,[2125,2125]);
});
test('cash/booking writes, denied reads and sustained overload are never retried indefinitely',async()=>{
 for(const method of ['POST','PUT','DELETE']){let n=0;await resilientRead('/api/test',{method},{fetcher:async()=>{n++;return new Response('{}',{status:503});}});assert.equal(n,1);}
 let n=0;await resilientRead('/api/test',{},{fetcher:async()=>{n++;return new Response('{}',{status:403});}});assert.equal(n,1);
 n=0;const response=await resilientRead('/api/test',{},{fetcher:async()=>{n++;return new Response('{}',{status:503});},pause:async()=>{}});assert.equal(n,3);assert.equal(response.status,503);
});
test('cancelled callers stop during backoff and read polling stays bounded with jitter',async()=>{
 const abort=new AbortController();const waiting=abortablePause(10000,abort.signal);abort.abort();await assert.rejects(waiting);
 assert.equal(pollDelay(10000,0,()=>.5),10000);assert.equal(pollDelay(10000,8,()=>.5),60000);assert.notEqual(pollDelay(10000,0,()=>0),pollDelay(10000,0,()=>1));
});
