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

test('memory is bounded and stale data has a fixed expiry',async()=>{
  let now=0;const cache=createReadCache({maxEntries:2,now:()=>now});
  for(const key of ['a','b','c'])await cache.read(key,async()=>key);
  assert.equal(cache.peek('a'),null);assert.equal(cache.peek('c'),'c');
  now=60000;assert.equal(cache.peek('c'),null);
});
