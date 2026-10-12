import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryFocus,typeDiscoveryIntent} from '../src/services/discoveryFocus.mjs';
test('India peak windows choose transport for four hours and repairs for two hours',()=>{
 for(const [stamp,expected] of [['2026-10-12T01:30:00Z','transport'],['2026-10-12T03:29:59Z','transport'],['2026-10-12T04:30:00Z','repair'],['2026-10-12T06:29:59Z','repair'],['2026-10-12T11:30:00Z','transport'],['2026-10-12T13:29:59Z','transport']])assert.equal(discoveryFocus({now:new Date(stamp)}),expected);
});
test('confirmed recent intent chooses the next view with consent; peaks retain their agreed priority',()=>{
 const now=new Date('2026-10-12T08:00:00Z');
 assert.equal(discoveryFocus({now,preferredFocus:'repair',transportInterest:true,personalised:true}),'repair');
 assert.equal(discoveryFocus({now,preferredFocus:'repair',personalised:false}),'transport');
 assert.equal(discoveryFocus({now:new Date('2026-10-12T02:00:00Z'),preferredFocus:'repair',personalised:true}),'transport');
 assert.equal(discoveryFocus({now:new Date('2026-10-12T05:00:00Z'),preferredFocus:'transport',personalised:true}),'repair');
});
test('the intent bridge carries known modes or catalogue categories rather than form contents',()=>{
 assert.deepEqual(typeDiscoveryIntent(['transport','transport_shared']),{focus:'transport',mode:'shared'});
 assert.deepEqual(typeDiscoveryIntent(['ac','electrical']),{focus:'repair',category:'ac'});
 assert.deepEqual(typeDiscoveryIntent(['home:plumber']),{focus:'repair',category:'home:plumber'});
 for(const input of [null,{},[],['repair my private address'],['transport_unknown'],[null]])assert.equal(typeDiscoveryIntent(input),null);
});
test('outside peak windows interests apply only with existing personalisation consent',()=>{
 const now=new Date('2026-10-12T08:00:00Z');assert.equal(discoveryFocus({now,repairInterest:true,personalised:false}),'transport');assert.equal(discoveryFocus({now,repairInterest:true,personalised:true}),'repair');assert.equal(discoveryFocus({now,transportInterest:true,repairInterest:true,personalised:true}),'transport');
});
