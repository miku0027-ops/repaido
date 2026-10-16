import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-profile-home-'));
const origin='http://127.0.0.1:5187',api='http://127.0.0.1:8075',checks=[],errors=[],writes=[];
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/professional-home-api.py',work+'/fixture.db','8075'],{stdio:['ignore','pipe','pipe']});
let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',data=>log+=data);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const authFixture=`const listeners=new Set();const user={uid:'customer',email:'customer@example.test',getIdToken:async()=> 'customer',getIdTokenResult:async()=>({claims:{}})};export const auth={currentUser:user,authStateReady:async()=>{},onAuthStateChanged(next){return this.onIdTokenChanged(next);},onIdTokenChanged(next){const callback=typeof next==='function'?next:next.next.bind(next);listeners.add(callback);queueMicrotask(()=>callback(user));return()=>listeners.delete(callback);}};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
async function variants(selector,name){
 for(const width of [320,467,1280])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const overflow=await page.locator(selector).evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,name+' overflow '+width+'/'+theme+'/'+scale);
  const issues=await page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),selector);
  assert.deepEqual(issues,[],name+' accessibility '+width+'/'+theme+'/'+scale);
  if(name==='professional-profile')assert.equal(await page.locator('.professional-profile-evidence-card').evaluateAll(cards=>cards.some(el=>el.scrollHeight>el.clientHeight+1)),false,'Evidence text remains inside its card at '+width+'/'+scale);
 }
 await page.setViewportSize({width:467,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});
 await page.screenshot({path:work+'/'+name+'.png',fullPage:true});checks.push(name+' responsive, light/dark, 200% text and enhanced text contrast');
}
async function openProfile(){await page.getByRole('button',{name:'View Fixture Electrical Professional’s profile',exact:true}).click();await page.locator('.professional-profile-actions').waitFor();return page.getByRole('dialog',{name:'Fixture Electrical Professional',exact:true});}
async function chooseHome(){const profile=await openProfile();await profile.locator('.professional-profile-more-actions>summary').click();await profile.getByRole('button',{name:'Hire maid',exact:true}).click();return page.getByRole('dialog',{name:'Repaido Home',exact:true});}
try{
 const deadline=Date.now()+60000;let ready=false;while(Date.now()<deadline){if(server.exitCode!==null)throw Error(log);try{if((await fetch(api+'/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await pause(100);}assert(ready,log);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:467,height:850},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/@vite/client'){
   // Keep development helpers while preventing unrelated fixture edits from reloading this journey.
   const response=await route.fetch(),body='class ProfilePreviewSocket{readyState=0;addEventListener(){};removeEventListener(){};send(){};close(){}}\n'+(await response.text()).replaceAll('new WebSocket(', 'new ProfilePreviewSocket(');
   return route.fulfill({response,contentType:'text/javascript',body});
  }
  if(url.pathname==='/src/firebase.ts')return route.fulfill({contentType:'text/javascript',body:authFixture});
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET')writes.push({path:url.pathname,body:request.postDataJSON()});
  try{const response=await route.fetch({url:api+url.pathname+url.search});return route.fulfill({response});}catch{return route.abort();}
 });
 page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/professional-home-preview.html');await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 await page.getByRole('button',{name:'View Fixture Electrical Professional’s profile',exact:true}).waitFor();
 const profile=await openProfile();await variants('.catalog-professional-dialog','professional-profile');
 await profile.locator('.professional-profile-primary').click();
 const selected=JSON.parse(await page.getByLabel('Last profile action').innerText());assert.equal(selected.kind,'service');assert.equal(selected.professional.id,'worker');
 await page.locator('.reference-detail-sheet').getByRole('button',{name:'Close dialog',exact:true}).click();checks.push('The catalogue profile opens its current published package with the same preferred professional');
 await openProfile();await page.emulateMedia({reducedMotion:'no-preference'});const evidence=page.locator('.professional-profile-evidence');await evidence.scrollIntoViewIfNeeded();
 await evidence.getByRole('button',{name:'Pause work and review cards',exact:true}).click();await profile.getByRole('button',{name:'Close dialog',exact:true}).focus();await page.mouse.move(0,0);const before=await evidence.locator('.professional-profile-evidence-rail').evaluate(el=>el.scrollLeft);await pause(7200);assert.equal(await evidence.locator('.professional-profile-evidence-rail').evaluate(el=>el.scrollLeft),before);await evidence.getByRole('button',{name:'Next work or review',exact:true}).click();await pause(350);assert(await evidence.locator('.professional-profile-evidence-rail').evaluate(el=>el.scrollLeft)>before);await page.emulateMedia({reducedMotion:'reduce'});await profile.getByRole('button',{name:'Close dialog',exact:true}).click();checks.push('Compact work cards support permanent pause, manual navigation and reduced motion');
 let home=await chooseHome();await home.getByText(/Preferred professional: Fixture Electrical Professional/).waitFor();
 await home.getByRole('button',{name:'All Home services',exact:true}).click();await variants('.home-hub-dialog','home-boutique');
 await home.locator('.home-offerings>button').filter({hasText:'Interior design'}).click();assert.equal(await home.getByText(/Preferred professional:/).count(),0);await home.getByRole('button',{name:'Close dialog',exact:true}).click();checks.push('Changing Home service clears an unrelated professional preference');
 home=await chooseHome();await variants('.home-hub-dialog','home-request');
 const fields=home.locator('.home-brief-fields');for(const select of await fields.locator('select').all()){const value=await select.locator('option:not([disabled])').first().getAttribute('value')||await select.locator('option:not([disabled])').first().innerText();await select.selectOption({label:value});}for(const input of await fields.locator('textarea').all())await input.fill('Agreed household task details for this local test.');
 const day=new Date(Date.now()+7*86400000).toISOString().slice(0,10);await home.getByLabel('First visit',{exact:true}).fill(day);await home.getByRole('button',{name:'Continue',exact:true}).click();
 await home.getByLabel('Person receiving the service',{exact:true}).fill('Fixture Recipient');await home.getByLabel('On-site contact number',{exact:true}).fill('9876543210');await home.getByLabel('House, street & landmark',{exact:true}).fill('Local fixture home near the central landmark');await home.getByLabel('Work needed & access instructions',{exact:true}).fill('Clean the agreed household surfaces with supplied materials.');await home.getByRole('button',{name:'Set service entrance pin',exact:true}).click();
 const map=page.getByRole('dialog',{name:'Confirm service location',exact:true});await map.getByRole('checkbox',{name:'I have checked that this pin marks my service entrance.',exact:true}).check();await map.getByRole('button',{name:'Confirm this location',exact:true}).click();await home.getByRole('button',{name:'Continue',exact:true}).click();
 await home.getByRole('checkbox',{name:/I am booking for myself/}).check();await home.getByRole('button',{name:'Request plan & quote',exact:true}).click();await page.getByLabel('Last profile action').filter({hasText:'plan-requested'}).waitFor();
 const plans=(await (await fetch(api+'/operations/home/plans',{headers:{Authorization:'Bearer customer'}})).json()).plans;assert.equal(plans.length,1);assert.equal(plans[0].preferred_worker_name,'Fixture Electrical Professional');checks.push('The real three-step Home request records the approved preferred professional with pin and consent');
 const beforeHire=writes.filter(row=>row.path==='/api/operations/hiring/requests').length;await openProfile();await profile.getByRole('button',{name:'Check day hire',exact:true}).click();await page.locator('.hire-professional-page').waitFor();assert.equal(writes.filter(row=>row.path==='/api/operations/hiring/requests').length,beforeHire);checks.push('Check day hire opens the selected professional and policy without submitting a booking');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){if(page)await page.screenshot({path:work+'/failure.png',fullPage:true}).catch(()=>{});console.error(error);process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/backend.log',log);await writeFile(work+'/report.json',JSON.stringify({checks,errors,writes},null,2));console.log('Evidence: '+work);}
