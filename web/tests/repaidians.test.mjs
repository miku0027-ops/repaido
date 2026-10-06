import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {beforeEach,test} from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/services/repaidiansService.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const service=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
beforeEach(()=>values.clear());
test('15-minute quota survives reload reads, deduplicates overlapping tabs and resets at local midnight',()=>{
  const now=new Date(2026,9,6,12,0).getTime();
  assert.equal(service.chargeBrowsing('guest',now,now+600000),300000);
  assert.equal(service.chargeBrowsing('guest',now,now+660000),240000);
  assert.equal(service.usage('guest',now+660000).usedMs,660000);
  assert.equal(service.chargeBrowsing('guest',now+660000,now+1000000),0);
  const midnight=new Date(2026,9,7,0,0).getTime();
  assert.equal(service.usage('guest',midnight).usedMs,0);
  assert.equal(service.chargeBrowsing('guest',midnight-5000,midnight+2000),898000);
});
test('free users cannot publish, bid or DM, and mock Pro stays isolated from other accounts',()=>{
  assert.throws(()=>service.publish('guest',{kind:'post'}),/Pro/);
  assert.throws(()=>service.bid('guest','sample-tender-electrical'),/Pro/);
  assert.throws(()=>service.sendMessage('guest','sipun','Hello'),/Pro/);
  const sub=service.activateMockPro('guest');
  assert.equal(sub.provider,'mock');assert.equal(sub.amountPaise,19900);
  assert.equal(service.subscription('other'),null);
  assert.equal(service.subscription('guest',sub.endsAt),null);
  service.sendMessage('guest','sipun','Please share the scope');
  assert.equal(service.snapshot('guest').activity.messages.length,1);
  assert.equal(service.snapshot('other').activity.messages.length,0);
});
test('monthly demo access clamps the end date when the next month is shorter',()=>{
  const now=new Date(2027,0,31,10,0).getTime();
  const value=service.activateMockPro('guest',now),end=new Date(value.endsAt);
  assert.equal(end.getMonth(),1);assert.equal(end.getDate(),28);assert.equal(end.getHours(),10);
});
test('visibility respects trade restrictions and a story expires without reseeding on reload',()=>{
  const state=service.snapshot('guest');
  const items=[{id:'public',authorId:'other',trade:'cleaning',visibility:'public',createdAt:1},{id:'restricted',authorId:'other',trade:'cleaning',visibility:'trade',createdAt:2},{id:'mine',authorId:state.member.id,trade:'cleaning',visibility:'trade',createdAt:3}];
  assert.deepEqual(service.visibleItems(items,state.member).map(p=>p.id),['mine','public']);
  const original=state.data.stories[0].expiresAt;
  assert.equal(service.communityData().stories[0].expiresAt,original);
});
test('publishing, comments, saves, follows and bids persist without inventing engagement counts',()=>{
  service.activateMockPro('guest');
  const id=service.publish('guest',{kind:'post',caption:'A local work preview',trade:'electrician',visibility:'trade',media:[{kind:'image',url:'/images/electrical.jpg',alt:'Inspection'}]});
  service.toggleActivity('guest','likes',id);service.toggleActivity('guest','saved',id);service.follow('guest','sipun');service.comment('guest',id,'Good scope');
  service.bid('guest','sample-tender-electrical');
  let state=service.snapshot('guest');
  assert.equal(state.data.posts[0].id,id);assert.equal(state.data.posts[0].sample,false);
  assert.equal(state.activity.likes.length,1);assert.equal(state.activity.following.length,1);assert.equal(state.data.comments[0].text,'Good scope');assert.equal(state.activity.bids.length,1);
  assert.equal(state.data.follows.filter(edge=>edge.to==='sipun').length,1);
  service.toggleActivity('guest','likes',id);
  assert.equal(service.snapshot('guest').activity.likes.length,0);
  assert.equal(service.snapshot('other').activity.saved.length,0);
});
