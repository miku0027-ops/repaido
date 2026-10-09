import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadCache} from '../src/services/readCache.mjs';

test('concurrent reads share work, fresh hits avoid network and failures retry',async()=>{
  let now=0,calls=0;const cache=createReadCache({now:()=>now});
  const load=async()=>++calls;
  assert.deepEqual(await Promise.all([cache.read('account:a',load),cache.read('account:a',load)]),[1,1]);
  assert.equal(await cache.read('account:a',load),1);assert.equal(calls,1);
  now=11000;assert.equal(cache.peek('account:a'),1);assert.equal(await cache.read('account:a',load),2);
  await assert.rejects(cache.read('account:b',()=>Promise.reject(Error('offline'))));
  assert.equal(await cache.read('account:b',load),3);
});

test('invalidated in-flight reads cannot restore removed private data',async()=>{
  const cache=createReadCache();let release;
  const running=cache.read('account:a',()=>new Promise(resolve=>{release=resolve;}));
  await Promise.resolve();cache.invalidate();release('old private response');await running;
  assert.equal(cache.peek('account:a'),null);
  await cache.read('account:b',async()=> 'b');assert.equal(cache.peek('account:b'),'b');
});
test('a receipt can retire its own snapshot and pending read without clearing unrelated bookings',async()=>{
 const cache=createReadCache();await cache.read('jobs',async()=> 'saved jobs');let release;
 const old=cache.read('notifications',()=>new Promise(resolve=>release=resolve));await Promise.resolve();
 cache.invalidate('notifications');assert.equal(cache.peek('jobs'),'saved jobs');
 await cache.read('notifications',async()=> 'read receipts');release('unread snapshot');await old;
 assert.equal(cache.peek('notifications'),'read receipts');assert.equal(cache.peek('jobs'),'saved jobs');
});

test('memory is bounded and stale data has a fixed expiry',async()=>{
  let now=0;const cache=createReadCache({maxEntries:2,now:()=>now});
  for(const key of ['a','b','c'])await cache.read(key,async()=>key);
  assert.equal(cache.peek('a'),null);assert.equal(cache.peek('c'),'c');
  now=60000;assert.equal(cache.peek('c'),null);
});

test('freshness deadlines stay fixed across cache hits and expire at the exact boundary',async()=>{
  let now=1000,calls=0;const cache=createReadCache({now:()=>now});
  const load=async()=>({revision:++calls});
  assert.equal(cache.freshUntil('missing'),0);
  const saved=await cache.read('account:a',load,{freshMs:5000});
  assert.equal(cache.freshUntil('account:a',5000),6000);
  assert.equal(cache.freshUntil('account:a'),61000);

  now=5500;
  assert.equal(await cache.read('account:a',load,{freshMs:5000}),saved);
  assert.equal(calls,1);
  assert.equal(cache.freshUntil('account:a',5000),6000);
  now=5999;
  assert.equal(cache.peek('account:a',5000),saved);
  assert.equal(cache.freshUntil('account:a',5000),6000);
  now=6000;
  assert.equal(cache.freshUntil('account:a',5000),0);
  assert.equal(cache.peek('account:a',5000),null);
  assert.equal(cache.freshUntil('account:a'),61000);
  now=61000;
  assert.equal(cache.freshUntil('account:a'),0);
  assert.equal(cache.peek('account:a'),null);
});

test('both fresh reads and snapshot peeks protect recently used entries from eviction',async t=>{
  for(const access of ['read','peek'])await t.test(access,async()=>{
    const cache=createReadCache({maxEntries:2});
    let calls=0;const load=async()=>++calls;
    const a=await cache.read('a',load);
    await cache.read('b',load);
    assert.equal(access==='read'?await cache.read('a',load):cache.peek('a'),a);
    assert.equal(calls,2);
    await cache.read('c',load);
    assert.equal(cache.peek('b'),null);
    assert.equal(cache.peek('a'),a);
    assert.equal(cache.peek('c'),3);
  });
});

test('a forced refresh replaces a fresh snapshot with the confirmed response and a new deadline',async()=>{
  let now=1000,calls=0,release;const cache=createReadCache({now:()=>now});
  const original=await cache.read('account:a',async()=>({revision:++calls}));
  now=2000;
  const refresh=cache.read('account:a',()=>{calls++;return new Promise(resolve=>{release=resolve;});},{force:true});
  await Promise.resolve();
  assert.equal(calls,2);
  assert.equal(cache.peek('account:a'),original);
  assert.equal(cache.freshUntil('account:a'),61000);
  now=3000;
  const confirmed={revision:2};release(confirmed);
  assert.equal(await refresh,confirmed);
  assert.equal(cache.peek('account:a'),confirmed);
  assert.equal(cache.freshUntil('account:a'),63000);
  assert.equal(await cache.read('account:a',async()=>{throw Error('fresh response should be reused');}),confirmed);
});

test('concurrent forced refreshes share one request even when a fresh snapshot exists',async()=>{
  const cache=createReadCache();let calls=0,release;
  await cache.read('account:a',async()=> 'previous');
  const load=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const first=cache.read('account:a',load,{force:true});
  const second=cache.read('account:a',load,{force:true});
  await Promise.resolve();assert.equal(calls,1);
  release('confirmed');
  assert.deepEqual(await Promise.all([first,second]),['confirmed','confirmed']);
  assert.equal(cache.peek('account:a'),'confirmed');
});

test('an invalidated completion cannot remove a newer pending request or replace its response',async t=>{
  for(const firstToFinish of ['invalidated','current'])await t.test(firstToFinish,async()=>{
    const cache=createReadCache();let releaseOld,releaseNew,newCalls=0;
    const old=cache.read('account:a',()=>new Promise(resolve=>{releaseOld=resolve;}));
    await Promise.resolve();cache.invalidate();
    const current=cache.read('account:a',()=>{newCalls++;return new Promise(resolve=>{releaseNew=resolve;});});
    await Promise.resolve();
    if(firstToFinish==='invalidated'){
      releaseOld('old private response');assert.equal(await old,'old private response');
      assert.equal(cache.peek('account:a'),null);
      const observer=cache.read('account:a',()=>{newCalls++;throw Error('new request must remain shared');});
      await Promise.resolve();assert.equal(newCalls,1);
      releaseNew('current private response');
      assert.deepEqual(await Promise.all([current,observer]),['current private response','current private response']);
    }else{
      releaseNew('current private response');assert.equal(await current,'current private response');
      releaseOld('old private response');assert.equal(await old,'old private response');
    }
    assert.equal(newCalls,1);
    assert.equal(cache.peek('account:a'),'current private response');
  });
});
