import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryFocus} from '../src/services/discoveryFocus.mjs';
test('India peak windows choose transport for four hours and repairs for two hours',()=>{
 for(const [stamp,expected] of [['2026-10-12T01:30:00Z','transport'],['2026-10-12T03:29:59Z','transport'],['2026-10-12T04:30:00Z','repair'],['2026-10-12T06:29:59Z','repair'],['2026-10-12T11:30:00Z','transport'],['2026-10-12T13:29:59Z','transport']])assert.equal(discoveryFocus({now:new Date(stamp)}),expected);
});
test('outside peak windows interests apply only with existing personalisation consent',()=>{
 const now=new Date('2026-10-12T08:00:00Z');assert.equal(discoveryFocus({now,repairInterest:true,personalised:false}),'transport');assert.equal(discoveryFocus({now,repairInterest:true,personalised:true}),'repair');assert.equal(discoveryFocus({now,transportInterest:true,repairInterest:true,personalised:true}),'transport');
});
