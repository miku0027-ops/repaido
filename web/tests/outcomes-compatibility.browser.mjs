import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:5192',out='/tmp/repaido-outcomes-compatibility-browser';await mkdir(out,{recursive:true});
const authFixture=`const listeners=new Set();const user=uid=>uid?{uid,getIdToken:async()=>uid}:null;export const auth={currentUser:user('operator-a'),authStateReady:async()=>{},onIdTokenChanged(next){const fn=typeof next==='function'?next:next.next.bind(next);listeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>listeners.delete(fn);}};window.__outcomesSwitchAccount=uid=>{auth.currentUser=user(uid);listeners.forEach(fn=>fn(auth.currentUser));};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
const scope='This page covers up to 25 campaign reservations. Repeat customers are counted within this page only. Refunds and support cases are limited to 20 per booking.';
const financialNote='Captured amounts cover final-balance payments only, excluding separate parts advances; processed refunds cover service/final payments only. Settled company allocation excludes refunded or held bookings and is not net profit. Offer reservations are not sales; results do not prove that a recommendation caused a purchase.';
const compatibilityScope='Up to 100 catalogue entries in this category. Supplier declarations are not independently tested.';
const compatibilityMatch='Supplier text matches your search; confirm the exact model with the shop.';
function report(id,cursor,actor){
 const page=cursor?2:1,different=id==='campaign-b'||actor==='Bearer operator-b';
 return {campaign:{title:id,budget_paise:10000000,reserved_paise:250000,impressions:999999,opens:888888},totals:{bookings:different?7:page===1?3:1,completed:different?4:page===1?2:0,verified_payments:2,confirmed_refunds:1,complaint_cases:2,open_complaints:1,repeat_customers_in_page:1,captured_paise:123456,processed_refund_paise:2345,settled_company_allocation_paise:12000,inferred_profit_paise:77777777},items:[{id:(different?'B':'A').repeat(64)+(page===1?'1':'2'),state:'completed',payment_status:'captured',confirmed_refund_paise:2345,complaints:2,discount_paise:1000}],next_cursor:page===1?'next-page-token':null,related_records_truncated:page===1,scope,financial_note:financialNote};
}
const requests=[],checks=[],failures=[],errors=[];let campaignFailures=0,compatibilityFailures=0,holdCampaign=null,holdCompatibility=null;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:467,height:900},reducedMotion:'reduce'});
 await context.addInitScript(()=>{window.__activityOpened=[];window.addEventListener('repaido:activity-open',event=>window.__activityOpened.push(event.detail));});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/src/firebase.ts')return route.fulfill({contentType:'text/javascript',body:authFixture});
  if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,query:url.search,method:req.method(),headers:req.headers()});
  if(url.pathname.includes('/outcomes')){
   const id=url.pathname.split('/')[5],cursor=url.searchParams.get('cursor')||'',actor=req.headers().authorization,data=report(id,cursor,actor);
   if(campaignFailures>0){campaignFailures--;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'Campaign report temporarily unavailable. Please retry.'}})});}
   const hold=holdCampaign;if(hold&&hold.match({id,cursor,actor}))await hold.wait.promise;
   try{return await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});}catch{return;}
  }
  if(url.pathname.endsWith('/compatibility')){
   const model=url.searchParams.get('model'),category=url.searchParams.get('category');
   if(compatibilityFailures>0){compatibilityFailures--;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'Supplier declarations are temporarily unavailable. Please retry.'}})});}
   const hold=holdCompatibility;if(hold&&hold.match({model,category}))await hold.wait.promise;
   const data={verified_compatibility:false,scope:compatibilityScope,items:model==='NO-MATCH'?[]:[{id:category==='AC'?'part-ac':'part-washer',title:`Declared ${category} part for ${model}`,compatibility:`Supplier declaration for ${model}. Ask the shop to confirm the exact model and connector before buying.`,match:compatibilityMatch}]};
   try{return await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});}catch{return;}
  }
  return route.fulfill({contentType:'application/json',body:'{}'});
 });
 const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
 async function check(name,run){try{await run();checks.push(name);}catch(error){failures.push({name,error:error.message});}}
 async function campaign(){holdCampaign?.wait.resolve();holdCampaign=null;campaignFailures=0;await page.goto(origin+'/tests/outcomes-compatibility-preview.html');await page.getByRole('button',{name:'Load outcomes',exact:true}).waitFor();}
 async function compatibility(){holdCompatibility?.wait.resolve();holdCompatibility=null;compatibilityFailures=0;await page.goto(origin+'/tests/outcomes-compatibility-preview.html?mode=compatibility');await page.locator('summary').filter({hasText:'Find parts for your model'}).click();}
 async function accessibility(selector){await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const violations=await page.evaluate(async selector=>{const result=await window.axe.run(document.querySelector(selector),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(x=>({id:x.id,nodes:x.nodes.map(node=>node.target)}));},selector);assert.deepEqual(violations,[]);}
 const countOutcomes=()=>requests.filter(r=>r.path.includes('/outcomes')).length;
 const modelInput=()=>page.getByLabel('Appliance model or part number',{exact:true});
 const searchButton=()=>page.getByRole('button',{name:'Check supplier declarations',exact:true});
 const metric=label=>page.locator('dl>div').filter({has:page.locator('dt',{hasText:label})}).locator('dd');
 await check('Campaign reports make authenticated reads, retry failures and show only canonical financial metrics',async()=>{
  await campaign();campaignFailures=1;await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await page.getByRole('alert').filter({hasText:'Campaign report temporarily unavailable.'}).waitFor();await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await page.getByText(scope,{exact:true}).waitFor();
  assert.deepEqual(await page.locator('dl dt').allTextContents(),['Bookings','Completed','Verified final payments','Processed service refunds','Complaint cases','Open complaints','Repeat customers in this page']);assert.equal(await metric('Bookings').textContent(),'3');assert.equal(await metric('Completed').textContent(),'2');
  const text=await page.locator('.ops-card').innerText();assert(text.includes(financialNote));assert(text.includes('₹1,234.56'));assert(text.includes('₹23.45'));assert(text.includes('₹120'));assert(!text.includes('999999')&&!text.includes('888888')&&!text.includes('77777777'));await page.getByRole('status').filter({hasText:'Some bookings exceed'}).waitFor();
  const request=requests.filter(r=>r.path.includes('/outcomes')).at(-1);assert.equal(request.headers.authorization,'Bearer operator-a');assert.equal(request.method,'GET');
 });
 await check('Campaign report and long booking references fit 320px, 467px and 1280px with WCAG A/AA checks',async()=>{
  await page.locator('summary').filter({hasText:'Booking references'}).click();
  for(const width of [320,467,1280]){await page.setViewportSize({width,height:900});await page.screenshot({path:`${out}/campaign-${width}.png`,fullPage:true});const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,text:e.textContent?.slice(0,90),right:e.getBoundingClientRect().right})).slice(0,8)}));assert(overflow.scroll<=width+1,JSON.stringify(overflow));}
  await accessibility('.ops-card');
 });
 await check('Campaign pagination is serialized, uses the returned cursor and replaces page totals',async()=>{
  await campaign();await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await page.getByText(scope,{exact:true}).waitFor();const before=countOutcomes();
  await page.getByRole('button',{name:'Next 25 reservations',exact:true}).evaluate(button=>{button.click();button.click();});await page.getByRole('button',{name:'Next 25 reservations',exact:true}).waitFor({state:'hidden'});assert.equal(countOutcomes(),before+1);assert.equal(new URLSearchParams(requests.filter(r=>r.path.includes('/outcomes')).at(-1).query).get('cursor'),'next-page-token');assert.equal(await metric('Bookings').textContent(),'1');
 });
 await check('Changing a campaign clears prior data and ignores an older campaign response',async()=>{
  await campaign();const wait=deferred();holdCampaign={wait,match:({id})=>id==='campaign-a'};
  const sent=page.waitForRequest(r=>r.url().includes('/campaign-a/outcomes'));await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await sent;
  await page.getByLabel('Campaign fixture',{exact:true}).selectOption('campaign-b');assert.equal(await page.locator('dl').count(),0);await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await metric('Bookings').filter({hasText:'7'}).waitFor();wait.resolve();holdCampaign=null;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await metric('Bookings').textContent(),'7');
 });
 await check('Account switches clear private campaign results and prevent a late response restoring them',async()=>{
  await campaign();await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await page.getByText(scope,{exact:true}).waitFor();await page.evaluate(()=>window.__outcomesSwitchAccount('operator-b'));assert.equal(await page.locator('dl').count(),0);
  const wait=deferred();holdCampaign={wait,match:({actor})=>actor==='Bearer operator-b'};const sent=page.waitForRequest(r=>r.url().includes('/outcomes')&&r.headers().authorization==='Bearer operator-b');await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await sent;
  await page.evaluate(()=>window.__outcomesSwitchAccount('operator-a'));wait.resolve();holdCampaign=null;await page.getByRole('button',{name:'Load outcomes',exact:true}).waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('dl').count(),0);await page.getByRole('button',{name:'Load outcomes',exact:true}).click();await metric('Bookings').filter({hasText:'3'}).waitFor();
 });
 await check('Compatibility performs public reads, retries failures, states supplier uncertainty and opens native item details',async()=>{
  await compatibility();compatibilityFailures=1;await modelInput().fill('ZX 42/A');await searchButton().click();await page.getByRole('alert').filter({hasText:'Supplier declarations are temporarily unavailable.'}).waitFor();await searchButton().click();await page.getByText('Declared AC part for ZX 42/A',{exact:true}).waitFor();await page.getByText(compatibilityScope,{exact:true}).waitFor();await page.getByText(compatibilityMatch,{exact:true}).waitFor();const request=requests.filter(r=>r.path.endsWith('/compatibility')).at(-1);assert.equal(request.method,'GET');assert.equal(request.headers.authorization,undefined);assert.equal(new URLSearchParams(request.query).get('model'),'ZX 42/A');assert.equal(new URLSearchParams(request.query).get('category'),'AC');await page.getByRole('button',{name:'View item',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__activityOpened.at(-1)),{kind:'product',id:'part-ac'});
 });
 await check('Supplier compatibility results and controls fit 320px, 467px and 1280px with WCAG A/AA checks',async()=>{
  for(const width of [320,467,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${out}/compatibility-${width}.png`,fullPage:true});}
  await accessibility('.home-thread');
 });
 await check('Editing a model clears stale matches and an older search cannot replace the newer result',async()=>{
  await compatibility();await modelInput().fill('FIRST-MODEL');await searchButton().click();await page.getByText('Declared AC part for FIRST-MODEL',{exact:true}).waitFor();await modelInput().fill('OLD-MODEL');assert.equal(await page.getByText('Declared AC part for FIRST-MODEL',{exact:true}).count(),0);
  const wait=deferred();holdCompatibility={wait,match:({model})=>model==='OLD-MODEL'};const sent=page.waitForRequest(r=>r.url().includes('model=OLD-MODEL'));await searchButton().click();await sent;await modelInput().fill('NEW-MODEL');await searchButton().click();await page.getByText('Declared AC part for NEW-MODEL',{exact:true}).waitFor();wait.resolve();holdCompatibility=null;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.getByText('Declared AC part for OLD-MODEL',{exact:true}).count(),0);assert.equal(await page.getByRole('alert').count(),0);
 });
 await check('Changing category cancels stale compatibility searches and empty matches remain explicitly unconfirmed',async()=>{
  await compatibility();await modelInput().fill('SAME-MODEL');const wait=deferred();holdCompatibility={wait,match:({category})=>category==='AC'};const sent=page.waitForRequest(r=>r.url().includes('category=AC'));await searchButton().click();await sent;
  await page.getByLabel('Category fixture',{exact:true}).selectOption('Washing Machine');await searchButton().click();await page.getByText('Declared Washing Machine part for SAME-MODEL',{exact:true}).waitFor();wait.resolve();holdCompatibility=null;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.getByText('Declared AC part for SAME-MODEL',{exact:true}).count(),0);
  await modelInput().fill('NO-MATCH');await searchButton().click();await page.getByText('No declared match. Ask the shop before buying.',{exact:true}).waitFor();await page.getByText(compatibilityScope,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'View item',exact:true}).count(),0);
 });
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({checks,failures,errors,network:'Browser requests use fixtures; backend domain tests are maintained separately.'},null,2));console.log(JSON.stringify({out,checks,failures,errors}));assert.deepEqual(failures,[]);
}finally{await browser.close();}
