import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-home-checks-')),api='http://127.0.0.1:8067',origin=process.env.DISCOVERY_ORIGIN||'http://127.0.0.1:5186';
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/home_discovery_api.py',work+'/test.db','8067'],{stdio:['ignore','pipe','pipe']});
let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',d=>log+=d);
const errors=[],writes=[],checks=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
// Theme colors transition independently; audit the settled appearance in each variant.
const settleAppearance=page=>page.evaluate(async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
try{
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:487,height:850}});
 await context.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET')writes.push({path:url.pathname,method:req.method(),body:req.postData()});const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});await route.fulfill({response});});
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tests/home-discovery-preview.html');await page.locator('.service-offer-tile').first().waitFor();assert.equal(await page.locator('.service-offer-tile').count(),3);
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,390,487,1440])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});await settleAppearance(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow ${width} ${theme} ${scale}`);
  const failures=await page.evaluate(async()=>{const result=await axe.run('.android-explore-screen',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}});return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
  assert.deepEqual(failures,[],`${width} ${theme} ${scale}`);
  assert.equal(await page.locator('.story-label').evaluateAll(es=>es.some(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)),false,'category labels must not clip');
 }
 checks.push('home variants: 320 / 390 / 487 / 1440, light / dark, 100% / 200% text, enhanced contrast');
 await page.setViewportSize({width:487,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});
 await page.screenshot({path:work+'/home.png',fullPage:true});
 const types=page.getByRole('group',{name:'Transport service type'});
 for(const name of ['Cab','Self-drive','Cab rental','Shared ride']){await types.getByRole('button',{name,exact:true}).click();assert.equal(await types.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');}
 const departures=page.getByRole('button',{name:/^Upcoming departures/});await departures.click();assert.equal(await departures.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.transport-panel-body').isVisible(),false);await departures.click();await page.getByRole('button',{name:'Try another pickup area'}).waitFor();
 await page.getByRole('button',{name:'Repairs',exact:true}).click();await page.getByRole('searchbox',{name:'Describe the work'}).fill('Tap needs repair');await page.getByRole('button',{name:'Rides',exact:true}).click();await page.getByRole('button',{name:'Repairs',exact:true}).click();assert.equal(await page.getByRole('searchbox',{name:'Describe the work'}).inputValue(),'Tap needs repair');await page.getByRole('button',{name:'Rides',exact:true}).click();checks.push('mode selection, collapsible departures and repair draft retention');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.home-season-tag').evaluate(e=>getComputedStyle(e).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 const ac=page.locator('.service-offer-tile').filter({hasText:'Appliance Repair'});await ac.click();await page.getByRole('heading',{name:'Offer applied',exact:true}).waitFor();assert.match(await page.locator('.booking-offer').innerText(),/₹100/);assert(writes.some(w=>w.path==='/api/operations/campaigns/select'));await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Reopen AC booking'}).click();await page.getByRole('heading',{name:'Offer applied',exact:true}).waitFor();await page.getByRole('button',{name:'Remove offer',exact:true}).click();await page.getByRole('heading',{name:'Offer applied',exact:true}).waitFor({state:'hidden'});await page.keyboard.press('Escape');await page.getByRole('button',{name:'Reopen AC booking'}).click();await page.locator('.booking-offer').waitFor({state:'hidden'});await page.keyboard.press('Escape');checks.push('first click saves an offer, later booking restores it, explicit removal persists');
 await page.getByRole('button',{name:'Switch test account'}).click();await page.waitForFunction(()=>document.querySelectorAll('.service-offer-tile').length===1);await page.getByRole('button',{name:'Reopen AC booking'}).click();await page.locator('.booking-offer').waitFor({state:'hidden'});await page.keyboard.press('Escape');checks.push('returning-customer eligibility and saved selections are isolated across accounts');
 await page.locator('.service-offer-tile').click();await page.getByRole('heading',{name:'Offer applied',exact:true}).waitFor();
 await page.getByLabel('Appointment date and time').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));await page.getByLabel('House number, street and landmark').fill('Fixture private test entrance');await page.getByText('Enter pin coordinates manually',{exact:true}).click();await page.getByLabel('Latitude',{exact:true}).fill('21.4934');await page.getByLabel('Longitude',{exact:true}).fill('86.9135');await page.getByLabel('Contact number',{exact:true}).fill('9876543210');await page.getByLabel('I confirm the location and included work.',{exact:false}).check();await page.getByRole('button',{name:/^Request visit/}).click();await page.getByRole('heading',{name:'Booking request received',exact:true}).waitFor();
 const submitted=JSON.parse(writes.find(w=>w.path==='/api/operations/bookings').body);assert.equal(submitted.promotion_id,'test-offer');assert.equal(submitted.promotion_discount_paise,10000);assert.equal(submitted.promotion_version,1);checks.push('booking sends the saved promotion and reviewed price/version to the real transactional API');
 await page.getByRole('button',{name:'Dismiss notification',exact:true}).click();await page.keyboard.press('Escape');const before=writes.filter(w=>/campaigns\/select|bookings$|campaigns\/selection/.test(w.path)).length;await pause(21000);assert.equal(writes.filter(w=>/campaigns\/select|bookings$|campaigns\/selection/.test(w.path)).length,before);assert.equal(await page.locator('.app-feedback-card').count(),0);checks.push('idle refresh does not resubmit selections/bookings or display save popups');
 // A delayed old account feed must not replace the new account's eligible offers.
 const race=await context.newPage();let releaseOld;const held=new Promise(resolve=>releaseOld=resolve);let oldStarted;const began=new Promise(resolve=>oldStarted=resolve);
 await race.route('**/api/operations/campaigns/feed/personal',async route=>{
  const response=await route.fetch({url:api+'/operations/campaigns/feed/personal'});
  if(route.request().headers().authorization==='Bearer customer'){oldStarted();await held;}
  await route.fulfill({response});
 });
 await race.goto(origin+'/tests/home-discovery-preview.html');await began;
 const nextFeed=race.waitForResponse(r=>r.url().includes('/campaigns/feed/personal')&&r.request().headers().authorization==='Bearer stranger');
 await race.getByRole('button',{name:'Switch test account'}).click();await nextFeed;
 releaseOld();await pause(500);assert.equal(await race.locator('.service-offer-tile').count(),0);await race.close();
 checks.push('late previous-account response cannot restore another account’s offers');
 // Recheck the returning-visitor layout, including pause and reduced motion.
 await page.evaluate(()=>localStorage.setItem('repaido.customer.visits.v2',JSON.stringify({count:4})));await page.reload();
 await page.getByRole('button',{name:'Pause service cards',exact:true}).click();
 await page.locator('.repaido-services-grid-hydrated').waitFor();await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,487])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await settleAppearance(page);
  const problems=await page.evaluate(async()=>{const result=await axe.run('.repaido-services-grid-container',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}});return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});assert.deepEqual(problems,[]);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Play service cards',exact:true}).click();assert.equal(await page.locator('.repaido-service-motion-card').first().evaluate(e=>e.classList.contains('is-shining')),false);
 checks.push('returning-visitor grid: pause, reduced motion and enhanced contrast');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);if(page)await page.screenshot({path:work+'/failure.png',fullPage:true});console.error(log.slice(-1200));process.exitCode=1;}finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors,writes},null,2));await browser?.close();server.kill('SIGTERM');console.log('Evidence: '+work);}
