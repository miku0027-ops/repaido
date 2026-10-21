import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
const require=createRequire(import.meta.url),{chromium}=require('/opt/codex/runtimes/cua/lib/node_modules/playwright');
const origin=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187';assert.equal(new URL(origin).hostname,'127.0.0.1');
const work=await mkdtemp('/tmp/repaido-native-go-'),reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const api='http://127.0.0.1:'+port,server=spawn('../backend/.venv/bin/python',['tests/repaido-go-api.py',work+'/go.db',String(port)]),pause=ms=>new Promise(r=>setTimeout(r,ms));
let log='',browser;const requests=[],errors=[];for(const stream of [server.stdout,server.stderr])stream.on('data',v=>log+=v);
try{
 let ready=false;for(let i=0;i<250;i++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}assert(ready);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  window.nativeCalls=[];window.nativePushAllowed=true;window.nativeBound='';
  window.RepaidoNative={postMessage(raw){const request=JSON.parse(raw);window.nativeCalls.push(request);let result='saved',error;
   if(request.action==='appKind')result='go_customer';else if(request.action==='ridePushVersion')result='1';
   else if(request.action==='pushStatus')result=window.nativePushAllowed?'enabled':'disabled';
   else if(request.action==='pushToken'){result='local-go-token-for-native-bridge';if(!window.nativePushAllowed)error='Notifications remain off in Android settings.';}
   else if(request.action==='bindPushAccount')window.nativeBound=request.uid;
   queueMicrotask(()=>window.RepaidoNative.onmessage?.({data:JSON.stringify({id:request.id,result,error})}));
  }};
 });
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(request.isNavigationRequest()&&['/go','/'].includes(url.pathname)){const response=await route.fetch({url:origin+'/tests/customer-rides-app-preview.html'+url.search});return route.fulfill({response});}
  if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(url.pathname==='/api/operations/devices'&&request.method()==='POST')requests.push({body:request.postDataJSON(),auth:request.headers().authorization});
  const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});return route.fulfill({response});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(origin+'/go?ride=bike');await page.waitForFunction(()=>document.documentElement.dataset.nativeApp==='go_customer');
 const nav=page.getByRole('navigation',{name:'Bottom Navigation',exact:true});assert.deepEqual(await nav.locator('button').allTextContents(),['Ride','My rides','Account','Repaido']);
 assert.equal(requests.length,0,'Opening Go does not enable push without consent');
 await page.getByText('Ride alerts',{exact:true}).click();await page.getByRole('button',{name:'Enable ride notifications',exact:true}).click();
 await page.getByText('Ride notifications connected. Android controls sound and vibration.',{exact:true}).waitFor();
 assert.equal(requests[0].body.ride_push_capable,true);assert.equal(requests[0].body.audience,'customer');
 assert.equal(await page.evaluate(()=>window.nativeBound),'customer');
 await page.evaluate(()=>{window.nativePushAllowed=false;window.dispatchEvent(new Event('repaido:native-resume'));});await pause(200);
 const calls=await page.evaluate(()=>window.nativeCalls.filter(c=>c.action==='pushToken').length);assert.equal(calls,1,'Resume never repeats a denied permission prompt');
 await page.evaluate(()=>window.__customerRidesFixture.emit('stranger'));await page.waitForFunction(()=>window.nativeBound==='');assert.equal(requests.length,1,'Changing account does not inherit notification opt-in');
 await nav.getByRole('button',{name:'Repaido',exact:true}).click();assert(await page.evaluate(()=>window.nativeCalls.some(c=>c.action==='openRepaido')));
 await page.screenshot({path:work+'/go-android-customer.png',fullPage:true});
 assert.deepEqual(errors,[]);await writeFile(work+'/report.json',JSON.stringify({passed:true,checks:['Dedicated Go navigation keeps Ride, My rides and Account separate from the main app','Explicit opt-in registers the current native token with ride capability','Account changes clear native recipient binding','Resume honours disabled notifications without repeated prompts','Repaido handoff calls the native app action'],provider_boundary:'Simulated Android bridge with a real isolated API; no FCM delivery or device permission prompt was sent'},null,2));
 console.log('PASS: Go Android navigation, notification opt-in, account isolation and main-app handoff. Evidence: '+work);
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');}
