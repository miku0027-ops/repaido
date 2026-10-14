import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {apiImports} from './api-module.mjs';
import {feedbackModuleUrl} from './feedback-module.mjs';

let code=ts.transpileModule(await readFile(new URL('../src/services/localBusiness.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
code=apiImports(code).replace(/import \{ operation \} from ['"]\.\/operations['"];?/, 'const operation=(...args)=>globalThis.__scrapOperation(...args);').replaceAll("import('./actionFeedback')",'import('+JSON.stringify(feedbackModuleUrl)+')');
const service=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const {actionFeedback,clearFeedback}=await import(feedbackModuleUrl);
let calls=[];
beforeEach(()=>{calls=[];clearFeedback();globalThis.__scrapOperation=async(...args)=>{calls.push(args);return {id:'collection-one',state:'evaluated'};};});

test('a lost quote reply is confirmed only by the exact server command receipt',async()=>{
 globalThis.__scrapOperation=async(path,init,options)=>{calls.push([path,init,options]);if(init.method==='POST')throw new TypeError('Failed to fetch');return {id:'collection-one',state:'evaluated',evaluation_command_id:'same-command'};};
 const result=await service.submitWeighingQuote('collection-one',{command_id:'same-command',expected_version:4});
 assert.equal(result.evaluation_command_id,'same-command');assert.equal(calls.length,2);
 assert.equal(calls[1][0],'/local-business/scrap/collection-one');assert.equal(calls[1][2].force,true);
 assert.ok(calls.every(call=>call[2].feedback===false),'One user action produces one completion notice.');
 assert.equal(actionFeedback.getSnapshot()[0].title,'Weighing quote sent');
});
test('an unrelated quote or a failed confirmation lookup never becomes success',async()=>{
 for(const lookup of [()=>({evaluation_command_id:'another-command'}),()=>{throw Error('Read unavailable');}]){
  globalThis.__scrapOperation=async(_path,init)=>{if(init.method==='POST')throw new TypeError('Failed to fetch');return lookup();};
  await assert.rejects(service.submitWeighingQuote('collection-one',{command_id:'same-command'}),/Failed to fetch/);
  assert.equal(actionFeedback.getSnapshot()[0].tone,'error');clearFeedback();
 }
});
test('field/version errors preserve the server rejection without extra confirmation reads',async()=>{
 globalThis.__scrapOperation=async(...args)=>{calls.push(args);throw Object.assign(Error('Confirm arrival before weighing.'),{status:409});};
 await assert.rejects(service.submitWeighingQuote('collection-one',{command_id:'same-command'}),/Confirm arrival/);assert.equal(calls.length,1);
});
test('a lost pickup request reply requires both its private photo and matching request details',async()=>{
 const body={photo_document_id:'owned-camera-photo',material:'metal',description:'Dry household metal',estimated_kg:10,address:'Confirmed pickup 123',city:'Balasore',starts_at:1792040400,phone:'9876543210'};
 let rows=[{...body,id:'saved-request',state:'requested'}];
 globalThis.__scrapOperation=async(_path,init)=>{if(init.method==='POST')throw Error('Connection interrupted');return {collections:rows};};
 assert.equal((await service.submitScrapRequest(body)).id,'saved-request');
 clearFeedback();rows=[{...body,estimated_kg:20,id:'different-request',state:'requested'}];
 await assert.rejects(service.submitScrapRequest(body),/Connection interrupted/);
});
