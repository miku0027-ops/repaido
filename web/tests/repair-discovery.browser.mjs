import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.DISCOVERY_ORIGIN||'http://127.0.0.1:5187';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const work=await mkdtemp('/tmp/repaido-repair-discovery-'),checks=[],errors=[],writes=[];
const reserve=createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));const port=reserve.address().port;await new Promise(done=>reserve.close(done));
const api='http://127.0.0.1:'+port,server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/repair_discovery_api.py',work+'/test.db',String(port)],{cwd:resolve(web,'../backend'),stdio:['ignore','pipe','pipe']});
let log='',browser,page,noWorkers=false,failSearch=false,lastResults;
for(const stream of [server.stdout,server.stderr])stream.on('data',value=>log+=value);
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const settle=page=>page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
async function variants(name){
 for(const width of [320,496,960])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});await settle(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} overflow ${width}/${theme}/${scale}`);
  const issues=await page.locator('.home-discovery-hub').evaluate(root=>Array.from(root.querySelectorAll('button,summary,select')).filter(e=>e.getClientRects().length).flatMap(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9?['Small target: '+e.textContent]:e.scrollWidth>e.clientWidth+1?['Clipped label: '+e.textContent]:[];}));
  assert.deepEqual(issues,[],`${name} targets ${width}/${theme}/${scale}`);
  const contrast=await page.evaluate(async()=>(await axe.run('.home-discovery-hub',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
  assert.deepEqual(contrast,[],`${name} accessibility ${width}/${theme}/${scale}`);
  if(width===496&&scale===100)await page.locator('.home-discovery-hub').screenshot({path:work+'/'+name+'-'+theme+'.png'});
 }
 await page.setViewportSize({width:496,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});
}
try{
 let ready=false;for(let i=0;i<300;i++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}assert(ready,'Disposable API starts');
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:496,height:850},reducedMotion:'reduce',timezoneId:'Asia/Kolkata'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.hostname!=='127.0.0.1')return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET')writes.push({path:url.pathname,body:request.postData()});
  if(failSearch&&url.pathname.endsWith('/discovery/search'))return route.fulfill({status:503,json:{detail:'Isolated connection failure'}});
  const response=await route.fetch({url:api+url.pathname+url.search});
  if(url.pathname.endsWith('/discovery/search')&&response.ok()){
   const data=await response.json();if(noWorkers)data.professionals=[];lastResults=data;
   return route.fulfill({response,json:data});
  }
  return route.fulfill({response});
 });
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.goto(origin+'/tests/modern-discovery-preview.html');await page.getByRole('button',{name:'Repairs',exact:true}).click();await page.locator('.quick-repair-results').waitFor();await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});};
 await open();await variants('professionals');checks.push('Live professional results: 320/496/960, light/dark, 100/200% text, full labels, 44px targets, enhanced contrast.');
 const search=page.getByRole('searchbox',{name:'Describe the work',exact:true});
 await search.fill('AC not cooling');await page.getByRole('button',{name:'Find help',exact:true}).click();await page.locator('.quick-professional-card').first().waitFor();
 await page.getByRole('button',{name:'Rides',exact:true}).click();await page.getByRole('button',{name:'Repairs',exact:true}).click();assert.equal(await search.inputValue(),'AC not cooling');
 await page.getByRole('button',{name:'Clear repair search',exact:true}).click();assert.equal(await search.inputValue(),'');await page.locator('.quick-professional-card').first().waitFor();assert.equal(await page.getByRole('button',{name:'Find help',exact:true}).isDisabled(),true);
 await page.locator('.quick-repair-filters summary').click();await page.getByRole('combobox',{name:'Professional type',exact:true}).selectOption('specialist');await page.locator('.quick-repair-results').waitFor();assert.equal(JSON.parse(writes.filter(w=>w.path.endsWith('/discovery/search')).at(-1).body).role,'specialist');
 checks.push('Search drafts survive mode switches; Clear resets to the selected category, empty searches are disabled, and progressive filters send the chosen professional type.');
 noWorkers=true;await open();assert(lastResults.services.length>2);assert.equal(await page.locator('.quick-repair-service').count(),2);await page.locator('.home-discovery-hub').screenshot({path:work+'/listed-services-compact.png'});
 const all=page.getByRole('button',{name:`View all ${lastResults.services.length} services`,exact:true});await all.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.quick-repair-service').count(),lastResults.services.length);
 await variants('listed-services');await page.emulateMedia({reducedMotion:'no-preference'});assert.notEqual(await page.locator('.quick-repair-results').evaluate(e=>getComputedStyle(e).animationName),'none');await settle(page);await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.quick-repair-results').evaluate(e=>getComputedStyle(e).animationName),'none');await page.getByRole('button',{name:'Show fewer services',exact:true}).click();assert.equal(await page.locator('.quick-repair-service').count(),2);
 const row=lastResults.services[0];await page.locator('.quick-repair-service').first().click();await page.getByRole('heading',{name:'Plan your visit',exact:true}).waitFor();assert((await page.locator('dialog').innerText()).includes(row.name));await page.keyboard.press('Escape');
 await page.getByRole('group',{name:'Repair category',exact:true}).getByRole('button',{name:'Plumbing',exact:true}).click();await page.locator('.quick-repair-results').waitFor();assert.equal(await search.inputValue(),'');
 failSearch=true;await search.fill('Repair connection check');await page.getByRole('button',{name:'Find help',exact:true}).click();await page.getByRole('alert').filter({hasText:'Check your connection'}).waitFor();failSearch=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.quick-repair-results').waitFor();
 await page.getByRole('button',{name:'Clear repair search',exact:true}).click();assert.equal(await page.getByRole('group',{name:'Repair category',exact:true}).getByRole('button',{name:'Plumbing',exact:true}).getAttribute('aria-pressed'),'true');
 checks.push('Empty-professional state keeps real catalogue prices/durations, View all reaches every service, reviewing a row opens that service, category changes reset expansion, and Retry recovers from a failed read.');
 noWorkers=false;await open();await search.fill('AC not cooling');await page.getByRole('button',{name:'Find help',exact:true}).click();const candidate=page.locator('.quick-professional-card').first();await candidate.waitFor();
 await candidate.locator('.quick-professional-service-choice summary').click();const choices=candidate.getByRole('combobox',{name:'Work to request',exact:true});
 const options=await choices.locator('option').evaluateAll(rows=>rows.filter(row=>row.value.startsWith('service:')).map(row=>({value:row.value,name:row.textContent.split(' · ')[0]})));assert(options.length>1);const selected=options[1];await choices.selectOption(selected.value);assert((await candidate.locator('.quick-professional-offering').innerText()).includes(selected.name));
 await candidate.getByRole('button',{name:/^Request /}).click();await page.getByRole('heading',{name:'Plan your visit',exact:true}).waitFor();
 const local=await page.evaluate(()=>{const date=new Date(Date.now()+4*3600000);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);});
 await page.getByLabel('Appointment date and time').fill(local);await page.getByLabel('House number, street and landmark').fill('Local fixture entrance 123');await page.getByText('Enter pin coordinates manually',{exact:true}).click();await page.getByLabel('Latitude',{exact:true}).fill('21.4934');await page.getByLabel('Longitude',{exact:true}).fill('86.9135');await page.getByLabel('Contact number',{exact:true}).fill('9876543210');await page.getByLabel('I confirm the location and included work.',{exact:false}).check();await page.getByRole('button',{name:/^Request visit/}).click();await page.getByRole('heading',{name:'Booking request received',exact:true}).waitFor();
 const submitted=JSON.parse(writes.find(row=>row.path==='/api/operations/bookings').body);assert.equal(submitted.service_id,selected.value.slice(8));assert.equal(submitted.preferred_worker_id,'worker');
 checks.push('A reviewed alternate service books through the real transactional API with its exact service ID and selected professional.');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){await page?.screenshot({path:work+'/failure.png',fullPage:true}).catch(()=>{});console.error(error);console.error(log.slice(-1200));process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));console.log('Evidence: '+work);}
