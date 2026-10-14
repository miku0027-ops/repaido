import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryFocus,typeDiscoveryIntent} from '../src/services/discoveryFocus.mjs';
import {homeDiscoveryPlan,marketplaceCategory,marketplaceIntent} from '../src/services/homeDiscoveryPlan.mjs';
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
test('public home rotation is stable within a slot and reaches every marketplace journey without behaviour',()=>{
 const slots=Array.from({length:24},(_,hour)=>homeDiscoveryPlan({now:new Date(Date.UTC(2026,9,14,hour)),city:'Balasore'}));
 assert(slots.some(p=>p.focus==='marketplace'));assert(slots.some(p=>p.focus==='repair'));assert(slots.some(p=>p.focus==='transport'));
 assert.deepEqual(new Set(slots.map(p=>p.marketMode)),new Set(['refurbished','preowned','rentals','sell']));
 assert.deepEqual(new Set(slots.filter(p=>p.focus==='marketplace').map(p=>p.marketMode)),new Set(['refurbished','preowned','rentals','sell']));
 assert(slots.some(p=>p.servicesFirst));assert(slots.some(p=>!p.servicesFirst));
 const now=new Date('2026-10-14T08:00:00Z');
 assert.deepEqual(homeDiscoveryPlan({now,city:'Balasore'}),homeDiscoveryPlan({now:new Date('2026-10-14T08:15:00Z'),city:'Balasore'}));
 assert.equal(homeDiscoveryPlan({now:new Date('2026-10-14T02:00:00Z'),city:'Balasore'}).focus,'transport');
 assert.equal(homeDiscoveryPlan({now:new Date('2026-10-14T12:00:00Z'),city:'Balasore'}).servicesFirst,false);
});
test('market preferences need their expanded consent; service interest can promote the six-card grid',()=>{
 const now=new Date('2026-10-14T08:00:00Z');
 assert.equal(homeDiscoveryPlan({now,personalised:true,marketPersonalised:true,preferredFocus:'marketplace',preferredMarketMode:'sell'}).focus,'marketplace');
 assert.equal(homeDiscoveryPlan({now,personalised:true,marketPersonalised:true,preferredFocus:'marketplace',preferredMarketMode:'sell'}).marketMode,'sell');
 assert.deepEqual(homeDiscoveryPlan({now,personalised:false,marketPersonalised:false,preferredFocus:'marketplace',preferredMarketMode:'sell'}),homeDiscoveryPlan({now}));
 assert(homeDiscoveryPlan({now,personalised:true,preferredFocus:'repair',repairVisits:2}).servicesFirst);
 assert.equal(homeDiscoveryPlan({now:new Date('2026-10-14T02:00:00Z'),personalised:true,marketPersonalised:true,preferredFocus:'marketplace'}).focus,'transport');
});
test('the event bridge recognises exact market modes without treating them as repair categories',()=>{
 for(const mode of ['refurbished','preowned','rentals','sell']){
  assert.equal(marketplaceCategory(mode),'market_'+mode);assert.equal(marketplaceIntent(['market_'+mode]),mode);
  assert.deepEqual(typeDiscoveryIntent(['market_'+mode]),{focus:'marketplace',mode});
 }
 assert.equal(typeDiscoveryIntent(['market_unknown']),null);assert.equal(marketplaceCategory('unknown'),'');assert.equal(marketplaceIntent(null),null);
});
