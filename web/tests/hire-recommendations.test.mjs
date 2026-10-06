import assert from 'node:assert/strict';
import {beforeEach,afterEach,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/services/hireRecommendations.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const originalNow=Date.now;
let service,revision=0,now,calls,listeners;
const user=uid=>({uid,getIdToken:async()=>uid+'-signed-token'});
const ok=value=>new Response(JSON.stringify(value),{status:200});
const summary=name=>({categories:[{id:'electrician',name,personalised:true}],professionals:[],comparisons:[],selected_category:'electrician'});
const input={city:'Balasore',category:'electrician',radius_km:20,compare_ids:[]};
beforeEach(async()=>{
 now=100000;Date.now=()=>now;calls=[];listeners=[];
 globalThis.window=new EventTarget();
 globalThis.__hireAuth={currentUser:user('buyer-a'),authStateReady:async()=>{}};
 globalThis.__hireSubscribe=callback=>{listeners.push(callback);callback(globalThis.__hireAuth.currentUser);return()=>{};};
 globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return ok(summary('Actual electrical category'));};
 const code=compiled.replace(/^import \{ onIdTokenChanged \} from ['"]firebase\/auth['"];?$/m,'const onIdTokenChanged=(_auth,callback)=>globalThis.__hireSubscribe(callback);')
  .replace(/^import \{ auth \} from ['"]\.\.\/firebase['"];?$/m,'const auth=globalThis.__hireAuth;')
  .replace(/^import \{ apiFetch \} from ['"]\.\/api['"];?$/m,'const apiFetch=(...args)=>globalThis.__hireFetch(...args);')
  .replace(/from ['"]\.\/readCache\.mjs['"]/g,'from '+JSON.stringify(new URL('../src/services/readCache.mjs',import.meta.url).href));
 service=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+ ++revision);
});
afterEach(()=>{Date.now=originalNow;});
test('private recommendation reads use signed identity and expire in bounded memory',async()=>{
 const result=await service.hiringRecommendations(input);
 assert.equal(result.categories[0].name,'Actual electrical category');assert.equal(calls[0].path,'/api/operations/hiring/recommendations');
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers.Authorization,'Bearer buyer-a-signed-token');assert.deepEqual(JSON.parse(calls[0].init.body),input);
 await service.hiringRecommendations({...input});assert.equal(calls.length,1);
 now+=20000;await service.hiringRecommendations(input);assert.equal(calls.length,2);
});
test('concurrent reads deduplicate and live availability bypasses saved snapshots',async()=>{
 let finish;globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return new Promise(resolve=>{finish=resolve;});};
 const first=service.hiringRecommendations(input),second=service.hiringRecommendations({...input});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);finish(ok(summary('First')));
 assert.deepEqual(await first,await second);
 globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return ok(summary('Live'));};
 const live={...input,location:{lat:21.49,lng:86.93},available_only:true};
 await service.hiringRecommendations(live);await service.hiringRecommendations(live);assert.equal(calls.length,3);
});
test('guests cannot fetch private suggestions and account changes reject pending data',async()=>{
 globalThis.__hireAuth.currentUser=null;for(const listener of listeners)listener(null);
 await assert.rejects(service.hiringRecommendations(input),/Sign in/);assert.equal(calls.length,0);
 globalThis.__hireAuth.currentUser=user('buyer-a');for(const listener of listeners)listener(globalThis.__hireAuth.currentUser);
 let finish;globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return new Promise(resolve=>{finish=resolve;});};
 const pending=service.hiringRecommendations(input);while(!finish)await new Promise(resolve=>setImmediate(resolve));
 globalThis.__hireAuth.currentUser=user('buyer-b');for(const listener of listeners)listener(globalThis.__hireAuth.currentUser);finish(ok(summary('Private A')));
 await assert.rejects(pending,/account or preferences changed/);
 globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return ok(summary('Private B'));};
 assert.equal((await service.hiringRecommendations(input)).categories[0].name,'Private B');assert.equal(calls.at(-1).init.headers.Authorization,'Bearer buyer-b-signed-token');
});
test('consent events invalidate cached and in-flight recommendations',async()=>{
 await service.hiringRecommendations(input);window.dispatchEvent(new Event('repaido:interests'));
 let finish;globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return new Promise(resolve=>{finish=resolve;});};
 const pending=service.hiringRecommendations(input);while(!finish)await new Promise(resolve=>setImmediate(resolve));
 window.dispatchEvent(new Event('repaido:operations-updated'));finish(ok(summary('Before opt-out')));
 await assert.rejects(pending,/preferences changed/);
 globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return ok({...summary('After opt-out'),consent_required:true});};
 assert.equal((await service.hiringRecommendations(input)).consent_required,true);assert.equal(calls.length,3);
});
test('errors are actionable and failed reads never populate cache',async()=>{
 globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return new Response(JSON.stringify({detail:{message:'Choose a listed category.'}}),{status:422});};
 await assert.rejects(service.hiringRecommendations(input),/Choose a listed category/);
 globalThis.__hireFetch=async(path,init)=>{calls.push({path,init});return ok(summary('Recovered'));};
 assert.equal((await service.hiringRecommendations(input)).categories[0].name,'Recovered');assert.equal(calls.length,2);
});
