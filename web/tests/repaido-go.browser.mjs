import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const work=await mkdtemp('/tmp/repaido-go-'),checks=[],errors=[],requests=[];
const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const api='http://127.0.0.1:'+port,backend=resolve(web,'../backend'),server=spawn(backend+'/.venv/bin/python',[web+'/tests/repaido-go-api.py',work+'/go.db',String(port)],{cwd:backend,stdio:['ignore','pipe','pipe']});
let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',value=>log+=value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pin={lat:21.4934,lng:86.9135};
async function call(path,body,uid='customer',method){const response=await fetch(api+'/operations'+path,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+uid,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(response.ok,`${path}: ${response.status} ${await response.clone().text()}`);return response.json();}
const local=epoch=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(epoch)).replace(' ','T');
async function choosePin(page,title,label,point){
 const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();
 await dialog.getByLabel('Latitude',{exact:true}).fill(String(point.lat));await dialog.getByLabel('Longitude',{exact:true}).fill(String(point.lng));
 await dialog.getByLabel('House, street and landmark',{exact:true}).fill(label);await dialog.getByLabel('City',{exact:true}).fill('Balasore');
 await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:/Use this drop-off|Confirm this location/}).click();
}
try{
 let ready=false;for(let attempt=0;attempt<300;attempt++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}assert(ready,'Isolated Go API starts');
 await call('/coupons/launch',{});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:466,height:850},reducedMotion:'reduce',timezoneId:'Asia/Kolkata'});
 await context.addInitScript(pin=>{
  localStorage.setItem('repaido.place',JSON.stringify({...pin,confirmed:true,city:'Balasore',address:'Local college pickup entrance',label:'Home'}));
  window.__mapsCreated=0;window.__markers=[];
  window.google={maps:{Map:class{constructor(element){window.__mapsCreated++;element.style.background='linear-gradient(35deg,#e4e9df,#f6f5ef)';element.innerHTML='<span style="display:block;padding:20px;font-size:12px;color:#354231">Local Google Maps SDK fixture</span>';}addListener(){return{remove(){}}}fitBounds(){}setCenter(){}panTo(){}},Marker:class{constructor(options){this.position=options.position;window.__markers.push(this);}setMap(map){this.visible=!!map;}setPosition(point){this.position=point;}setTitle(){}},Polyline:class{setMap(){}},LatLngBounds:class{extend(){}},SymbolPath:{CIRCLE:0},event:{trigger(){}}}};
 },pin);

 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.hostname!=='127.0.0.1')return route.abort('blockedbyclient');
  if(request.isNavigationRequest()&&['/go','/'].includes(url.pathname)){const response=await route.fetch({url:origin+'/tests/customer-rides-app-preview.html'+url.search});return route.fulfill({response});}
  if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,method:request.method()});
  const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});return route.fulfill({response});
 });
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/customer-rides-app-preview.html?tab=explore');
 await page.locator('.repaido-go-entry').waitFor();assert.equal(await page.locator('.home-discovery-hub .mobility-experience').count(),0);assert.equal(await page.locator('.android-explore-screen .mobility-mode-switch').count(),0);assert.equal(await page.evaluate(()=>window.__mapsCreated),0);
 assert.equal(requests.filter(row=>/bike-rides\/(?:policy|nearby|map-config)/.test(row.path)).length,0,'Home does not mount transport discovery');
 checks.push('Home has one compact Go entry, no booking map or five-mode ride panel, and no ride-discovery network work.');
 await page.locator('.repaido-go-entry').click();const go=page.getByRole('region',{name:'Repaido Go',exact:true});await go.waitFor();await go.getByText('Routes up to 4 km',{exact:false}).waitFor();assert.equal(new URL(page.url()).pathname,'/go');assert.equal(await page.locator('.repaido-home-header').count(),0);assert.equal(await page.locator('.repaido-customer-footer').count(),0);
 const modes=go.getByRole('group',{name:'Transport service type'});assert.equal(await modes.getByRole('button').count(),3);
 await go.locator('.bike-location-dropoff').click();const dropoff={lat:pin.lat+.008,lng:pin.lng};await choosePin(page,'Bike drop-off','Local hospital drop-off entrance',dropoff);
 await modes.getByRole('button',{name:/^Cab/}).click();await go.getByRole('region',{name:'Repaido Go pickup map'}).waitFor();assert.equal(await go.locator('.leaflet-container').count(),0);await modes.getByRole('button',{name:/^Bike/}).click();assert(await go.getByRole('button',{name:/Drop-off Local hospital/}).isVisible());
 checks.push('Bike and Cab share Go; cab browsing uses Google, and changing mode preserves the bike pickup/destination draft.');
 await go.getByRole('button',{name:'More ride options',exact:true}).click();const more=page.getByRole('dialog',{name:'More ways to go',exact:true});await more.waitFor();assert.equal(await more.locator('.go-more-options>button').count(),4);await page.keyboard.press('Escape');assert(await go.getByRole('button',{name:'More ride options',exact:true}).evaluate(el=>el===document.activeElement));
 const availability=await call('/bike-rides/driver/availability',undefined,'worker');
 await call('/bike-rides/driver/availability',{vehicle_id:availability.vehicles[0].id,online:true,position:{...pin,accuracy:5,captured_at:Date.now()/1000}},'worker','PUT');
 await go.getByRole('button',{name:'Find a bike',exact:true}).click();await go.locator('.bike-rider-choice').waitFor();await go.getByRole('button',{name:'Review',exact:true}).click();const review=page.getByRole('dialog',{name:'Review bike ride',exact:true});await review.getByLabel('I accept this fare and route',{exact:false}).check();await review.getByRole('button',{name:'Request bike ride',exact:true}).click();
 const liveBike=page.getByRole('dialog',{name:'Your bike ride',exact:true});await liveBike.waitFor();assert.deepEqual(await liveBike.boundingBox(),{x:0,y:0,width:466,height:850});await page.keyboard.press('Escape');assert(await liveBike.isVisible());assert.equal((await call('/bike-rides/bookings')).rides[0].state,'offered');
 await liveBike.getByRole('button',{name:'Cancel request',exact:true}).click();await page.getByRole('dialog',{name:'Cancel this bike request?',exact:true}).getByRole('button',{name:'Confirm cancellation',exact:true}).click();await liveBike.waitFor({state:'detached'});assert.equal((await call('/bike-rides/bookings')).rides[0].state,'cancelled');
 const all=go.getByRole('button',{name:'All rides',exact:true});if(await all.isVisible())await all.click();
 checks.push('A bike request from Go reaches the real native dispatcher; the waiting screen stays locked, and explicit cancellation reaches the native API.');
 await modes.getByRole('button',{name:/^Cab/}).click();await go.getByRole('button',{name:'Find a cab',exact:true}).click();const wizard=page.locator('.ride-booking-workspace');await wizard.waitFor();await page.getByLabel('Pickup date & time').fill(local(Date.now()+7200000));await page.getByLabel('Expected trip end').fill(local(Date.now()+18000000));await wizard.getByRole('button',{name:'Continue',exact:true}).click();
 await wizard.getByRole('button',{name:/Destination.*Choose on the map/}).click();await choosePin(page,'Choose destination','Local cab destination entrance',dropoff);await wizard.getByRole('button',{name:'Continue',exact:true}).click();await wizard.getByRole('button',{name:'Calculate full price',exact:true}).click();await wizard.locator('.ride-quote').waitFor();await wizard.getByRole('button',{name:'Continue',exact:true}).click();await wizard.getByLabel('I agree to these vehicle terms',{exact:false}).check();await wizard.getByRole('button',{name:'Send booking request',exact:true}).click();
 const liveCab=page.getByRole('dialog',{name:'Your cab ride',exact:true});await liveCab.waitFor();assert.deepEqual(await liveCab.boundingBox(),{x:0,y:0,width:466,height:850});await page.keyboard.press('Escape');assert(await liveCab.isVisible());assert.equal((await call('/local-business/rides')).rides[0].state,'requested');
 await liveCab.getByRole('button',{name:'Cancel',exact:true}).click();const cancelCab=page.getByRole('dialog',{name:'cancel',exact:true});await cancelCab.getByLabel('Notes',{exact:true}).fill('Local customer cancelled before acceptance.');await cancelCab.getByRole('button',{name:'Confirm cancel',exact:true}).click();await liveCab.waitFor({state:'detached'});assert.equal((await call('/local-business/rides')).rides[0].state,'cancelled');
 checks.push('Cab calendar, confirmed stops, actual vehicle quote and no-charge request still use the native APIs and the shared locked ride lifecycle.');
 await go.getByRole('button',{name:'My rides',exact:true}).click();await page.locator('.customer-bookings-page .transport-bookings').waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'rides');await page.reload();await page.locator('.customer-bookings-page .transport-bookings').waitFor();
 await page.goBack();await go.waitFor();await go.getByRole('button',{name:'Back to Repaido home',exact:true}).click();await page.locator('.android-explore-screen').waitFor();await page.goBack();await go.waitFor();
 checks.push('My rides survives reload; browser Back and the Go Home button restore the correct destination.');
 await modes.getByRole('button',{name:/^Cab/}).click();await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const service of ['Bike','Cab']){await modes.getByRole('button',{name:new RegExp('^'+service)}).click();
 for(const width of [320,466,1024])for(const scale of [100,200])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(({scale,theme})=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=theme;},{scale,theme});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width} ${scale} ${theme}`);
  const clipped=await modes.getByRole('button').evaluateAll(buttons=>buttons.flatMap(button=>{const bounds=button.getBoundingClientRect(),walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT),issues=[];let node;while(node=walker.nextNode())for(const word of node.textContent.matchAll(/[\p{L}\p{N}]+/gu)){const range=document.createRange();range.setStart(node,word.index);range.setEnd(node,word.index+word[0].length);for(const rect of range.getClientRects())if(rect.width&&(rect.left<bounds.left-1||rect.right>bounds.right+1))issues.push(word[0]);}return issues;}));assert.deepEqual(clipped,[],`mode text fits ${width} ${scale} ${theme}`);
  const violations=await page.evaluate(async()=>(await window.axe.run('.repaido-go',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));assert.deepEqual(violations,[],`${width} ${scale} ${theme}`);
 }}
 await page.setViewportSize({width:466,height:850});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});await page.screenshot({path:work+'/go-cab-466.png',fullPage:true});await modes.getByRole('button',{name:/^Bike/}).click();await page.screenshot({path:work+'/go-bike-466.png',fullPage:true});
 checks.push('Both Bike and Cab in Go have no horizontal overflow and pass WCAG A/AA at 320/466/1024, 100/200% text, light and dark.');
 await page.emulateMedia({reducedMotion:'no-preference'});await go.getByRole('button',{name:'Back to Repaido home',exact:true}).click();await page.locator('.android-explore-screen').waitFor();assert.equal(await page.locator('.brand-tab-transition').count(),0);await page.getByRole('navigation',{name:'Bottom Navigation',exact:true}).getByRole('button',{name:'Go',exact:true}).click();
 const animation=await page.locator('.motion-page').evaluate(el=>el.getAnimations().map(value=>({duration:value.effect.getTiming().duration,playState:value.playState})));assert(animation.some(value=>value.duration===260),'Destination gets a short transition without a blocking overlay');await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.motion-page').evaluate(el=>el.getAnimations().filter(value=>value.playState==='running').length),0);
 await go.getByRole('button',{name:'More ride options',exact:true}).click();assert.equal(await more.evaluate(el=>getComputedStyle(el).animationName),'none');await page.keyboard.press('Escape');
 checks.push('Destination motion is short and nonblocking, the random logo overlay is gone, and reduced motion cancels running transitions and sheet animations.');
 await page.goto(origin+'/tests/customer-rides-app-preview.html?tab=market&marketSub=mobility&ride=cab');await go.waitFor();assert.equal(await modes.getByRole('button',{name:/^Cab/}).getAttribute('aria-pressed'),'true');
 await page.goto(origin+'/go?ride=bike');await go.waitFor();assert.equal(await modes.getByRole('button',{name:/^Bike/}).getAttribute('aria-pressed'),'true');
 checks.push('Direct Go links and legacy Market ride links open the intended ride type.');
 await go.getByRole('button',{name:'Back to Repaido home',exact:true}).click();await page.locator('.repaido-go-entry').waitFor();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/home-go-entry-466.png',fullPage:true});await page.locator('.repaido-go-entry').screenshot({path:work+'/home-go-entry-card.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){await page?.screenshot({path:work+'/failure.png',fullPage:true}).catch(()=>{});console.error(error);console.error(log.slice(-2500));process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors,requests,server_log:log},null,2));console.log('Evidence: '+work);}
