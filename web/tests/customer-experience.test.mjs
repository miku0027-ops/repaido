import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {readVisits,addVisit} from '../src/services/customerVisits.mjs';
import {contractCalendarEvents,contractDayKey,contractMonthDays,shiftContractMonth} from '../src/services/contractCalendar.mjs';
const source=await readFile(new URL('../src/services/customerBrowseTracker.ts',import.meta.url),'utf8');
const visits=await readFile(new URL('../src/services/customerVisits.mjs',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .+ from 'react';$/m,'const useEffect=()=>{},useState=()=>{};').replace("from './customerVisits.mjs'","from 'data:text/javascript;base64,"+Buffer.from(visits).toString('base64')+"'");
test('device visits count once per document, survive reload, ignore tab changes and count a long return',async()=>{
 const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.hidden=false;
 let first;for(let i=1;i<=3;i++){const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64')+'#visit'+i);const stop=mod.listenCustomerVisits();mod.recordCustomerBrowse();mod.recordCustomerBrowse('tab:Services');assert.equal(mod.getCustomerBrowseCount(),i);assert.equal(mod.recordCustomerBrowse().isHydrated,i>=3);stop();first=mod;}
 const realNow=Date.now;let now=realNow();Date.now=()=>now;const stop=first.listenCustomerVisits();try{document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));now+=5*60*1000;document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));assert.equal(first.getCustomerBrowseCount(),3);document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));now+=31*60*1000;document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));assert.equal(first.getCustomerBrowseCount(),4);}finally{Date.now=realNow;stop();}
});
test('visit storage is bounded and blocked or corrupt storage cannot crash the app',()=>{
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};assert.equal(readVisits(blocked),0);assert.equal(addVisit(blocked,2),3);
 for(const value of ['broken','null','{"count":-4}','{"count":1.2}','{"count":"9"}'])assert.equal(readVisits({getItem:()=>value}),0);
 assert.equal(addVisit({getItem:()=>'{"count":1000000}',setItem(){}}),1000000);
});
test('contract days use India time across midnight and calendars handle leap years and year boundaries',()=>{
 assert.equal(contractDayKey(Date.parse('2026-10-06T18:45:00Z')/1000),'2026-10-07');assert.equal(contractDayKey(NaN),'');
 assert.equal(contractMonthDays('2024-02').filter(Boolean).length,29);assert.equal(contractMonthDays('2026-02').filter(Boolean).length,28);assert.equal(contractMonthDays('bad').length,0);assert.equal(shiftContractMonth('2026-12',1),'2027-01');assert.equal(shiftContractMonth('2026-01',-1),'2025-12');
});
test('day agenda preserves actual work, purchases, reviewed records and payment truth without inventing daily tasks',()=>{
 const at=Date.parse('2026-10-07T06:00:00Z')/1000;
 const events=contractCalendarEvents({project:{starts_at:at,ends_at:at+86400},milestones:[{id:'goal',title:'Wiring',due_at:at,status:'planned'}],progress:[{id:'progress',percent:20,note:'Installed conduit',created_at:at,status:'reported'}],payments:[{id:'requested',created_at:at,amount_paise:1500,status:'requested',method:'neft'},{id:'captured',created_at:at,confirmed_at:at+3600,amount_paise:2000,status:'confirmed',method:'gateway',source:'platform_collection'}],purchases:[{id:'purchase',title:'Cable',vendor:'Local supplier',receipt_reference:'INV-1',purchased_at:at,amount_paise:1000,status:'reported'}],team:[{worker_id:'member',name:'Electrician',accepted_at:at,role:'member'}],attendance:[{worker_id:'member',in_at:at,out_at:at+3600}]});
 assert.equal(events.filter(e=>e.title==='Payment confirmed').length,1);assert.match(events.find(e=>e.title==='Payment confirmed').detail,/platform_collection/);assert.match(events.find(e=>e.title==='Cable').detail,/reported/);assert.equal(events.find(e=>e.title==='Cable').amount,1000);assert.equal(events.filter(e=>e.title.includes('check-in')).length,1);assert.equal(events.filter(e=>e.kind==='work'&&e.day==='2026-10-08').length,1);
});
