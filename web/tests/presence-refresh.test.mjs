import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldRefreshPresence as check} from '../src/services/presenceRefresh.mjs';
const state={hidden:false,running:false,denied:false,lastAttempt:1000,now:2000};
test('focus and visibility bursts do not re-request GPS',()=>{for(let n=0;n<20;n++)assert.equal(check({...state,now:2000+n*100}),false);assert.equal(check({...state,now:181000}),true);});
test('permission denial pauses every automatic retry',()=>{assert.equal(check({...state,denied:true,now:9999999}),false);assert.equal(check({...state,denied:false,manual:true}),true);});
test('hidden and overlapping requests never refresh',()=>{assert.equal(check({...state,hidden:true,manual:true}),false);assert.equal(check({...state,running:true,manual:true}),false);});
