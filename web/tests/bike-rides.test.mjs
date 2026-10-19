import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const operations=url('export const operation=(...args)=>globalThis.__bikeOperation(...args)');
const api=url('export const apiFetch=(...args)=>globalThis.__bikeFetch(...args)');
const source=(await readFile(new URL('../src/services/bike-rides-api.ts',import.meta.url),'utf8')).replace("'./operations'",JSON.stringify(operations)).replace("'./api'",JSON.stringify(api));
const bike=await import(url(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText));
afterEach(()=>{delete globalThis.__bikeOperation;delete globalThis.__bikeFetch;});

test('stale, malformed and future GPS never appears live to the customer',()=>{
 const ride={position:{lat:21.4,lng:86.9,received_at:1000}};
 assert.equal(bike.bikeFreshPosition(ride,1075),ride.position);
 assert.equal(bike.bikeFreshPosition(ride,1076),null);
 assert.equal(bike.bikeFreshPosition(ride,990),null);
 assert.equal(bike.bikeFreshPosition({position:{lat:NaN,lng:86.9,received_at:1000}},1001),null);
 assert.equal(bike.bikeFreshPosition({position:{lat:21.4,lng:Infinity,received_at:1000}},1001),null);
 assert.equal(bike.bikeFreshPosition({},1001),null);
});
test('quote expiry is authoritative at the boundary and does not accept missing deadlines',()=>{
 assert.equal(bike.bikeQuoteExpired({expires_at:2000},1999),false);
 assert.equal(bike.bikeQuoteExpired({expires_at:2000},2000),true);
 assert.equal(bike.bikeQuoteExpired({},1000),true);
});
test('an uncertain booking finds only its own saved request without submitting twice',async()=>{
 const input={request_id:'request-one',quote_id:'quote-one',consent:true};const calls=[];
 globalThis.__bikeOperation=async(path,init)=>{calls.push({path,init});if(init.method==='POST')throw new TypeError('Connection lost');return {rides:[{id:'other',request_id:'request-other'},{id:'saved',request_id:input.request_id}]};};
 assert.equal((await bike.bookBike(input)).id,'saved');
 assert.equal(calls.filter(call=>call.init.method==='POST').length,1);
 assert.deepEqual(JSON.parse(calls[0].init.body),input);
});
test('an uncertain booking without its own receipt preserves the error and retry key',async()=>{
 const failure=new TypeError('Response lost');const input={request_id:'same-retry-key',quote_id:'one'};const sent=[];
 globalThis.__bikeOperation=async(_path,init)=>{if(init.method==='POST'){sent.push(JSON.parse(init.body));throw failure;}return {rides:[{request_id:'someone-else',quote_id:'one'}]};};
 await assert.rejects(bike.bookBike(input),error=>error===failure);
 await assert.rejects(bike.bookBike(input),error=>error===failure);
 assert.equal(sent.length,2);assert.equal(sent[0].request_id,sent[1].request_id);
});
test('a definite rejection is not converted to success by a different receipt',async()=>{
 let calls=0;const failure=Object.assign(new Error('Quote expired'),{status:409});
 globalThis.__bikeOperation=async()=>{calls++;throw failure;};
 await assert.rejects(bike.bookBike({request_id:'one'}),error=>error===failure);assert.equal(calls,1);
});
test('commands preserve optimistic version and command identity for safe retries',async()=>{
 let sent;globalThis.__bikeOperation=async(path,init,options)=>{sent={path,body:JSON.parse(init.body),options};return {id:'ride/one',version:8};};
 const result=await bike.bikeCommand({id:'ride/one',version:7},'confirm','stable-command');
 assert.equal(result.version,8);assert.equal(sent.path,'/bike-rides/bookings/ride%2Fone/commands');assert.deepEqual(sent.body,{command_id:'stable-command',expected_version:7,action:'confirm'});assert.equal(sent.options.feedback,false);
});
test('search uses private matching while the readiness policy is a public quiet read',async()=>{
 const controller=new AbortController();let search,policy;
 globalThis.__bikeOperation=async(path,init,options)=>{search={path,init,options};return {quotes:[]};};
 globalThis.__bikeFetch=async(path,init,options)=>{policy={path,init,options};return new Response(JSON.stringify({enabled:false}),{headers:{'Content-Type':'application/json'}});};
 const pickup={lat:21.4,lng:86.9},dropoff={lat:21.41,lng:86.91};await bike.searchBikes({...pickup,address:'Private pickup address',city:'Balasore'},{...dropoff,address:'Private drop-off address',city:'Balasore'},controller.signal);assert.equal(search.path,'/bike-rides/search');assert.equal(search.init.signal,controller.signal);assert.deepEqual(JSON.parse(search.init.body),{pickup,dropoff});assert.equal(search.options.feedback,false);
 assert.deepEqual(await bike.bikePolicy(controller.signal),{enabled:false});assert.equal(policy.path,'/api/operations/bike-rides/policy');assert.equal(policy.init.signal,controller.signal);assert.equal(policy.options.feedback,false);
});
test('ordered matching has distinct pending and unavailable outcomes',()=>{
 assert.equal(bike.bikeFinished('dispatch_pending'),false);assert.equal(bike.bikeFinished('unavailable'),true);assert.equal(bike.bikeRideLabel('dispatch_pending'),'Finding your rider');assert.equal(bike.bikeRideLabel('unavailable'),'No ride reserved');assert.equal(bike.bikeFinished('queued'),false);
});

test('arrival cues expire at the server GPS deadline and require a fresh participant position',()=>{const ride={position:{lat:21.4,lng:86.9,received_at:1000},stop_status:{pickup:{status:'inside',valid_until:1050}}};assert.equal(bike.bikeStopInside(ride,'pickup',1049),true);assert.equal(bike.bikeStopInside(ride,'pickup',1051),false);assert.equal(bike.bikeStopInside(ride,'destination',1049),false);assert.equal(bike.bikeStopInside({...ride,position:null},'pickup',1049),false);});

test('a late command response cannot replace a newer driver lifecycle snapshot',()=>{const current=[{id:'one',version:7,state:'on_the_way'}];assert.equal(bike.saveBikeSnapshot(current,{id:'one',version:6,state:'accepted'}),current);assert.equal(bike.saveBikeSnapshot(current,{id:'one',version:8,state:'arrived'})[0].state,'arrived');assert.equal(bike.saveBikeSnapshot(current,{id:'two',version:1,state:'dispatch_pending'}).length,2);});

test('history cursor is escaped and pages preserve newer lifecycle snapshots',async()=>{let path;globalThis.__bikeOperation=async next=>{path=next;return {rides:[],next_cursor:null};};await bike.getBikeRides(undefined,'cursor/with +chars');assert.equal(path,'/bike-rides/bookings?after=cursor%2Fwith%20%2Bchars');const result=bike.mergeBikeSnapshots([{id:'one',version:7,created_at:100,state:'arrived'},{id:'old',version:1,created_at:50}],[{id:'one',version:6,created_at:100,state:'accepted'},{id:'new',version:1,created_at:200}]);assert.deepEqual(result.map(row=>row.id),['new','one','old']);assert.equal(result[1].state,'arrived');});
