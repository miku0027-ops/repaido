import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-ecosystem-lifecycles-'));
const port=Number(process.env.ECOSYSTEM_API_PORT||8087),vitePort=Number(process.env.ECOSYSTEM_VITE_PORT||5201);
const api=`http://127.0.0.1:${port}`,origin=process.env.ECOSYSTEM_TEST_ORIGIN||`http://127.0.0.1:${vitePort}`;
const checks=[],errors=[],requests=[],accessibility=[],layouts=[];
let backendLog='',viteLog='',browser,page,admin,contributor,seller;
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/ecosystem-lifecycles-api.py',work+'/fixture.db',String(port)],{stdio:['ignore','pipe','pipe']});
for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>backendLog+=chunk);
const vite=process.env.ECOSYSTEM_TEST_ORIGIN?null:spawn(process.execPath,[web+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(vitePort),'--strictPort'],{cwd:web,stdio:['ignore','pipe','pipe']});
if(vite)for(const stream of [vite.stdout,vite.stderr])stream.on('data',chunk=>viteLog+=chunk);
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const id=()=>crypto.randomUUID();
const localDate=at=>new Date(at).toISOString().slice(0,16);
const authFixture=`const uid=new URLSearchParams(location.search).get('uid')||'buyer';export const auth={currentUser:{uid,email:uid+'@example.test',getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})},authStateReady:async()=>{},onAuthStateChanged(next){return this.onIdTokenChanged(next);},onIdTokenChanged(next){const callback=typeof next==='function'?next:next.next.bind(next);queueMicrotask(()=>callback(auth.currentUser));return()=>{};}};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
async function ready(url,process,log){
 const end=Date.now()+60000;
 while(Date.now()<end){if(process?.exitCode!==null&&process?.exitCode!==undefined)throw Error(log());try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await pause(150);}
 throw Error('Local service failed readiness: '+url+' '+log().slice(-2000));
}
async function request(path,uid='buyer',body,method=body===undefined?'GET':'POST'){
 const response=await fetch(api+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+uid},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json()};
}
async function ok(path,uid='buyer',body,method){const result=await request(path,uid,body,method);assert.equal(result.status,200,JSON.stringify(result));return result.body;}
async function state(){return (await fetch(api+'/__fixture/state')).json();}
async function open(context,uid,mode,chat){const tab=await context.newPage();tab.setDefaultTimeout(18000);tab.on('pageerror',error=>errors.push(error.message));await tab.goto(origin+'/tests/ecosystem-lifecycles-preview.html?'+new URLSearchParams({uid,mode,...chat?{chat}:{}}));return tab;}
async function audit(tab,selector,label){
 await tab.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,467,1280]){
  await tab.setViewportSize({width,height:900});
  assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+' page overflow at '+width);
  const region=await tab.locator(selector).evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth}));
  layouts.push({label,width,...region});assert(region.scroll<=region.client+1,label+' region overflow at '+width);
  await tab.screenshot({path:work+'/'+label+'-'+width+'.png',fullPage:true});
 }
 const violations=await tab.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),selector);
 accessibility.push({label,violations});assert.deepEqual(violations,[],label+' WCAG A/AA');
 await tab.setViewportSize({width:467,height:900});
}
try{
 await Promise.all([ready(api+'/health',server,()=>backendLog),ready(origin,vite,()=>viteLog)]);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:467,height:900},reducedMotion:'reduce',timezoneId:'UTC'});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==origin)return route.abort();
  if(url.pathname==='/@vite/client'){
   const response=await route.fetch(),body='class LifecyclePreviewSocket{readyState=0;addEventListener(){};removeEventListener(){};send(){};close(){}}\n'+(await response.text()).replaceAll('new WebSocket(', 'new LifecyclePreviewSocket(');
   return route.fulfill({response,contentType:'text/javascript',body});
  }
  if(url.pathname==='/src/firebase.ts')return route.fulfill({contentType:'text/javascript',body:authFixture});
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let body;try{body=req.postDataJSON();}catch{}
  requests.push({method:req.method(),path:url.pathname,actor:req.headers().authorization,body});
  try{const response=await route.fetch({url:api+url.pathname+url.search});return route.fulfill({response});}catch{return route.abort();}
 });

 // Produce the accepted offer through the actual inbox, persisting each action.
 const chat=(await ok('/operations/market/chats','buyer',{listing_id:'lifecycle-listing',request_id:id(),body:'Can we inspect this camera together?'})).chat.id;
 page=await open(context,'buyer','market',chat);
 const dialog=page.getByRole('dialog',{name:'Market messages',exact:true});
 await dialog.getByRole('button',{name:'Make an offer',exact:true}).click();
 await dialog.getByLabel('Offer amount (₹)',{exact:true}).fill('900');
 await dialog.getByLabel('Your market message',{exact:true}).fill('I can offer nine hundred after inspecting the camera.');
 await dialog.getByRole('button',{name:'Send market message',exact:true}).click();
 await dialog.getByText('I can offer nine hundred after inspecting the camera.',{exact:true}).waitFor();
 seller=await open(context,'seller','market',chat);
 await seller.getByRole('button',{name:'Accept proposal',exact:true}).click();
 await seller.getByText('Proposal accepted',{exact:true}).waitFor();
 await page.reload();await dialog.getByText('Proposal accepted',{exact:true}).waitFor();
 await dialog.locator('.market-transaction>summary').click();
 await dialog.getByLabel('Public meeting place',{exact:true}).fill('Public library entrance near the security desk');
 await dialog.getByLabel('Meeting date and time',{exact:true}).fill(localDate(Date.now()+3600000));
 await dialog.getByLabel('Inspection and handover notes',{exact:true}).fill('Check the lens, shutter, charger and included accessories.');
 await dialog.getByRole('button',{name:'Propose meeting',exact:true}).click();
 await dialog.getByText('Meeting proposed',{exact:true}).waitFor();
 await seller.reload();await seller.locator('.market-transaction>summary').click();
 await seller.getByRole('button',{name:'Agree to this meeting',exact:true}).click();
 await seller.getByText('Meeting agreed',{exact:true}).waitFor();
 await seller.getByRole('checkbox',{name:/I inspected and exchanged/}).check();
 await seller.getByRole('button',{name:'Confirm actual handover',exact:true}).click();
 await seller.getByRole('alert').filter({hasText:'Confirm handover only after'}).waitFor();
 assert.equal((await state()).listing.status,'published');
 checks.push('Real inbox offer and seller acceptance persist; meeting requires both agreements and blocks early completion with visible feedback');
 await audit(seller,'.market-transaction','market-agreed');
 assert.equal((await fetch(api+'/__fixture/meeting-elapsed/'+chat,{method:'POST'})).status,200);
 await page.reload();await dialog.locator('.market-transaction>summary').click();
 await dialog.getByRole('checkbox',{name:/I inspected and exchanged/}).check();
 await dialog.getByRole('button',{name:'Confirm actual handover',exact:true}).click();
 await dialog.getByText('Waiting for both confirmations',{exact:true}).waitFor();
 assert.equal((await state()).listing.status,'published');
 await seller.reload();await seller.locator('.market-transaction>summary').click();
 await seller.getByRole('checkbox',{name:/I inspected and exchanged/}).check();
 await seller.getByRole('button',{name:'Confirm actual handover',exact:true}).click();
 await seller.getByText('Handover completed',{exact:true}).waitFor();
 assert.equal((await state()).listing.status,'closed');
 await page.reload();await dialog.locator('.market-transaction>summary').click();
 await dialog.getByLabel('Transaction review',{exact:true}).fill('The camera matched the agreed condition and the public handover went smoothly.');
 await dialog.getByRole('button',{name:'Save review',exact:true}).click();
 await dialog.getByText('Your review · 5/5',{exact:true}).waitFor();
 await seller.reload();await seller.locator('.market-transaction>summary').click();
 await seller.getByText('Other participant · 5/5',{exact:true}).waitFor();
 assert.equal((await request('/operations/market/chats/'+chat+'/transaction','outsider')).status,404);
 const saved=await state();assert.equal(saved.transactions.length,1);assert.equal(saved.transactions[0].state,'completed');assert.equal(saved.payments.length,0);
 checks.push('Two actual handover confirmations close one listing; one private participant review persists; outsider access fails and no payment records are created');
 await audit(page,'.market-transaction','market-completed');

 // Create a real mission through its operator form, then contribute through Captain.
 admin=await open(context,'admin','admin');
 await admin.getByRole('button',{name:'Create mission',exact:true}).click();
 await admin.getByLabel('Title',{exact:true}).fill('Neighbourhood repair knowledge workshop');
 await admin.getByLabel('City',{exact:true}).fill('Balasore');
 await admin.getByLabel('Real mission scope and safety limits',{exact:true}).fill('Document a safe manufacturer-approved maintenance task. Isolate power before cleaning removable parts and refer electrical faults to a qualified professional.');
 await admin.getByLabel('Required completion evidence',{exact:true}).fill('Provide your own original photo and explain the checks, safe process and verified result.');
 await admin.getByLabel('Opens',{exact:true}).fill(localDate(Date.now()-120000));
 await admin.getByLabel('Submission deadline',{exact:true}).fill(localDate(Date.now()+86400000));
 await admin.getByRole('checkbox',{name:'Publish this mission during its scheduled dates',exact:true}).check();
 await admin.getByRole('button',{name:'Save mission',exact:true}).click();
 await admin.getByRole('button',{name:'Edit mission',exact:true}).waitFor();
 const board=await ok('/operations/local-business/missions','contributor');assert.equal(board.missions.length,1);
 contributor=await open(context,'contributor','captain');
 await contributor.getByRole('button',{name:'Missions',exact:true}).click();
 await contributor.getByRole('button',{name:'Join this mission',exact:true}).click();
 await contributor.getByLabel('What you completed',{exact:true}).waitFor();
 assert.equal((await state()).awards.length,0);
 await contributor.getByLabel('What you completed',{exact:true}).fill('I isolated the appliance, removed and cleaned the reusable filter, checked its condition, and recorded the result in my original evidence photo.');
 const knowledge='Always isolate the appliance and follow its manufacturer instructions before removing washable filters. I cleaned the removable filter, checked for visible damage and let it dry completely. Electrical faults and damaged cables require a qualified professional.';
 await contributor.getByLabel('Your original repair knowledge',{exact:true}).fill(knowledge);
 await contributor.getByRole('checkbox',{name:/Publish this knowledge text after review/}).check();
 const photo=await contributor.screenshot();
 await contributor.getByLabel('Fresh evidence photos',{exact:false}).setInputFiles({name:'original-maintenance-evidence.png',mimeType:'image/png',buffer:photo});
 await contributor.getByRole('button',{name:'Submit for independent review',exact:true}).click();
 await contributor.locator('.community-mission>header').getByText('submitted',{exact:true}).waitFor();
 const submitted=await state();assert.equal(submitted.contributions.length,1);assert.equal(submitted.awards.length,0);
 const contribution=submitted.contributions[0],document=submitted.documents[0];assert.equal(document.owner_id,'contributor');assert(document.sha256);
 assert.equal((await request('/operations/local-business/documents/'+document.id,'outsider')).status,404);
 assert.equal((await request('/operations/local-business/missions/admin/contributions/'+contribution.id+'/review','contributor',{request_id:id(),expected_version:contribution.version,decision:'verified',note:'A contributor cannot independently verify their own evidence.',evidence_reference:'not-an-operator'})).status,403);
 checks.push('Operator publishes mission; contributor joins, uploads a real owned photo and submits; no points before review and outsiders cannot view evidence');
 await audit(contributor,'.community-missions','mission-submitted');
 await admin.getByRole('button',{name:'Refresh',exact:true}).click();
 await admin.getByAltText('Private contribution evidence',{exact:true}).evaluate(image=>image.decode());
 await admin.getByLabel('Review reason',{exact:true}).fill('Independently inspected the original evidence photo, the frozen mission requirements and the recorded safe maintenance result.');
 await admin.getByLabel('Evidence check reference',{exact:true}).fill('local-independent-review-001');
 await admin.getByRole('button',{name:'Save independent review',exact:true}).click();
 await admin.getByText('No contributions in this queue.',{exact:true}).waitFor();
 const verified=await state();assert.equal(verified.contributions[0].state,'verified');assert.equal(verified.awards.length,1);assert.equal(verified.awards[0].points,10);assert.equal(verified.awards[0].source,'repair_knowledge');
 await contributor.getByRole('button',{name:'Refresh missions',exact:true}).click();
 await contributor.getByText('10 Captain points earned.',{exact:false}).waitFor();
 const knowledgePage=await ok('/operations/local-business/missions/'+board.missions[0].id+'/knowledge','outsider');assert.equal(knowledgePage.contributions[0].text,knowledge);assert(!('document_ids' in knowledgePage.contributions[0]));
 await contributor.getByRole('button',{name:'My impact',exact:true}).click();
 await contributor.getByRole('button',{name:'Refresh points and rewards',exact:true}).click();
 await contributor.locator('.captain-score>strong').filter({hasText:/^10$/}).waitFor();
 await contributor.getByText('Your points history',{exact:true}).click();
 await contributor.locator('.captain-award').getByText('+10 points',{exact:true}).waitFor();
 await contributor.locator('.captain-award').getByText('Repair knowledge',{exact:false}).waitFor();
 checks.push('Independent evidence review writes exactly one 10-point Captain award; opted-in knowledge is published without photos and existing points history reflects the award');
 await audit(contributor,'.captain-club','captain-award');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks,work},null,2));
}catch(error){
 console.error(error);console.error(backendLog.slice(-1500));
 for(const [name,tab] of Object.entries({buyer:page,seller,admin,contributor}))if(tab){await tab.screenshot({path:work+'/failure-'+name+'.png',fullPage:true}).catch(()=>{});console.error(name+': '+(await tab.locator('body').innerText().catch(()=>'' )).slice(-3500));}
 process.exitCode=1;
}finally{
 await writeFile(work+'/report.json',JSON.stringify({checks,errors,accessibility,layouts,requests},null,2));
 await writeFile(work+'/backend.log',backendLog);await writeFile(work+'/vite.log',viteLog);
 await browser?.close();server.kill('SIGTERM');vite?.kill('SIGTERM');console.log('Evidence: '+work);
}
