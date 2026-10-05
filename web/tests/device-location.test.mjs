import test from 'node:test';
import assert from 'node:assert/strict';
import {readDeviceLocation} from '../src/services/deviceLocation.mjs';
const reading={coords:{latitude:21.49,longitude:86.91,accuracy:15},timestamp:100000};
test('registration retries unavailable precise GPS with fresh approximate reading',async()=>{const options=[];const gps={getCurrentPosition(ok,bad,opts){options.push(opts); options.length===1?bad({code:2}):ok(reading);}};assert.equal((await readDeviceLocation(gps,{registration:true})).lat,21.49);assert.deepEqual(options.map(o=>o.enableHighAccuracy),[true,false]);assert.ok(options.every(o=>o.maximumAge===0));});
test('permission denial gives settings recovery without repeated prompt',async()=>{let calls=0;await assert.rejects(readDeviceLocation({getCurrentPosition(ok,bad){calls++;bad({code:1});}},{registration:true}),/permission is off/);assert.equal(calls,1);});
test('job GPS never silently relaxes precision',async()=>{let calls=0;await assert.rejects(readDeviceLocation({getCurrentPosition(ok,bad){calls++;bad({code:3});}}),/too long/);assert.equal(calls,1);});
test('insecure context and missing API have recoverable errors',async()=>{await assert.rejects(readDeviceLocation(null,{secure:false}),/secure connection/);await assert.rejects(readDeviceLocation(null),/map or enter coordinates/);});
