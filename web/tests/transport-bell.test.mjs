import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/services/transportBell.ts',import.meta.url),'utf8');
const executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .* from ['"]\.\/taskBell\.mjs['"];?$/m,'const startTaskBell=globalThis.__startTransportBell;');
let service,revision=0,rings,contexts;
const note=(id,fields={})=>({id,kind:'local_business',event_type:'rescheduled',created_at:Date.now()/1000,...fields});
beforeEach(async()=>{
 rings=0;contexts=[];globalThis.__startTransportBell=()=>{rings++;return()=>{};};
 globalThis.AudioContext=class{constructor(){this.state='suspended';contexts.push(this);}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}};
 service=await import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));
});
test('initial notes are quiet; a new time change rings once across repeated background reads',async()=>{
 await service.enableTransportBell('account-a');service.receiveTransportNotes([note('existing')],'account-a');assert.equal(rings,0);
 service.receiveTransportNotes([note('existing'),note('changed')],'account-a');assert.equal(rings,1);
 for(let i=0;i<4;i++)service.receiveTransportNotes([note('existing'),note('changed')],'account-a');assert.equal(rings,1);
 service.receiveTransportNotes([note('changed'),note('reminder',{event_type:'departure_reminder'})],'account-a');assert.equal(rings,2);
});
test('read, old and unrelated save notifications never start an alarm',async()=>{
 await service.enableTransportBell('account-a');service.receiveTransportNotes([],'account-a');
 service.receiveTransportNotes([note('read',{read:true}),note('read-at',{read_at:Date.now()/1000}),note('old',{created_at:Date.now()/1000-1000}),note('save',{event_type:'saved'}),note('other',{kind:'community'})],'account-a');assert.equal(rings,0);
});
test('switching accounts stops sound and requires a fresh deliberate enable',async()=>{
 await service.enableTransportBell('account-a');service.receiveTransportNotes([],'account-a');service.bindTransportBell('account-b');assert.equal(contexts[0].state,'closed');assert.equal(service.transportBellEnabled(),false);
 service.receiveTransportNotes([note('first-b')],'account-b');service.receiveTransportNotes([note('second-b')],'account-b');assert.equal(rings,0);
 await service.enableTransportBell('account-b');service.receiveTransportNotes([note('third-b')],'account-b');assert.equal(rings,1);service.disableTransportBell();assert.equal(service.transportBellEnabled(),false);service.receiveTransportNotes([note('fourth-b')],'account-b');assert.equal(rings,1);
});
test('an audio permission resolving after an account switch cannot enable the next account',async()=>{
 let resume;globalThis.AudioContext=class{constructor(){this.state='suspended';}resume(){return new Promise(resolve=>{resume=()=>{this.state='running';resolve();};});}async close(){this.state='closed';}};
 const pending=service.enableTransportBell('account-a');service.bindTransportBell('account-b');resume();await assert.rejects(pending,/account changed/);assert.equal(service.transportBellEnabled(),false);
});
