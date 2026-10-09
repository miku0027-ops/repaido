// Real registration form and API, using disposable SQLite and private photo stubs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-registration-'));
const api='http://127.0.0.1:8054',origin='http://127.0.0.1:5187',checks=[],writes=[],errors=[];
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/business_suites_api.py',work+'/test.db','8054'],{cwd:resolve(web,'../backend'),stdio:['ignore','pipe','pipe']});
let log='',browser;for(const stream of [server.stdout,server.stderr])stream.on('data',data=>log+=data);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function profile(uid,role){const response=await fetch(api+'/operations/local-business/partner?role='+role,{headers:{Authorization:'Bearer '+uid}});assert(response.ok);return (await response.json()).partner;}
try{
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:465,height:850},geolocation:{latitude:21.4934,longitude:86.9135,accuracy:10},permissions:['geolocation'],reducedMotion:'reduce'});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();const body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+body});});
 await context.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());if(!['GET','HEAD'].includes(request.method()))writes.push({path:url.pathname,body:request.postData()});const response=await route.fetch({url:api+url.pathname+url.search});await route.fulfill({response});});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 for(const [role,uid,title] of [['cab_owner','customer','Cab owner'],['driver','worker2','Driver'],['scrap_owner','shop','Scrap collector']]){
  await page.goto(origin+'/tests/business-suites-preview.html?mode='+role+'&uid='+uid);
  await page.getByRole('heading',{name:title+' registration',exact:true}).waitFor();
  const before=writes.length;
  await page.getByLabel('Legal / business name').fill('  Fixture '+title+' business  ');
  await page.getByRole('button',{name:/Business base & address/}).click();
  let map=page.getByRole('dialog',{name:'Your business base'});
  await map.getByRole('button',{name:'Use my current location',exact:true}).click();
  await map.getByText('GPS accuracy:',{exact:false}).waitFor();
  await map.getByRole('button',{name:'Confirm this location',exact:true}).click();
  await map.getByRole('alert').filter({hasText:'Add your house or building'}).waitFor();
  assert.equal(await map.getByLabel('House, street and landmark').getAttribute('aria-invalid'),'true');
  assert.equal(await map.getByLabel('City',{exact:true}).getAttribute('aria-invalid'),'true');
  assert(await map.getByLabel('House, street and landmark').evaluate(input=>document.activeElement===input));
  assert.equal(writes.length,before,'GPS without address must not upload or submit');
  for(const [address,city] of [['Main','B'],['          ','  ']]){
   await map.getByLabel('House, street and landmark').fill(address);await map.getByLabel('City',{exact:true}).fill(city);
   await map.getByRole('button',{name:'Confirm this location',exact:true}).click();
   assert.equal(await map.count(),1);assert.equal(writes.length,before);
  }
  await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
  for(const width of [320,465])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:850});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const issues=await page.evaluate(async()=>(await window.axe.run('dialog[open]',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}})).violations.map(issue=>({id:issue.id,nodes:issue.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));
   assert.deepEqual(issues,[],role+' address form accessibility '+width+' '+theme);
  }
  await page.setViewportSize({width:465,height:850});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  const address='Fixture '+title+' business base 123';
  await map.getByLabel('House, street and landmark').fill('  '+address+'  ');await map.getByLabel('City',{exact:true}).fill('  Balasore  ');
  await map.getByRole('button',{name:'Confirm this location',exact:true}).click();assert.equal(await map.count(),0);
  // Reopening must retain the entered address and GPS pin.
  await page.getByRole('button',{name:/Business base & address/}).click();map=page.getByRole('dialog',{name:'Your business base'});
  assert.equal(await map.getByLabel('House, street and landmark').inputValue(),address);assert.equal(await map.getByLabel('City',{exact:true}).inputValue(),'Balasore');
  assert.equal(Number(await map.getByLabel('Latitude',{exact:true}).inputValue()),21.4934);
  await map.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByText(address,{exact:false}).waitFor();
  assert.equal(writes.length,before,'Confirming and continuing must not upload or autosave');
  // Returning to Business must recheck a whitespace-only name before upload.
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByLabel('Legal / business name').fill('  ');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('alert').filter({hasText:'Enter your legal or business name'}).waitFor();assert.equal(writes.length,before);
  await page.getByLabel('Legal / business name').fill('  Fixture '+title+' business  ');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles(resolve(web,'public/images/icon-vehicle.png'));await page.getByLabel('I own or am authorized to operate this business',{exact:false}).check();
  await page.getByRole('button',{name:'Submit for review',exact:true}).click();await page.getByRole('heading',{name:'Application under review',exact:true}).waitFor();
  const saved=await profile(uid,role);assert.equal(saved.city,'Balasore');assert.equal(saved.address,address);assert.equal(saved.name,'Fixture '+title+' business');assert.equal(saved.status,'pending');
  assert.deepEqual(saved.location,{lat:21.4934,lng:86.9135});
  assert.equal(writes.slice(before).filter(write=>write.path.endsWith('/documents')).length,1);assert.equal(writes.slice(before).filter(write=>write.path.endsWith('/partner')).length,1);
  if(role==='driver')assert.equal((await profile(uid,'cab_owner')).status,'approved');
  if(role==='scrap_owner')assert.equal((await profile(uid,'driver')).status,'approved');
  checks.push(role+': GPS, missing/short/whitespace validation, focus and accessibility, retained address, no premature uploads, successful reviewed submission');
 }
 // Coordinate-only consumers retain their existing optional address behavior.
 await page.goto(origin+'/tests/business-suites-preview.html?mode=mobility&uid=customer');await page.getByRole('button',{name:/Cab with driver Your/}).click();
 const local=ms=>new Date(Date.now()+ms).toISOString().slice(0,16);
 await page.getByLabel('Pickup date & time').fill(local(86400000));await page.getByLabel('Expected trip end').fill(local(90000000));await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:/Pickup Choose on the map/}).click();const optional=page.locator('dialog[open]');await optional.getByLabel('I have checked that this pin marks my service entrance.').check();await optional.getByRole('button',{name:'Confirm this location',exact:true}).click();assert.equal(await optional.count(),0);checks.push('existing coordinate-only location selection remains available');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);console.error(log.slice(-1200));process.exitCode=1;}finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors,writes},null,2));await browser?.close();server.kill('SIGTERM');console.log('Evidence: '+work);}
