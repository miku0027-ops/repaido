import test from 'node:test';
import assert from 'node:assert/strict';
import {createBikeLocationSession} from '../src/services/bikeLocationSession.mjs';
const point=(t=100,accuracy=5)=>({coords:{latitude:21,longitude:86,accuracy},timestamp:t*1000});
test('one watch supplies fresh fixes without repeated device lookups and clears on stop',async()=>{
 let cb,starts=0,reads=0,cleared=0;
 const session=createBikeLocationSession({watchPosition(fn){cb=fn;starts++;return 7;},clearWatch(id){assert.equal(id,7);cleared++;},getCurrentPosition(){reads++;}},()=>105);
 session.start();session.start();cb(point());
 assert.equal((await session.read()).captured_at,100);await session.read();assert.equal(starts,1);assert.equal(reads,0);
 session.stop();assert.equal(cleared,1);
});
test('concurrent recovery shares a lookup and never fabricates a fresh timestamp',async()=>{
 let resolve,reads=0;
 const session=createBikeLocationSession({getCurrentPosition(fn){resolve=fn;reads++;}},()=>130);
 const a=session.read(),b=session.read();assert.equal(reads,1);resolve(point(125));
 assert.deepEqual(await a,await b);assert.equal((await session.read()).captured_at,125);
});
test('permission denial prevents automatic repeated permission requests',async()=>{
 let error,reads=0;
 const session=createBikeLocationSession({watchPosition(_,fn){error=fn;return 1;},clearWatch(){},getCurrentPosition(){reads++;}},()=>100);
 session.start();error({code:1});await assert.rejects(session.read(),/permission is off/);assert.equal(reads,0);session.stop();
});
