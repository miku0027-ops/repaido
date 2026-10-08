import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {feedbackImports,feedbackModuleUrl} from './feedback-module.mjs';
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const loadingUrl=moduleUrl(await readFile(new URL('../src/services/loading.ts',import.meta.url),'utf8'));
const source=feedbackImports((await readFile(new URL('../src/services/api.ts',import.meta.url),'utf8')).replace("'./loading'",JSON.stringify(loadingUrl)).replaceAll('import.meta.env.VITE_API_BASE_URL',"''").replaceAll('import.meta.env.DEV','true'));
const {apiFetch}=await import(moduleUrl(source));
const {loadingState}=await import(loadingUrl);
const {actionFeedback,clearFeedback}=await import(feedbackModuleUrl);
const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout;
afterEach(()=>{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;clearFeedback();});
function pendingTransport(){
 const deadlines=[];
 AbortSignal.timeout=ms=>{const controller=new AbortController();deadlines.push({ms,controller});return controller.signal;};
 globalThis.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 return deadlines;
}
test('a caller signal keeps the deadline, reports uncertainty and clears loading after timeout',async()=>{
 const deadlines=pendingTransport(),caller=new AbortController();
 const request=apiFetch('/api/operations/profile',{method:'PUT',body:'{}',signal:caller.signal});
 assert.equal(deadlines[0].ms,20000);assert.equal(loadingState.getSnapshot().length,1);assert.equal(actionFeedback.getSnapshot()[0].tone,'pending');
 deadlines[0].controller.abort(new DOMException('Timed out','TimeoutError'));
 await assert.rejects(request,{name:'TimeoutError'});assert.equal(caller.signal.aborted,false);assert.deepEqual(loadingState.getSnapshot(),[]);
 assert.equal(actionFeedback.getSnapshot()[0].tone,'error');assert.match(actionFeedback.getSnapshot()[0].message,/Check your saved records before retrying/);
});
test('navigation cancellation still stops a request before its deadline',async()=>{
 const deadlines=pendingTransport(),caller=new AbortController();
 const request=apiFetch('/api/operations/profile',{signal:caller.signal});caller.abort();
 await assert.rejects(request,{name:'AbortError'});assert.equal(deadlines[0].controller.signal.aborted,false);assert.deepEqual(loadingState.getSnapshot(),[]);
});
test('binary and multipart uploads allow two minutes and retain cancellation',async()=>{
 for(const body of [new Blob(['photo']),new FormData()]){
  const deadlines=pendingTransport(),caller=new AbortController();const request=apiFetch('/api/operations/market/photos',{method:'POST',body,signal:caller.signal});
  assert.equal(deadlines[0].ms,120000);caller.abort();await assert.rejects(request,{name:'AbortError'});assert.deepEqual(loadingState.getSnapshot(),[]);
 }
});
test('a rejected save returns the response, preserves the server error and ends loading',async()=>{
 globalThis.fetch=async()=>new Response(JSON.stringify({detail:'Review the updated quote.'}),{status:409,headers:{'Content-Type':'application/json'}});
 const response=await apiFetch('/api/operations/hiring/requests/one/decision',{method:'POST',body:'{}'});
 assert.equal(response.status,409);assert.equal(actionFeedback.getSnapshot()[0].message,'Review the updated quote.');assert.equal(actionFeedback.getSnapshot()[0].tone,'error');assert.deepEqual(loadingState.getSnapshot(),[]);
});
