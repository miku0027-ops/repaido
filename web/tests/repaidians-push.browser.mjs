// Real Chromium worker/IndexedDB checks using local DevTools push delivery.
// This exercises browser recipient isolation; it does not claim an FCM network delivery.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=new URL(process.env.REPAIDO_TEST_WEB_ORIGIN||'http://127.0.0.1:5187');
if(!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('This isolated worker check requires a local development server.');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({permissions:['notifications']});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/__work-push-worker')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated push worker check</title><p>Worker check</p>'});if(url.origin!==origin.origin)return route.abort();return route.continue();});
 const page=await context.newPage(),cdp=await context.newCDPSession(page);let versions=[],registrations=[];cdp.on('ServiceWorker.workerVersionUpdated',event=>versions=event.versions);cdp.on('ServiceWorker.workerRegistrationUpdated',event=>registrations=event.registrations);await cdp.send('ServiceWorker.enable');
 await page.goto(new URL('/__work-push-worker',origin).href);
 await page.evaluate(async()=>{window.worker=await navigator.serviceWorker.register('/repaidians-work-push-sw.js',{scope:'/repaidians-push/'});if(!worker.active)await new Promise(resolve=>{const installing=worker.installing||worker.waiting;installing.addEventListener('statechange',()=>{if(installing.state==='activated')resolve();});});window.setPushAccount=async value=>{const channel=new MessageChannel();const done=new Promise((resolve,reject)=>{channel.port1.onmessage=event=>event.data.ok?resolve():reject(Error('Worker store failed'));});worker.active.postMessage({type:'repaidians-work-push-account',fingerprint:value},[channel.port2]);await done;};const value=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('account-a'));await setPushAccount([...new Uint8Array(value)].map(b=>b.toString(16).padStart(2,'0')).join(''));});
 const registration=registrations.find(row=>row.scopeURL.endsWith('/repaidians-push/'));assert.ok(registration,'Actual Chromium worker registered');
 const send=async(recipient,id)=>cdp.send('ServiceWorker.deliverPushMessage',{origin:origin.origin,registrationId:registration.registrationId,data:JSON.stringify({data:{destination:'repaidians',recipient_id:recipient,notification_id:id}})});
 await send('account-a','first');await page.waitForFunction(async()=>{const notification=(await worker.getNotifications()).find(item=>item.tag==='repaidians-work-first');if(!notification)return false;window.observedTitle=notification.title;return true;});assert.equal(await page.evaluate(()=>observedTitle),'Repaidians work update');
 const live=versions.find(row=>row.registrationId===registration.registrationId&&row.status==='activated');assert.ok(live);await cdp.send('ServiceWorker.stopWorker',{versionId:live.versionId});
 await send('account-a','after-restart');await page.waitForFunction(async()=>(await worker.getNotifications()).some(item=>item.tag==='repaidians-work-after-restart'));
 await send('account-b','wrong-account');await page.waitForTimeout(250);assert.equal(await page.evaluate(async()=>(await worker.getNotifications()).some(item=>item.tag==='repaidians-work-wrong-account')),false);
 await page.evaluate(()=>setPushAccount(null));await send('account-a','after-signout');await page.waitForTimeout(250);assert.equal(await page.evaluate(async()=>(await worker.getNotifications()).some(item=>item.tag==='repaidians-work-after-signout')),false);
 await page.evaluate(async()=>{for(const notification of await worker.getNotifications())notification.close();});
 console.log(JSON.stringify({passed:true,actualWorker:true,recipientGuard:true,idleRestart:true,signoutGuard:true,externalNetwork:false}));
 await context.close();
}finally{await browser.close();}
