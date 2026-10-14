import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-elastic-'));
const api='http://127.0.0.1:8060',origin=process.env.ELASTIC_PREVIEW_ORIGIN||'http://127.0.0.1:5186',out=resolve(web,'test-results/elastic-home');
await mkdir(out,{recursive:true});
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/elastic_home_api.py',work+'/test.db','8060'],{cwd:resolve(web,'../backend'),stdio:['ignore','pipe','pipe']});
let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>log+=chunk);
const errors=[],requests=[],checks=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,body,uid='customer',method){const response=await fetch(api+path,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+uid,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();assert(response.ok,JSON.stringify(result));return result;}
async function navigate(){await page.goto(origin+'/tests/elastic-home-preview.html');await page.waitForFunction(()=>window.__elastic);await page.getByText('Your service suggestions',{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.hydration-controls[aria-busy=true]'));}
const family=name=>page.getByRole('group',{name:'Quick discovery type'}).getByRole('button',{name,exact:true});
const marketType=name=>page.getByRole('group',{name:'Marketplace service type'}).getByRole('button',{name,exact:true});
async function home(){await page.evaluate(()=>window.__elastic.newVisit());await page.locator('.home-elastic-discovery').waitFor();}
async function accessibility(name,selector='.home-elastic-discovery'){
 if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,471,768,1280]){
  await page.setViewportSize({width,height:850});await pause(60);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: ${width}px overflow`);
  const result=await page.evaluate(async selector=>{
   const report=await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}});
   return {contrast:[...report.passes,...report.violations,...report.incomplete].some(v=>v.id==='color-contrast-enhanced'),violations:report.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};
  },selector);
  assert(result.contrast,'AAA contrast check did not run');assert.deepEqual(result.violations,[],`${name}: ${width}px accessibility`);
 }
 for(const theme of ['light','dark']){
  await page.setViewportSize({width:471,height:850});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize='200%';},theme);await pause(60);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: 200% ${theme} overflow`);
  const violations=await page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),selector);
  assert.deepEqual(violations,[],`${name}: 200% ${theme} accessibility`);
 }
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';window.scrollTo(0,0);});await pause(70);
 assert(await page.locator(selector).evaluate(e=>getComputedStyle(e).fontFamily.includes('Poppins')));
 await page.screenshot({path:out+'/'+name+'.png',fullPage:true});checks.push(name+': responsive / 200% text / dark theme / Poppins / explicit AAA contrast');
}
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}assert(ready,'Isolated API did not become ready');
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:471,height:850},reducedMotion:'reduce'});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();const body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+body});});
 await context.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname,method:request.method(),body:request.postData()});try{const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
 page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));await navigate();

 // Deterministic public fallback moves the existing nodes; it never duplicates them.
 await page.waitForFunction(()=>document.querySelector('.home-elastic-discovery').dataset.leading==='services');
 await page.evaluate(()=>{window.__grid=document.querySelector('.repaido-services-grid-container');window.__hub=document.querySelector('.home-discovery-hub');window.__elastic.time('2026-10-14T10:00:00Z');});
 await page.waitForFunction(()=>document.querySelector('.home-elastic-discovery').dataset.leading==='discovery');
 assert(await page.evaluate(()=>window.__grid===document.querySelector('.repaido-services-grid-container')&&window.__hub===document.querySelector('.home-discovery-hub')));
 assert.equal(await page.locator('.repaido-services-grid-container').count(),1);assert.equal(await page.locator('.home-discovery-hub').count(),1);
 await page.getByRole('heading',{name:'Find a little more.',exact:true}).waitFor();
 checks.push('day/evening public fallback promotes both home modules while preserving their DOM identities');

 for(const [label,item] of [['Refurbished','Refurbished desk fan'],['Used','Elastic used phone'],['Rent','Elastic drill kit'],['Sell','Sell an item']]){
  await family('Market').click();await marketType(label).click();
  if(label==='Sell')await page.getByRole('button',{name:item,exact:true}).waitFor();else await page.locator('.market-discovery-item').filter({hasText:item}).waitFor();
  await accessibility('market-'+label.toLowerCase());
 }
 const catalogReads=requests.filter(r=>r.path==='/api/operations/products/catalog').length;
 await marketType('Refurbished').click();await page.locator('.market-discovery-item').filter({hasText:'Refurbished desk fan'}).waitFor();
 assert.equal(requests.filter(r=>r.path==='/api/operations/products/catalog').length,catalogReads,'Fresh marketplace results were refetched');
 checks.push('only the selected inventory source is loaded; returning within 30 seconds uses the existing snapshot');

 // Actual detail/editor flows, not merely callback spies.
 await page.locator('.market-discovery-item').filter({hasText:'Refurbished desk fan'}).click();await page.locator('.spare-product-modal').getByRole('heading',{name:'Refurbished desk fan',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.__elasticNavigation),{section:'refurbished',options:{productId:'elastic-refurb',condition:'refurbished'}});await home();await family('Market').click();await marketType('Used').click();
 await page.locator('.market-discovery-item').filter({hasText:'Elastic used phone'}).click();await page.locator('.market-detail-modal').getByRole('heading',{name:'Elastic used phone',exact:true}).waitFor();await home();await family('Market').click();await marketType('Rent').click();
 await page.locator('.market-discovery-item').filter({hasText:'Elastic drill kit'}).click();await page.locator('.task-product-modal').getByRole('heading',{name:'Elastic drill kit',exact:true}).waitFor();await home();await family('Market').click();await marketType('Sell').click();
 await page.getByRole('button',{name:'Sell an item',exact:true}).click();await page.locator('.market-form-modal').getByRole('heading',{name:'Sell Your Used Item on Repaido',exact:true}).waitFor();
 checks.push('all four marketplace journeys enter their real product, owner listing, rental review or listing editor');await home();

 await family('Repairs').click();await page.locator('.quick-professional-card').filter({hasText:'Asha repair agent'}).waitFor();await page.locator('.quick-professional-card').filter({hasText:'Ravi AC specialist'}).waitFor();
 assert.equal(await page.locator('.quick-professional-card').count(),2);await accessibility('repair-all');
 await page.getByRole('group',{name:'Professional type'}).getByRole('button',{name:'Specialists',exact:true}).click();await page.locator('.quick-professional-card').filter({hasText:'Ravi AC specialist'}).waitFor();assert.equal(await page.locator('.quick-professional-card').count(),1);await accessibility('repair-specialist');
 await page.getByRole('group',{name:'Professional type'}).getByRole('button',{name:'Agents',exact:true}).click();await page.locator('.quick-professional-card').filter({hasText:'Asha repair agent'}).waitFor();
 await page.getByRole('group',{name:'Professional type'}).getByRole('button',{name:'All',exact:true}).click();
 await page.getByRole('group',{name:'Repair category'}).getByRole('button',{name:'Plumbing',exact:true}).click();await page.locator('.quick-professional-card').filter({hasText:'Priya plumbing agent'}).waitFor();assert.equal(await page.locator('.quick-professional-card').count(),1);
 checks.push('category selections immediately query approved nearby professionals; agent/specialist filters remain category-specific');

 const query=page.getByRole('searchbox',{name:'Describe the work'});await query.fill('AC not cooling');const leading=await page.locator('.home-elastic-discovery').getAttribute('data-leading');
 await page.getByRole('button',{name:'Discovery settings',exact:true}).click();await page.getByRole('dialog',{name:'Discovery settings',exact:true}).waitFor();await accessibility('discovery-settings','.home-discovery-preferences');
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Discovery settings',exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Discovery settings',exact:true}).evaluate(e=>e===document.activeElement),true);assert.equal(await query.inputValue(),'AC not cooling');
 checks.push('the settings drawer is accessible, returns keyboard focus and preserves the current search draft');
 await page.evaluate(()=>window.__elastic.time('2026-10-14T14:00:00Z'));await pause(120);assert.equal(await page.locator('.home-elastic-discovery').getAttribute('data-leading'),leading);assert.equal(await query.inputValue(),'AC not cooling');
 await family('Market').click();await family('Repairs').click();assert.equal(await query.inputValue(),'AC not cooling');await page.getByRole('button',{name:'Find help',exact:true}).click();await page.locator('.quick-professional-card').filter({hasText:'Asha repair agent'}).waitFor();
 await page.locator('.quick-professional-card').filter({hasText:'Asha repair agent'}).getByRole('button',{name:'Request Asha',exact:true}).click();await page.getByRole('heading',{name:'Plan your visit',exact:true}).waitFor();await page.getByText('Requesting Asha repair agent. Your visit is confirmed when they accept.',{exact:true}).waitFor();
 const date=new Date(Date.now()+4*3600000),local=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);await page.getByLabel('Appointment date and time').fill(local);await page.getByLabel('House number, street and landmark').fill('Elastic private home entrance 123');await page.getByText('Enter pin coordinates manually',{exact:true}).click();await page.getByLabel('Latitude',{exact:true}).fill('21.4934');await page.getByLabel('Longitude',{exact:true}).fill('86.9135');await page.getByLabel('Contact number',{exact:true}).fill('9876543210');await page.getByLabel('I confirm the location and included work.',{exact:false}).check();await page.getByRole('button',{name:/^Request visit/}).click();await page.getByRole('heading',{name:'Booking request received',exact:true}).waitFor();
 const booking=requests.find(r=>r.path==='/api/operations/bookings');assert(booking);assert.equal(JSON.parse(booking.body).preferred_worker_id,'worker');
 checks.push('typing freezes layout; switching preserves the draft; the real booking stores the selected professional and returns a receipt');await home();

 // A delayed earlier category response must never overwrite the latest selection.
 await page.reload();await page.waitForFunction(()=>window.__elastic);await family('Repairs').click();await page.locator('.quick-professional-card').first().waitFor();
 await page.route('**/api/operations/discovery/search',async route=>{const body=route.request().postDataJSON();if(body.category!=='plumber'){await route.fallback();return;}const response=await route.fetch({url:api+'/operations/discovery/search'});await pause(650);await route.fulfill({response});});
 await page.getByRole('group',{name:'Repair category'}).getByRole('button',{name:'Plumbing',exact:true}).click();await page.getByRole('group',{name:'Repair category'}).getByRole('button',{name:'Electrical',exact:true}).click();await page.getByText('No professionals available here right now.',{exact:true}).waitFor();await pause(750);assert.equal(await page.locator('.quick-professional-card').count(),0);assert.equal(await page.getByRole('group',{name:'Repair category'}).getByRole('button',{name:'Electrical',exact:true}).getAttribute('aria-pressed'),'true');await page.unroute('**/api/operations/discovery/search');
 checks.push('a slower earlier category response cannot replace the newest repair selection');

 await page.getByText('Your service suggestions',{exact:true}).click();await page.getByRole('button',{name:'Enable personalised suggestions',exact:true}).click();await page.getByText('Personalisation is on. Suggestions adapt as you explore.',{exact:true}).waitFor();
 await family('Market').click();await marketType('Sell').click();for(let i=0;i<30;i++){if((await call('/operations/discovery/preferences')).categories.market_sell)break;await pause(80);}
 const prefs=await call('/operations/discovery/preferences');assert(prefs.market_enabled&&prefs.categories.market_sell);
 await home();await page.getByRole('button',{name:'Use suggested discovery',exact:true}).count().then(async n=>{if(n)await page.getByRole('button',{name:'Use suggested discovery',exact:true}).click();});
 await page.waitForFunction(()=>document.querySelector('.home-discovery-hub').dataset.focus==='marketplace');assert.equal(await marketType('Sell').getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>window.__elastic.account('stranger'));await page.waitForFunction(()=>document.querySelector('.home-elastic-discovery').dataset.basis==='rotation');assert.deepEqual((await call('/operations/discovery/preferences',undefined,'stranger')).categories,{});
 checks.push('expanded consent records bounded market category interests, hydrates the next visit, and never leaks across accounts');

 await family('Market').click();await marketType('Used').click();await page.evaluate(()=>window.__elastic.location(false));await page.getByRole('button',{name:'Choose an area',exact:true}).waitFor();assert.equal(await page.locator('.market-discovery-item').count(),0);
 await family('Repairs').click();await page.getByRole('button',{name:'Set service location',exact:true}).waitFor();assert.equal(await page.locator('.quick-professional-card').count(),0);
 await page.evaluate(()=>window.__elastic.location(true));await page.locator('.quick-professional-card').first().waitFor();
 const before=requests.length;await pause(1600);assert.equal(requests.slice(before).filter(r=>!['GET','HEAD'].includes(r.method)).length,0);assert.equal(await page.locator('.app-feedback-card').count(),0);
 checks.push('missing location clears old proximity results; idle discovery performs no writes or save popups');
 // Provider HTML and network exceptions never leak technical messages into the card.
 await page.reload();await page.waitForFunction(()=>window.__elastic);await family('Market').click();
 let malformed=true;await page.route('**/api/operations/products/catalog',async route=>{if(malformed){malformed=false;await route.fulfill({status:200,contentType:'text/html',body:'<html>internal traceback and private server path</html>'});}else await route.fallback();});
 await marketType('Refurbished').click();await page.getByText('These items could not load. Check your connection and try again.',{exact:true}).waitFor();assert(!await page.locator('.home-discovery-hub').innerText().then(text=>text.includes('traceback')));assert.equal(await marketType('Refurbished').getAttribute('aria-pressed'),'true');
 await page.locator('.marketplace-discovery').getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.market-discovery-item').filter({hasText:'Refurbished desk fan'}).waitFor();await page.unroute('**/api/operations/products/catalog');
 await page.route('**/api/operations/discovery/search',route=>route.abort('failed'));await family('Repairs').click();await page.getByText('Professional matches could not load. Check your connection and try again.',{exact:true}).waitFor();
 await page.unroute('**/api/operations/discovery/search');await page.locator('.quick-repair-finder').getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.quick-professional-card').filter({hasText:'Asha repair agent'}).waitFor();
 checks.push('malformed provider data and network errors show plain retry messages; retry restores real results without blocking switches');
 await page.emulateMedia({reducedMotion:'no-preference'});await family('Market').click();await marketType('Refurbished').click();assert.notEqual(await page.locator('.market-discovery-hero').evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.market-discovery-hero').evaluate(e=>getComputedStyle(e).animationName),'none');await page.locator('.home-discovery-switch button').first().focus();await page.keyboard.press('Tab');assert.equal(await family('Repairs').evaluate(e=>e===document.activeElement),true);
 checks.push('selection animations run for normal motion, stop for reduced motion, and keyboard focus follows the visible order');
 // The production clock changes an untouched page at a peak boundary, then holds an interaction.
 const clockPage=await context.newPage();clockPage.setDefaultTimeout(18000);clockPage.on('pageerror',error=>errors.push(error.message));
 await clockPage.clock.install({time:new Date('2026-10-14T01:29:00Z')});await clockPage.goto(origin+'/tests/elastic-home-preview.html');await clockPage.waitForFunction(()=>window.__elastic);await clockPage.evaluate(()=>window.__elastic.realTime());
 await clockPage.waitForFunction(()=>document.querySelector('.home-discovery-hub').dataset.focus==='marketplace');
 await clockPage.clock.fastForward(60000);await clockPage.waitForFunction(()=>document.querySelector('.home-elastic-discovery').dataset.basis==='peak'&&document.querySelector('.home-discovery-hub').dataset.focus==='transport');
 await clockPage.getByRole('group',{name:'Quick discovery type'}).getByRole('button',{name:'Repairs',exact:true}).click();await clockPage.getByRole('searchbox',{name:'Describe the work'}).fill('Keep my repair draft');const slot=await clockPage.locator('.home-elastic-discovery').getAttribute('data-slot');
 await clockPage.clock.fastForward(2*3600000);assert.equal(await clockPage.locator('.home-elastic-discovery').getAttribute('data-slot'),slot);assert.equal(await clockPage.getByRole('searchbox',{name:'Describe the work'}).inputValue(),'Keep my repair draft');await clockPage.close();
 checks.push('the real local clock advances an untouched home into peak discovery and stops reshuffling after interaction');
 const fullApp=await context.newPage();fullApp.setDefaultTimeout(18000);fullApp.on('pageerror',error=>errors.push(error.message));await fullApp.goto(origin+'/');await fullApp.getByRole('button',{name:'Discovery settings',exact:true}).click();
 await fullApp.waitForFunction(()=>document.querySelector('dialog.home-discovery-preferences')?.open);assert.equal(await fullApp.locator('.home-discovery-preferences').count(),1,'Duplicate settings and notification keys created duplicate drawers');
 await fullApp.keyboard.press('Escape');await fullApp.locator('.home-discovery-preferences').waitFor({state:'detached'});assert.equal(await fullApp.getByRole('button',{name:'Discovery settings',exact:true}).evaluate(e=>e===document.activeElement),true);await fullApp.close();
 checks.push('the complete App renders one settings drawer, dismisses it with Escape and restores focus alongside the notification panel');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,out},null,2));
}catch(error){console.error(error);if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.error(log.slice(-1800));process.exitCode=1;}
finally{await writeFile(out+'/report.json',JSON.stringify({checks,errors,requests},null,2));await browser?.close();server.kill('SIGTERM');console.log('Evidence: '+out);}
