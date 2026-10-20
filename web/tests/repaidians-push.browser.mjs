// Real Chromium worker/IndexedDB checks using local DevTools push delivery.
// This exercises browser recipient isolation; it does not claim an FCM network delivery.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=new URL(process.env.REPAIDO_TEST_WEB_ORIGIN||'http://127.0.0.1:5187');
if(!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('This isolated worker check requires a local development server.');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
async function eventually(page,read,label){
 const until=Date.now()+10000;
 while(Date.now()<until){const result=await read();if(result)return result;await page.waitForTimeout(100);}
 throw Error('Timed out waiting for '+label);
}
try{
 const context=await browser.newContext({permissions:['notifications']});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/__work-push-worker')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated push worker check</title><p>Worker check</p>'});if(url.origin!==origin.origin)return route.abort();return route.continue();});
 const page=await context.newPage(),cdp=await context.newCDPSession(page);let versions=[],registrations=[];cdp.on('ServiceWorker.workerVersionUpdated',event=>versions=event.versions);cdp.on('ServiceWorker.workerRegistrationUpdated',event=>registrations=event.registrations);await cdp.send('ServiceWorker.enable');
 await page.goto(new URL('/__work-push-worker',origin).href);
 await page.evaluate(async()=>{window.worker=await navigator.serviceWorker.register('/repaidians-work-push-sw.js',{scope:'/repaidians-push/'});if(!worker.active)await new Promise(resolve=>{const installing=worker.installing||worker.waiting;installing.addEventListener('statechange',()=>{if(installing.state==='activated')resolve();});});window.setPushAccount=async value=>{const channel=new MessageChannel();const done=new Promise((resolve,reject)=>{channel.port1.onmessage=event=>event.data.ok?resolve():reject(Error('Worker store failed'));});worker.active.postMessage({type:'repaidians-work-push-account',fingerprint:value},[channel.port2]);await done;};const value=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('account-a'));await setPushAccount([...new Uint8Array(value)].map(b=>b.toString(16).padStart(2,'0')).join(''));});
 const registration=registrations.find(row=>row.scopeURL.endsWith('/repaidians-push/'));assert.ok(registration,'Actual Chromium worker registered');
 const send=async(recipient,id,extra={})=>cdp.send('ServiceWorker.deliverPushMessage',{origin:origin.origin,registrationId:registration.registrationId,data:JSON.stringify({data:{destination:'repaidians',recipient_id:recipient,notification_id:id,...extra}})});
 await send('account-a','first');const delivered=await eventually(page,()=>page.evaluate(async()=>{const notification=(await worker.getNotifications()).find(item=>item.tag==='repaidians-work-first');return notification?.title||false;}),'initial browser notification');assert.equal(delivered,'Repaidians work update');
 const live=versions.find(row=>row.registrationId===registration.registrationId&&row.status==='activated');assert.ok(live);await cdp.send('ServiceWorker.stopWorker',{versionId:live.versionId});
 await send('account-a','after-restart');await eventually(page,()=>page.evaluate(async()=>(await worker.getNotifications()).some(item=>item.tag==='repaidians-work-after-restart')),'notification after worker restart');
 await send('account-b','wrong-account');await page.waitForTimeout(250);assert.equal(await page.evaluate(async()=>(await worker.getNotifications()).some(item=>item.tag==='repaidians-work-wrong-account')),false);
 const projectId='project-'+'a'.repeat(32),projectData={destination:'contractor',work_event:'project_team_confirmed',project_id:projectId,project_role:'technician',expires_at:String(Date.now()/1000+600)};
 await send('account-a','team-confirmed',projectData);const team=await eventually(page,()=>page.evaluate(async()=>{const note=(await worker.getNotifications()).find(item=>item.tag==='repaidians-work-team-confirmed');return note?{title:note.title,url:note.data.url}:false;}),'private team notification');assert.deepEqual(team,{title:'Project team update',url:'/worker?mode=technician&tab=projects&project='+projectId});
 await send('account-a','invalid-project',{...projectData,project_id:'../private'});await send('account-b','wrong-team-recipient',projectData);await page.waitForTimeout(300);assert.equal(await page.evaluate(async()=>(await worker.getNotifications()).some(item=>['repaidians-work-invalid-project','repaidians-work-wrong-team-recipient'].includes(item.tag))),false);
 await page.evaluate(()=>setPushAccount(null));await send('account-a','after-signout');await send('account-a','team-after-signout',projectData);await page.waitForTimeout(250);assert.equal(await page.evaluate(async()=>(await worker.getNotifications()).some(item=>['repaidians-work-after-signout','repaidians-work-team-after-signout'].includes(item.tag))),false);
 await page.evaluate(async()=>{for(const notification of await worker.getNotifications())notification.close();});
 console.log(JSON.stringify({passed:true,actualWorker:true,recipientGuard:true,idleRestart:true,signoutGuard:true,projectTeamRoute:true,invalidProjectGuard:true,externalNetwork:false}));
 await context.close();
}finally{await browser.close();}
