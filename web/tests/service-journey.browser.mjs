import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// The actual customer App, native transactional API, disposable data and auth.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.DISCOVERY_ORIGIN||'http://127.0.0.1:5187';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const work=await mkdtemp('/tmp/repaido-service-journey-'),checks=[],errors=[],writes=[];
const reserve=createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));const port=reserve.address().port;await new Promise(done=>reserve.close(done));
const api='http://127.0.0.1:'+port,server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/home_discovery_api.py',work+'/test.db',String(port)],{stdio:['ignore','pipe','pipe']});
let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',value=>log+=value);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const settle=page=>page.evaluate(async()=>{await new Promise(requestAnimationFrame);await Promise.race([new Promise(done=>setTimeout(done,1000)),Promise.all([...document.querySelectorAll('dialog[open]')].flatMap(node=>node.getAnimations({subtree:true})).filter(animation=>animation.playState==='running'&&animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))]);});
const mutations=()=>writes.filter(row=>/campaigns\/(select|selection)$|\/bookings$/.test(row.path));
async function audit(page,selector){return page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(row=>({id:row.id,nodes:row.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),selector);}
try{
 let ready=false;for(let i=0;i<300;i++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await sleep(100);}assert(ready,'Fixture API starts');
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:496,height:850},timezoneId:'Asia/Kolkata'});
 await context.addInitScript(()=>localStorage.setItem('repaido.place',JSON.stringify({lat:21.4934,lng:86.9135,confirmed:true,city:'Balasore',address:'Local fixture entrance'})));
 let rejectSelection=false,holdBooking=false,releaseBooking,expireFeed=false;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.hostname!=='127.0.0.1')return route.abort('blockedbyclient');
  if(request.isNavigationRequest()&&url.pathname==='/'){const response=await route.fetch({url:origin+'/tests/customer-rides-app-preview.html'+url.search});return route.fulfill({response});}
  if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(!['GET','HEAD'].includes(request.method()))writes.push({path:url.pathname,body:request.postData()});
  if(rejectSelection&&url.pathname.endsWith('/campaigns/select')){rejectSelection=false;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:{code:'OFFER_UNAVAILABLE',message:'This offer is no longer available. Continue without it or retry.'}})});}
  if(holdBooking&&url.pathname==='/api/operations/bookings'){await new Promise(done=>releaseBooking=done);holdBooking=false;}
  const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});
  if(expireFeed&&url.pathname.endsWith('/campaigns/feed/personal')&&JSON.parse(request.postData()||'{}').placement==='explore'){
   const data=await response.json();data.cards=data.cards.map(card=>({...card,ends_at:Date.now()/1000+4}));return route.fulfill({response,json:data});
  }
  return route.fulfill({response});
 });
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/?tab=explore');await page.locator('.repaido-search-input').click();const dialog=page.locator('dialog.search-discovery[open]');await dialog.waitFor();await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 const ac=dialog.locator('.discovery-card').filter({hasText:'AC service'});
 await ac.locator('.discovery-offer-chip').waitFor();assert.match(await ac.innerText(),/Save ₹100\.00 · ₹499\.00 with offer/);
 await ac.hover();await settle(page);assert.equal(await ac.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m42<0),true,'Hover lift remains active after the entrance animation finishes');await page.mouse.move(0,0);
 const before=mutations().length;
 await ac.getByRole('button',{name:'Scope & price',exact:true}).click();await dialog.getByRole('heading',{name:'AC service',exact:true}).waitFor();
 assert.match(await dialog.locator('.discovery-service-offer').innerText(),/₹499\.00.*₹599\.00/);
 await dialog.getByText('Offer terms & eligibility',{exact:true}).click();assert.match(await dialog.locator('.discovery-service-offer').innerText(),/Eligibility, remaining budget and price are checked at booking/);
 await dialog.getByRole('button',{name:'← Back to results',exact:true}).click();assert.equal(await ac.locator('.discovery-card-open').evaluate(e=>e===document.activeElement),true);
 for(const item of [ac,dialog.locator('.discovery-card').nth(1),dialog.locator('.discovery-card').nth(2)])await item.getByRole('checkbox').check();
 assert.equal(await dialog.locator('.discovery-card input:disabled').count(),await dialog.locator('.discovery-card input[type=checkbox]').count()-3);
 await dialog.getByRole('button',{name:'Compare services',exact:true}).click();await dialog.getByRole('heading',{name:'Compare your choices'}).waitFor();await dialog.getByRole('button',{name:'← Back to results',exact:true}).click();
 await dialog.getByRole('button',{name:'Clear compared services',exact:true}).click();assert.equal(mutations().length,before,'Browsing and comparing never selects offers or submits bookings');
 checks.push('Live offer belongs to exact service; scope, terms, keyboard focus and max-three comparison work without financial mutations.');
 for(const width of [320,496,960])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});await settle(page);
  assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`search overflow ${width}/${theme}/${scale}`);
  assert.deepEqual(await audit(page,'dialog.search-discovery'),[],`search accessibility ${width}/${theme}/${scale}`);
 }
 checks.push('Search cards: mobile/tablet, light/dark, 200% text and WCAG accessibility checks.');
 await page.setViewportSize({width:496,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await ac.scrollIntoViewIfNeeded();await settle(page);await page.screenshot({path:work+'/search-cards.png'});
 await ac.locator('.discovery-card-open').click();await dialog.locator('[data-kind=offer][data-ready=true]').waitFor();
 for(const width of [320,496])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});await settle(page);
  assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`service detail overflow ${width}/${theme}/${scale}`);assert.deepEqual(await audit(page,'dialog.search-discovery'),[],`detail accessibility ${width}/${theme}/${scale}`);
 }
 await page.setViewportSize({width:496,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await dialog.locator('.discovery-detail-hero').scrollIntoViewIfNeeded();await settle(page);await page.screenshot({path:work+'/service-scope.png'});
 rejectSelection=true;await dialog.getByRole('button',{name:/^Continue with offer/}).click();const booking=page.locator('dialog.service-booking-crafted[open]');await booking.getByRole('heading',{name:'Check your offer',exact:true}).waitFor();assert.equal(await booking.getByRole('button',{name:/^Request visit/}).isDisabled(),true);
 await booking.getByRole('button',{name:'Continue without offer',exact:true}).click();await booking.locator('.booking-offer').waitFor({state:'hidden'});await page.keyboard.press('Escape');
 checks.push('A server-rejected offer blocks a discounted request and provides an explicit continue-without-offer path.');
 await page.locator('.repaido-search-input').click();await ac.locator('.discovery-card-open').click();await dialog.getByRole('button',{name:/^Continue with offer/}).click();await booking.getByRole('heading',{name:'Offer applied',exact:true}).waitFor();
 assert.match(await booking.locator('.reference-invoice').innerText(),/Service after discounts\s+₹499\.00/);
 const date=await page.evaluate(()=>{const d=new Date(Date.now()+4*3600000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);});
 await booking.getByLabel('Appointment date and time').fill(date);await booking.locator('.booking-time-feedback [data-kind=calendar][data-ready=true]').waitFor();
 await booking.getByLabel('House number, street and landmark').fill('Disposable fixture entrance, no real address');await booking.getByText('Enter pin coordinates manually',{exact:true}).click();await booking.getByLabel('Latitude',{exact:true}).fill('21.4934');await booking.getByLabel('Longitude',{exact:true}).fill('86.9135');await booking.getByLabel('Contact number',{exact:true}).fill('9876543210');
 await booking.getByLabel('I confirm the location and included work.',{exact:false}).check();assert.equal(await booking.locator('.booking-progress li[data-complete=true]').count(),4);
 // Changing reviewed details requires a fresh confirmation.
 await booking.getByLabel('House number, street and landmark').fill('Updated disposable fixture entrance');assert.equal(await booking.getByLabel('I confirm the location and included work.',{exact:false}).isChecked(),false);await booking.getByLabel('I confirm the location and included work.',{exact:false}).check();
 for(const width of [320,496])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});await settle(page);
  assert.equal(await booking.evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`booking overflow ${width}/${theme}/${scale}`);assert.deepEqual(await audit(page,'dialog.service-booking-crafted'),[],`booking accessibility ${width}/${theme}/${scale}`);
 }
 checks.push('Real form progress, reviewed-detail re-confirmation, live discounted invoice, date animation and responsive booking accessibility.');
 await page.setViewportSize({width:496,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await booking.locator('.reference-invoice').scrollIntoViewIfNeeded();await settle(page);await page.screenshot({path:work+'/booking-review.png'});
 holdBooking=true;await booking.getByRole('button',{name:/^Request visit/}).click();await booking.locator('.booking-sending [data-kind=sending][data-ready=true]').waitFor();assert.equal(await booking.getByRole('button',{name:'Sending request…',exact:true}).isDisabled(),true);await sleep(100);releaseBooking();
 await page.getByRole('heading',{name:'Booking request received',exact:true}).waitFor();assert.match(await booking.locator('.booking-receipt-details').innerText(),/₹499\.00/);assert.match(await booking.locator('.booking-receipt').innerText(),/confirmed when a professional accepts/);assert.equal(await booking.locator('.booking-receipt').evaluate(e=>e===document.activeElement),true);
 const submitted=JSON.parse(writes.filter(w=>w.path==='/api/operations/bookings').at(-1).body);assert.equal(submitted.promotion_id,'test-offer');assert.equal(submitted.promotion_discount_paise,10000);assert.equal(submitted.promotion_original_price_paise,59900);assert.equal(submitted.service_id,'ac-service');assert.equal(submitted.preferred_worker_id,undefined);
 assert.equal(writes.filter(w=>w.path==='/api/operations/bookings').length,1);await settle(page);await page.screenshot({path:work+'/request-received.png'});
 checks.push('Native API creates exactly one correctly priced request; sending Lottie and honest request receipt preserve professional acceptance and pay-after-service rules.');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('.booking-receipt [data-motion=reduced]'));assert.equal(await booking.locator('.booking-receipt').evaluate(e=>getComputedStyle(e).animationName),'none');assert.deepEqual(await audit(page,'dialog.service-booking-crafted'),[]);
 await page.keyboard.press('Escape');expireFeed=true;await page.evaluate(()=>window.__customerRidesFixture.emit('stranger'));await page.locator('.repaido-search-input').click();
 await ac.locator('.discovery-offer-chip').waitFor();const readOnlyBefore=mutations().length;await ac.locator('.discovery-offer-chip').waitFor({state:'hidden'});assert.equal(mutations().length,readOnlyBefore,'Offer expiry changes presentation only');
 checks.push('Hover elevation works after entrance; expired offers disappear without customer action or financial mutations.');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,work,checks}));
}catch(error){await page?.screenshot({path:work+'/failure.png',fullPage:true}).catch(()=>{});console.error(error);console.error(log.slice(-1000));process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors,writes},null,2));console.log('Evidence: '+work);}
