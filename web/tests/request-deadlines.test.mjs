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
test('automatic POSTs and read-only searches remain quiet for the entire request',async()=>{
 for(const path of ['/api/operations/coupons/launch','/api/operations/discovery/events','/api/operations/market/search','/api/operations/worker/availability']){
  const deadlines=pendingTransport();
  const request=apiFetch(path,{method:'POST',body:'{"heartbeat":true}'});
  assert.deepEqual(loadingState.getSnapshot(),[],path);assert.deepEqual(actionFeedback.getSnapshot(),[],path);
  deadlines[0].controller.abort(new DOMException('Timed out','TimeoutError'));
  await assert.rejects(request,{name:'TimeoutError'});assert.deepEqual(actionFeedback.getSnapshot(),[],path);
 }
});

for(const origin of ['https://repaido.web.app','https://repaido.firebaseapp.com']){
 test('production '+origin+' uses its hosted API for admin reads and private media',async()=>{
  const productionSource=feedbackImports((await readFile(new URL('../src/services/api.ts',import.meta.url),'utf8')).replace("'./loading'",JSON.stringify(loadingUrl)).replaceAll('import.meta.env.VITE_API_BASE_URL',"''").replaceAll('import.meta.env.DEV','false'));
  const api=await import(moduleUrl('const location={origin:'+JSON.stringify(origin)+'};\n'+productionSource));
  let request;globalThis.fetch=async(url,init)=>{request={url,init};return new Response('{}');};
  await api.apiFetch('/api/operations/admin/workers',{headers:{Authorization:'Bearer fixture-admin'}});
  assert.equal(request.url,'/api/operations/admin/workers');assert.equal(request.init.headers.Authorization,'Bearer fixture-admin');
  assert.equal(api.apiAssetUrl('/api/operations/admin/documents/private'),'/api/operations/admin/documents/private');
 });
}
test('explicit API deployments and the non-Firebase production fallback remain usable',async()=>{
 for(const [configured,page,expected] of [['https://api.example.test/','https://repaido.web.app','https://api.example.test'],['','https://other.example.test','https://repaido-api-rivzaqvyvq-uc.a.run.app']]){
  const code=feedbackImports((await readFile(new URL('../src/services/api.ts',import.meta.url),'utf8')).replace("'./loading'",JSON.stringify(loadingUrl)).replaceAll('import.meta.env.VITE_API_BASE_URL',JSON.stringify(configured)).replaceAll('import.meta.env.DEV','false'));
  const api=await import(moduleUrl('const location={origin:'+JSON.stringify(page)+'};\n'+code));let sent;
  globalThis.fetch=async(url)=>{sent=url;return new Response('{}');};await api.apiFetch('/api/operations/admin/jobs');assert.equal(sent,expected+'/api/operations/admin/jobs');
 }
});
