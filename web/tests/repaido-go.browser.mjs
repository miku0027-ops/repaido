import {chooseRidePin} from './ride-location.browser-helper.mjs';
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
const work=await mkdtemp('/tmp/repaido-go-'),checks=[],errors=[],requests=[],recordVideo=process.env.REPAIDO_QA_VIDEO==='1';
const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const api='http://127.0.0.1:'+port,backend=resolve(web,'../backend'),server=spawn(backend+'/.venv/bin/python',[web+'/tests/repaido-go-api.py',work+'/go.db',String(port)],{cwd:backend,stdio:['ignore','pipe','pipe']});
let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',value=>log+=value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pin={lat:21.4934,lng:86.9135};
async function call(path,body,uid='customer',method){const response=await fetch(api+'/operations'+path,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+uid,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(response.ok,`${path}: ${response.status} ${await response.clone().text()}`);return response.json();}
const local=epoch=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(epoch)).replace(' ','T');
async function slide(button,portion=1){
 await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box);const x=box.x+29,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+(box.width-66)*portion,y,{steps:16});await page.mouse.up();
}
async function choosePin(page,title,label,point){await chooseRidePin(page,label,point,title==='Your pickup area'?'pickup':'dropoff');}

try{
 let ready=false;for(let attempt=0;attempt<300;attempt++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}assert(ready,'Isolated Go API starts');
 await call('/coupons/launch',{});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:466,height:850},reducedMotion:recordVideo?'no-preference':'reduce',timezoneId:'Asia/Kolkata',...(recordVideo?{recordVideo:{dir:work+'/video',size:{width:466,height:850}}}:{})});
 await context.addInitScript(pin=>{
  localStorage.setItem('repaido.place',JSON.stringify({...pin,confirmed:true,city:'Balasore',address:'Local college pickup entrance',label:'Home'}));
  window.__mapsCreated=0;window.__markers=[];
  window.google={maps:{Map:class{constructor(element){window.__mapsCreated++;element.style.background='linear-gradient(35deg,#e4e9df,#f6f5ef)';element.innerHTML='<span style="display:block;padding:20px;font-size:12px;color:#354231">Local Google Maps SDK fixture</span>';}addListener(){return{remove(){}}}fitBounds(){}setCenter(){}setZoom(){}moveCamera(view){window.__lastCamera=view;}panTo(){}},Marker:class{constructor(options){this.position=options.position;this.icon=options.icon;this.title=options.title;this.visible=true;window.__markers.push(this);}setMap(map){this.visible=!!map;}setPosition(point){this.position=point;}setTitle(){}},Polyline:class{setMap(){}},LatLngBounds:class{extend(){}},SymbolPath:{CIRCLE:0},event:{trigger(){}}}};
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
 assert.equal(requests.filter(row=>/bike-rides\/(?:nearby|map-config)/.test(row.path)).length,0,'Home does not mount transport discovery');
 await page.locator('.repaido-go-entry').scrollIntoViewIfNeeded();await page.locator('.go-entry-offer').waitFor();assert.match(await page.locator('.go-entry-offer').innerText(),/Up to 3 free bike rides\/week.*eligibility applies/);
 checks.push('Home has one compact Go entry with the current real offer; it mounts no booking map, nearby discovery or five-mode panel.');
 const bottom=page.getByRole('navigation',{name:'Bottom Navigation',exact:true});
 assert.deepEqual(await bottom.locator('button').allTextContents(),['Explore','Services','Go','Bookings','Market']);
 await bottom.getByRole('button',{name:'Services',exact:true}).click();assert.equal(await bottom.getByRole('button',{name:'Services',exact:true}).getAttribute('aria-current'),'page');
 const servicesNav=page.getByRole('navigation',{name:'Services and hiring',exact:true});await servicesNav.getByRole('button',{name:'Hire a professional',exact:true}).click();await page.locator('.hire-discovery-page').waitFor();assert.equal(await bottom.getByRole('button',{name:'Services',exact:true}).getAttribute('aria-current'),'page');assert.equal(new URL(page.url()).searchParams.get('tab'),'hire');await page.reload();await page.locator('.hire-discovery-page').waitFor();await page.getByRole('navigation',{name:'Services and hiring',exact:true}).getByRole('button',{name:'Services',exact:true}).click();
 await bottom.getByRole('button',{name:'Explore',exact:true}).click();
 checks.push('Services and Go are separate visible destinations in the five-item mobile navigation.');
 await page.locator('.repaido-go-entry').click();const go=page.getByRole('region',{name:'Repaido Go',exact:true});await go.waitFor();await go.getByText('Routes up to 4 km',{exact:false}).waitFor();assert.equal(new URL(page.url()).pathname,'/go');assert.equal(await page.locator('.repaido-home-header').count(),0);assert.equal(await page.locator('.repaido-customer-footer').count(),0);
 const modes=go.getByRole('group',{name:'Transport service type'});assert.equal(await modes.getByRole('button').count(),3);
 await go.locator('.bike-location-dropoff').click();const dropoff={lat:pin.lat+.008,lng:pin.lng};await choosePin(page,'Bike drop-off','Local hospital drop-off entrance',dropoff);
 await modes.getByRole('button',{name:/^Cab/}).click();await go.getByRole('region',{name:'Repaido Go pickup map'}).waitFor();assert.equal(await go.locator('.leaflet-container').count(),0);await modes.getByRole('button',{name:/^Bike/}).click();assert(await go.getByRole('button',{name:/Drop-off Local hospital/}).isVisible());
 checks.push('Bike and Cab share Go; cab browsing uses Google, and changing mode preserves the bike pickup/destination draft.');
 await go.getByRole('button',{name:'More ride options',exact:true}).click();const more=page.getByRole('dialog',{name:'More ways to go',exact:true});await more.waitFor();assert.equal(await more.locator('.go-more-options>button').count(),4);await page.keyboard.press('Escape');assert(await go.getByRole('button',{name:'More ride options',exact:true}).evaluate(el=>el===document.activeElement));
 const availability=await call('/bike-rides/driver/availability',undefined,'worker');
 await call('/bike-rides/driver/availability',{vehicle_id:availability.vehicles[0].id,online:true,position:{...pin,accuracy:5,captured_at:Date.now()/1000}},'worker','PUT');
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>window.__markers.some(marker=>marker.visible&&marker.title?.includes('Available bike nearby')&&marker.icon?.url?.startsWith('data:image/svg+xml')));
 const searchSlide=go.getByRole('button',{name:'Find a bike',exact:true});const searchesBefore=requests.filter(r=>r.path.endsWith('/bike-rides/search')).length;
 await searchSlide.click();await slide(searchSlide,.45);await pause(450);
 assert.equal(requests.filter(r=>r.path.endsWith('/bike-rides/search')).length,searchesBefore,'A tap or partial drag does not search');
 const touch=await context.newCDPSession(page);await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 async function touchSearch(cancel){await searchSlide.scrollIntoViewIfNeeded();const box=await searchSlide.boundingBox(),x=box.x+29,y=box.y+box.height/2;await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=16;i++){await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(box.width-66)*i/16,y,id:1}]});await pause(15);}await touch.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});}
 await touchSearch(true);assert.equal(requests.filter(r=>r.path.endsWith('/bike-rides/search')).length,searchesBefore,'Cancelled mobile gesture never searches');
 await pause(500);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/go-bike-ready-466.png',fullPage:true});
 await touchSearch(false);await go.locator('.bike-rider-choice').waitFor();assert.equal(requests.filter(r=>r.path.endsWith('/bike-rides/search')).length,searchesBefore+1,'Completed mobile slide searches once');
 await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});await touch.detach();
 await go.getByRole('button',{name:'Review',exact:true}).click();const review=page.getByRole('dialog',{name:'Review bike ride',exact:true});await review.getByLabel('I accept this fare and route',{exact:false}).check();
 const phone=review.getByLabel('Your phone',{exact:true}),savedPhone=await phone.inputValue();await phone.fill('12');await review.getByRole('button',{name:'Request bike ride',exact:true}).press('Enter');assert.equal((await call('/bike-rides/bookings')).rides.length,0,'Keyboard respects native phone validation');await phone.fill(savedPhone);await review.getByRole('button',{name:'Request bike ride',exact:true}).press('Space');
 const liveBike=page.getByRole('dialog',{name:'Your bike ride',exact:true});await liveBike.waitFor();assert.deepEqual(await liveBike.boundingBox(),{x:0,y:0,width:466,height:850});await page.keyboard.press('Escape');assert(await liveBike.isVisible());assert.equal((await call('/bike-rides/bookings')).rides[0].state,'offered');if(recordVideo){await page.waitForTimeout(3500);await page.screenshot({path:work+'/go-searching-466.png'});}
 await liveBike.getByRole('button',{name:'Cancel request',exact:true}).click();await page.getByRole('dialog',{name:'Cancel this bike request?',exact:true}).getByRole('button',{name:'Confirm cancellation',exact:true}).click();await liveBike.waitFor({state:'detached'});assert.equal((await call('/bike-rides/bookings')).rides[0].state,'cancelled');
 const all=go.getByRole('button',{name:'All rides',exact:true});if(await all.isVisible())await all.click();
 checks.push('Mouse taps, partial slides and cancelled touch gestures never search; a completed mobile swipe searches once. Keyboard Enter/Space respect native form validation.');
 checks.push('A bike request from Go reaches the real native dispatcher; the waiting screen stays locked, and explicit cancellation reaches the native API.');
 await modes.getByRole('button',{name:/^Cab/}).click();
 const quickCab=go.getByRole('region',{name:'Quick cab booking',exact:true});await quickCab.waitFor();
 assert.equal(await quickCab.locator('input[type="datetime-local"]').count(),0,'Quick cab has no calendar step');
 assert.equal(await page.getByRole('dialog',{name:'Book a cab',exact:true}).count(),0);
 assert.equal(await go.locator('.mobility-heading').count(),0,'The area selector no longer consumes a separate row');
 assert(await go.locator('.go-header .go-header-area').isVisible());
 const cabSearch=quickCab.getByRole('button',{name:'Find a cab',exact:true});assert(await cabSearch.isDisabled());
 assert.equal(await quickCab.locator('.ride-slide').getAttribute('data-state'),'blocked');
 await quickCab.locator('.bike-location-dropoff').click();await choosePin(page,'Choose destination','Local cab destination entrance',dropoff);
 await page.waitForFunction(()=>document.querySelector('.go-vehicle-booking .ride-slide')?.dataset.state==='ready');
 await slide(cabSearch);await quickCab.getByRole('button',{name:'Calculate full price',exact:true}).click();await quickCab.locator('.ride-quote').waitFor();
 assert.equal(await page.locator('.ride-booking-workspace').count(),0,'Cab stays inline instead of entering the old wizard');
 const cabConfirm=quickCab.getByRole('button',{name:'Send booking request',exact:true});
 await slide(cabConfirm);assert.equal((await call('/local-business/rides')).rides.length,0,'Slide cannot bypass vehicle consent');
 assert.equal(await cabConfirm.locator('..').getAttribute('data-state'),'invalid');
 await quickCab.getByLabel('I agree to these vehicle terms',{exact:false}).check();await slide(cabConfirm);
 const liveCab=page.getByRole('dialog',{name:'Your cab ride',exact:true});await liveCab.waitFor();assert.deepEqual(await liveCab.boundingBox(),{x:0,y:0,width:466,height:850});await page.keyboard.press('Escape');assert(await liveCab.isVisible());assert.equal((await call('/local-business/rides')).rides[0].state,'requested');
 await liveCab.getByRole('button',{name:'Cancel',exact:true}).click();const cancelCab=page.getByRole('dialog',{name:'cancel',exact:true});await cancelCab.getByLabel('Notes',{exact:true}).fill('Local customer cancelled before acceptance.');await cancelCab.getByRole('button',{name:'Confirm cancel',exact:true}).click();await liveCab.waitFor({state:'detached'});assert.equal((await call('/local-business/rides')).rides[0].state,'cancelled');
 checks.push('Quick cab stays on the same route screen without calendar steps or a booking modal; validation, actual quotes, consent and the locked native lifecycle remain enforced.');
 for(const [name,region] of [['Self-drive','Self-drive booking'],['Cab rental','Cab rental booking']]){
  await go.getByRole('button',{name:'More ride options',exact:true}).click();
  await page.getByRole('dialog',{name:'More ways to go',exact:true}).getByRole('button',{name:new RegExp('^'+name)}).click();
  const panel=go.getByRole('region',{name:region,exact:true});await panel.waitFor();
  assert.equal(await panel.locator('input[type="datetime-local"]').count(),2);
  assert.equal(await panel.locator('.bike-route-fields').count(),1);
  assert.equal(await page.locator('.mobility-booking-dialog').count(),0);
  await panel.locator('input[type="datetime-local"]').nth(0).fill(local(Date.now()+3600000));await panel.locator('input[type="datetime-local"]').nth(1).fill(local(Date.now()+10800000));
  await panel.locator('.bike-location-dropoff').click();await choosePin(page,'Choose destination','Local rental destination entrance',dropoff);
  await slide(panel.getByRole('button',{name:name==='Self-drive'?'Find available cars':'Find a rental cab',exact:true}));await panel.getByRole('button',{name:'Calculate full price',exact:true}).click();await panel.locator('.ride-quote').waitFor();
  await page.screenshot({path:work+'/'+(name==='Self-drive'?'self-drive':'cab-rental')+'-quote-466.png',fullPage:true});
  if(name==='Self-drive'){await panel.getByLabel('I agree to these vehicle terms',{exact:false}).check();const before=(await call('/local-business/rides')).rides.length;await panel.getByRole('button',{name:'Send booking request',exact:true}).press('Enter');assert.equal((await call('/local-business/rides')).rides.length,before,'Self-drive requires a licence before submission');}
  await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
  for(const width of [320,466,1024])for(const scale of [100,200])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:850});await page.evaluate(({scale,theme})=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=theme;},{scale,theme});
   assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${name} quote overflow ${width} ${scale} ${theme}`);
   const issues=await page.evaluate(async()=>(await window.axe.run('.go-vehicle-booking',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));assert.deepEqual(issues,[],`${name} ${width} ${scale} ${theme}`);
  }
  await page.setViewportSize({width:466,height:850});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});
 }
 checks.push('Self-drive and cab rental show their required dates and route inline in Go, with no separate booking modal.');
 await go.locator('.go-header-area').click();await choosePin(page,'Your pickup area','New local college pickup entrance',{lat:pin.lat+.001,lng:pin.lng});
 await modes.getByRole('button',{name:/^Cab/}).click();await go.getByRole('button',{name:/Pickup New local college/}).waitFor({state:'visible'});await modes.getByRole('button',{name:/^Bike/}).click();await go.getByRole('button',{name:/Pickup New local college/}).waitFor({state:'visible'});
 checks.push('Changing the area next to the wordmark updates both route composers and invalidates old fare choices.');
 await modes.getByRole('button',{name:/^Cab/}).click();
 await go.getByRole('button',{name:'My rides',exact:true}).click();await page.locator('.customer-bookings-page .transport-bookings').waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'rides');await page.reload();await page.locator('.customer-bookings-page .transport-bookings').waitFor();
 await page.goBack();await go.waitFor();await go.getByRole('button',{name:'Back to Repaido home',exact:true}).click();await page.locator('.android-explore-screen').waitFor();await page.goBack();await go.waitFor();
 checks.push('My rides survives reload; browser Back and the Go Home button restore the correct destination.');
 await modes.getByRole('button',{name:/^Cab/}).click();await page.emulateMedia({reducedMotion:'reduce'});await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
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
 const animation=await page.locator('.motion-page[data-motion-variant=page]').first().evaluate(el=>el.getAnimations().map(value=>({duration:value.effect.getTiming().duration,playState:value.playState})));assert(animation.some(value=>value.duration===260),'Destination gets a short transition without a blocking overlay');await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.motion-page[data-motion-variant=page]').first().evaluate(el=>el.getAnimations().filter(value=>value.playState==='running').length),0);
 await go.getByRole('button',{name:'More ride options',exact:true}).click();assert.equal(await more.evaluate(el=>getComputedStyle(el).animationName),'none');await page.keyboard.press('Escape');
 checks.push('Destination motion is short and nonblocking, the random logo overlay is gone, and reduced motion cancels running transitions and sheet animations.');
 await page.goto(origin+'/tests/customer-rides-app-preview.html?tab=market&marketSub=mobility&ride=cab');await go.waitFor();assert.equal(await modes.getByRole('button',{name:/^Cab/}).getAttribute('aria-pressed'),'true');
 await page.goto(origin+'/go?ride=bike');await go.waitFor();assert.equal(await modes.getByRole('button',{name:/^Bike/}).getAttribute('aria-pressed'),'true');
 checks.push('Direct Go links and legacy Market ride links open the intended ride type.');
 await go.getByRole('button',{name:'Back to Repaido home',exact:true}).click();await page.locator('.repaido-go-entry').waitFor();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/home-go-entry-466.png',fullPage:true});await page.locator('.repaido-go-entry').screenshot({path:work+'/home-go-entry-card.png'});
 const entry=page.locator('.repaido-go-entry');await page.emulateMedia({reducedMotion:'no-preference'});await entry.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.repaido-go-entry').dataset.animated==='true');await page.waitForTimeout(600);const beforeSwap=await entry.locator('.go-entry-car').evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(1700);assert.notEqual(await entry.locator('.go-entry-car').evaluate(el=>getComputedStyle(el).transform),beforeSwap);await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await entry.locator('.go-entry-car').evaluate(el=>getComputedStyle(el).animationName),'none');checks.push('Original bike/car artwork smoothly swaps positions, rests after a short cycle and honours reduced motion.');
 const historyCab=(await call('/local-business/rides')).rides[0];await page.goto(origin+'/go?ride=cab&view=rides&ride-booking='+historyCab.id);await page.locator('#ride-booking-'+historyCab.id).waitFor({state:'visible'});assert.equal(await page.getByRole('dialog',{name:'Your cab ride',exact:true}).count(),0);
 checks.push('A terminal cab notification opens its actual account-owned history record, rather than an empty live ride screen.');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){await page?.screenshot({path:work+'/failure.png',fullPage:true}).catch(()=>{});console.error(error);console.error(log.slice(-2500));process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors,requests,server_log:log},null,2));console.log('Evidence: '+work);}
