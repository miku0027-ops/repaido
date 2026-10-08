import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {actionMessages} from '../src/services/actionMessages.mjs';
import {feedbackModuleUrl} from './feedback-module.mjs';
const {actionFeedback,withActionFeedback,clearFeedback,notifyFeedback}=await import(feedbackModuleUrl);
beforeEach(()=>clearFeedback());
test('searches, polling, device registrations and tracking do not report a saved submission',()=>{
 for(const path of ['/jobs','/market/search','/hiring/recommendations','/hiring/leaderboard','/custom-contracts/queries/a/view','/local-business/journeys/shared/a/position','/devices','/community/activity/heartbeat'])assert.equal(actionMessages(path,{method:path==='/jobs'?'GET':'POST'}),null,path);
});
test('payment checks and a saved draft never claim payment or publication',()=>{
 assert.equal(actionMessages('/market/1/payment-check',{method:'POST'}).result({status:'pending'}).tone,'info');
 const draft=actionMessages('/market/listings',{method:'POST'}).result({id:'listing',status:'awaiting_fee'});assert.equal(draft.title,'Listing saved');assert.match(draft.message,/fee/);
 assert.equal(actionMessages('/market/listings',{method:'POST'}).result({id:'listing',status:'published'}).title,'Listing published');
 assert.equal(actionMessages('/b2b/rfq/1/decision',{method:'POST',body:'{"action":"accept"}'}).result({}).message,'Your decision is saved. No payment was collected and stock was not reserved.');
});
test('progress remains pending until the actual response, with independent concurrent results',async()=>{
 let release;const request=withActionFeedback('/market/listings',{method:'POST'},()=>new Promise(resolve=>{release=resolve;}));
 assert.equal(actionFeedback.getSnapshot()[0].tone,'pending');
 await withActionFeedback('/hiring/requests',{method:'POST'},async()=>({id:'hire'}));
 assert.deepEqual(actionFeedback.getSnapshot().map(i=>i.tone),['pending','success']);
 release({id:'listing',status:'published'});await request;assert.equal(actionFeedback.getSnapshot()[0].title,'Listing published');
});
test('failed and uncertain submissions preserve the rejection and never announce success',async()=>{
 const failure=Error('Your quote changed. Review the latest price.');await assert.rejects(withActionFeedback('/hiring/requests/a/decision',{method:'POST'},async()=>{throw failure;}),e=>e===failure);
 assert.equal(actionFeedback.getSnapshot()[0].tone,'error');assert.equal(actionFeedback.getSnapshot()[0].message,failure.message);
 await assert.rejects(withActionFeedback('/market/listings',{method:'POST'},async()=>{throw new DOMException('Timed out','TimeoutError');}));
 assert.match(actionFeedback.getSnapshot().at(-1).message,/Check your saved records before retrying/);
});
test('an old response cannot overwrite a newer attempt or restore feedback cleared on account change',async()=>{
 let release;const first=withActionFeedback('/market/listings',{method:'POST'},()=>new Promise(resolve=>{release=resolve;}));
 await withActionFeedback('/market/listings',{method:'POST'},async()=>({id:'listing',status:'awaiting_fee'}));release({id:'listing',status:'published'});await first;
 assert.equal(actionFeedback.getSnapshot()[0].title,'Listing saved');
 const later=withActionFeedback('/hiring/requests',{method:'POST'},()=>new Promise(resolve=>{release=resolve;}));clearFeedback();release({});await later;assert.deepEqual(actionFeedback.getSnapshot(),[]);
});
test('identical errors do not accumulate separate cards',()=>{notifyFeedback({title:'Error',message:'Choose a file',tone:'error'},'one');notifyFeedback({title:'Error',message:'Choose a file',tone:'error'},'two');assert.equal(actionFeedback.getSnapshot().length,1);});
