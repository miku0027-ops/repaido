import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadServiceSuggestions} from '../src/services/serviceSuggestions.mjs';
const general={cards:[{category:'cleaning'}],personalised:false};
test('guest uses public catalogue, never private profile',async()=>{
 const r=await loadServiceSuggestions(undefined,async()=>general,async()=>{throw Error('Private profile must not be read');});
 assert.deepEqual(r,{feed:general,notice:''});
});
test('verified session uses personal suggestions',async()=>{
 const personal={...general,personalised:true};
 assert.deepEqual(await loadServiceSuggestions('verified-user',async()=>{throw Error('Unexpected general request');},async()=>personal),{feed:personal,notice:''});
});
test('expired or unavailable personal session falls back to general cards with recovery notice',async()=>{
 const result=await loadServiceSuggestions('expired-user',async()=>general,async()=>{throw Error('Sign in');});
 assert.equal(result.feed.personalised,false);assert.match(result.notice,/Showing general ideas/);
});
test('complete outage remains an explicit error rather than invented cards',async()=>{
 await assert.rejects(loadServiceSuggestions('user',async()=>{throw Error('Offline');},async()=>{throw Error('Offline');}),/Offline/);
});
