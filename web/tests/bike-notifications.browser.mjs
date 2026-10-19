import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

// These are isolated real-component routing regressions, not backend lifecycle
// evidence. Firebase identity and HTTP responses are supplied by this fixture.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const work=await mkdtemp(resolve(tmpdir(),'repaido-bike-notifications-')),checks=[],errors=[],requests=[];
const origin=process.env.BIKE_NOTIFICATION_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const rideId='bike/id +?δ',notificationId='bike-notice/id +?1';
let browser;
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

async function scenario({mode,roles=['driver'],readStatus=200,readGate,meGate}={}){
  const context=await browser.newContext({viewport:{width:465,height:850},reducedMotion:'reduce'});
  const state={readRequests:0,meRequests:0,externalRequests:[]};
  await context.route('https://**/*',route=>{state.externalRequests.push(new URL(route.request().url()).hostname);return route.abort('blockedbyclient');});
  await context.route('**/@vite/client',async route=>{const response=await route.fetch();await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(')});});
  await context.route(url=>url.origin===origin&&url.pathname==='/worker',async route=>{
    if(new URL(route.request().url()).searchParams.get('fixture')==='bike-notifications'){
      // Vite must transform this HTML so its React refresh preamble runs before
      // the production component module, while the browser keeps /worker.
      const response=await route.fetch({url:origin+'/tests/bike-notifications-preview.html'});await route.fulfill({response});
    }
    else await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Worker destination fixture</title><h1>Worker destination fixture</h1>'});
  });
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),firstAccount=request.headers().authorization==='Bearer bike-notification-account-one';
    requests.push({mode:mode??'customer',path:url.pathname,method:request.method(),account:firstAccount?'one':'two'});
    let status=200,body;
    if(url.pathname==='/api/operations/notifications')body={notifications:firstAccount?[{id:notificationId,title:'Exact bike notification',body:'Open your specific bike ride.',kind:'local_business',destination:'mobility',business_id:'shared-ride-decoy',bike_ride_id:rideId,created_at:1700000000,read_at:null}]:[]};
    else if(url.pathname==='/api/operations/notifications/'+encodeURIComponent(notificationId)+'/read'){
      assert.equal(request.method(),'POST');state.readRequests++;if(readGate)await readGate.promise;status=readStatus;body=status===200?{read_at:1700000001}:{detail:{message:'The read could not be saved. Retry.'}};
    }else if(url.pathname==='/api/operations/worker/me'){
      state.meRequests++;if(meGate)await meGate.promise;body={registered_roles:roles};
    }else{status=404;body={detail:{message:'No notification fixture endpoint'}};}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const start=mode===undefined?origin+'/tests/bike-notifications-preview.html':origin+'/worker?fixture=bike-notifications&mode='+encodeURIComponent(mode);
  await page.goto(start);await page.getByRole('heading',{name:'Exact bike notification',exact:true}).waitFor();
  return {context,page,state,start,open:()=>page.getByRole('button',{name:'View details',exact:true}).click(),events:()=>page.evaluate(()=>window.bikeNotificationFixture.events)};
}

try{
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  {
    const gate=deferred(),s=await scenario({readGate:gate});await s.open();await s.page.waitForFunction(()=>document.querySelector('.notif-header-btn')?.disabled);
    assert.equal(s.state.readRequests,1);assert.deepEqual(await s.events(),[]);assert.equal(s.page.url(),s.start);assert(await s.page.getByRole('dialog',{name:'Notifications',exact:true}).isVisible());
    await s.open();assert.equal(s.state.readRequests,1);gate.resolve();await s.page.getByRole('dialog',{name:'Notifications',exact:true}).waitFor({state:'detached'});
    assert.deepEqual(await s.events(),['close','bike:'+rideId]);assert.equal(s.state.meRequests,0);
    checks.push('customer waits for the read commit, suppresses duplicate clicks, then closes before opening the exact bike ID; shared business_id is never used');await s.context.close();
  }
  {
    const s=await scenario({readStatus:503});await s.open();await s.page.getByRole('alert').filter({hasText:'The read could not be saved.'}).waitFor();assert.deepEqual(await s.events(),[]);assert.equal(s.page.url(),s.start);assert(await s.page.getByRole('dialog',{name:'Notifications',exact:true}).isVisible());
    checks.push('a failed read mutation leaves the customer in the notification panel without opening any ride');await s.context.close();
  }
  {
    const gate=deferred(),s=await scenario({readGate:gate});await s.open();await s.page.waitForFunction(()=>document.querySelector('.notif-header-btn')?.disabled);await s.page.evaluate(()=>window.bikeNotificationFixture.switchAccount());await s.page.getByRole('heading',{name:'No notifications here yet',exact:true}).waitFor();gate.resolve();await s.page.waitForTimeout(100);assert.deepEqual(await s.events(),[]);assert.equal(s.page.url(),s.start);assert.equal(await s.page.getByText('Exact bike notification',{exact:true}).count(),0);
    checks.push('account changes discard pending customer navigation and clear the previous account notification');await s.context.close();
  }
  for(const mode of ['driver','cab_owner']){
    const s=await scenario({mode,roles:[]});await s.open();await s.page.waitForURL(url=>url.pathname==='/worker'&&url.searchParams.get('bike-ride')===rideId);const url=new URL(s.page.url());assert.equal(url.searchParams.get('mode'),mode);assert.equal(url.searchParams.get('tab'),'bikes');assert.equal(s.state.meRequests,0);assert.equal(s.state.readRequests,1);
    checks.push('worker navigation preserves '+mode+' mode and encodes the exact bike ID');await s.context.close();
  }
  {
    const gate=deferred(),s=await scenario({mode:'driver',readGate:gate});await s.open();await s.page.waitForFunction(()=>document.querySelector('.notif-header-btn')?.disabled);assert.equal(s.state.readRequests,1);assert.equal(s.page.url(),s.start);assert.deepEqual(await s.events(),[]);gate.resolve();await s.page.waitForURL(url=>url.pathname==='/worker'&&url.searchParams.get('bike-ride')===rideId);
    checks.push('worker navigation also waits for the read commit before leaving the notification panel');await s.context.close();
  }
  {
    const s=await scenario({mode:'cab_owner',readStatus:503});await s.open();await s.page.getByRole('alert').filter({hasText:'The read could not be saved.'}).waitFor();assert.equal(s.page.url(),s.start);assert.deepEqual(await s.events(),[]);assert(await s.page.getByRole('dialog',{name:'Notifications',exact:true}).isVisible());
    checks.push('a failed worker read leaves the panel open and does not navigate');await s.context.close();
  }
  for(const [roles,expected] of [[['cab_owner'],'cab_owner'],[['driver','cab_owner'],'driver']]){
    const s=await scenario({mode:'agent',roles});await s.open();await s.page.waitForURL(url=>url.pathname==='/worker'&&url.searchParams.get('bike-ride')===rideId);const url=new URL(s.page.url());assert.equal(url.searchParams.get('mode'),expected);assert.equal(url.searchParams.get('tab'),'bikes');assert.equal(s.state.meRequests,1);assert.equal(s.state.readRequests,1);
    checks.push('unsupported current mode resolves the registered '+expected+' role from worker/me before navigation');await s.context.close();
  }
  {
    const s=await scenario({mode:'specialist',roles:['agent','specialist']});await s.open();await s.page.getByRole('alert').filter({hasText:'Open Bike rides from your approved rider account.'}).waitFor();assert.equal(s.state.meRequests,1);assert.equal(s.state.readRequests,0);assert.equal(s.page.url(),s.start);assert.deepEqual(await s.events(),[]);
    checks.push('an account without an approved bike-capable role sees an actionable error without marking or navigating');await s.context.close();
  }
  {
    const gate=deferred(),s=await scenario({mode:'agent',roles:['driver'],meGate:gate});await s.open();await s.page.waitForTimeout(100);assert.equal(s.state.meRequests,1);await s.page.evaluate(()=>window.bikeNotificationFixture.switchAccount());await s.page.getByRole('heading',{name:'No notifications here yet',exact:true}).waitFor();gate.resolve();await s.page.waitForTimeout(100);assert.equal(s.state.readRequests,0);assert.deepEqual(await s.events(),[]);assert.equal(s.page.url(),s.start);
    checks.push('an account change during worker role discovery cannot navigate or mark the former account ride');await s.context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);process.exitCode=1;}
finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors,requests},null,2));await browser?.close();console.log('Evidence: '+work);}
