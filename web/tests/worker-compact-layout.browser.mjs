import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=process.env.REPAIDO_LAYOUT_ARTIFACTS||'/workspace/artifacts/worker-compact-layout';await mkdir(out,{recursive:true});
const origin=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187',port=8078;
const server=spawn(web+'/../backend/.venv/bin/python',[web+'/tests/business_suites_api.py',out+'/fixture-'+Date.now()+'.db',String(port)],{cwd:web+'/../backend',stdio:['ignore','pipe','pipe']});
let log='',browser,page,invitation=null;const errors=[],writes=[],metrics=[];for(const stream of [server.stdout,server.stderr])stream.on('data',data=>log+=data);
try{
 for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok)break;}catch{}if(i===150||server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:572,height:850},reducedMotion:'reduce'});
 await context.addInitScript(()=>{window.copiedAccount='';window.denyCopy=false;Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.denyCopy)throw Error('Fixture copy unavailable');window.copiedAccount=value;}}});});
 await context.route('https://**/*',route=>route.abort('blockedbyclient'));
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(')});});
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.endsWith('/driver-invitations'))return route.fulfill({json:{invitations:invitation?[invitation]:[]}});
  if(url.pathname.includes('/driver-invitations/')){const body=request.postDataJSON();writes.push({path:url.pathname,body});assert.equal(body.accept,true);invitation={...invitation,state:'accepted'};return route.fulfill({json:invitation});}
  assert(['GET','HEAD'].includes(request.method()),'layout checks must not mutate the fixture backend');
  const response=await route.fetch({url:`http://127.0.0.1:${port}`+url.pathname+url.search});await route.fulfill({response});
 });
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const open=async(role='driver',tab='vehicles')=>{await page.goto(origin+`/tests/business-suites-preview.html?mode=${role}&uid=worker&portal=1&tab=${tab}`);await page.locator('.worker-suite-identity').waitFor();await page.locator(`.suite-workspace[data-panel="${tab}"]`).waitFor();};
 await open();await page.getByText('No vehicle invitations yet.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Vehicle assignments',exact:true}).count(),1);
 assert.equal(await page.getByRole('textbox',{name:'Driver account ID'}).isVisible(),false,'account ID and setup text start collapsed');
 await page.locator('.driver-assignment-help>summary').click();await page.getByRole('button',{name:'Copy ID',exact:true}).click();assert.equal(await page.evaluate(()=>window.copiedAccount),'worker');
 await page.getByText('Account ID copied.',{exact:true}).waitFor();
 await page.evaluate(()=>window.denyCopy=true);await page.getByRole('button',{name:'Copied',exact:true}).click();await page.getByText('Select and copy your account ID below.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Driver account ID'}).inputValue(),'worker');await page.locator('.driver-assignment-help>summary').click();
 await page.getByRole('button',{name:'Business apps',exact:true}).click();await page.getByRole('dialog',{name:'Your business apps',exact:true}).waitFor();await page.keyboard.press('Escape');
 for(const role of ['driver','cab_owner','scrap_owner']){
  await open(role,role==='driver'?'vehicles':'overview');
  for(const width of [320,390,572,703,1440])for(const scale of [100,200]){
   await page.setViewportSize({width,height:850});await page.evaluate(scale=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=scale===200?'dark':'light';},scale);
   const m=await page.evaluate(()=>{const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};return{header:box('.ops-heading'),logo:box('.ops-heading>.repaido-brand-container'),actions:box('.worker-header-actions'),overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:Array.from(document.querySelectorAll('.worker-app-link')).map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,label:b.getAttribute('aria-label')}))};});
   assert.equal(m.overflow,false,`${role} overflow ${width}/${scale}`);assert(m.actions.y<m.logo.bottom&&m.actions.bottom>m.logo.y,`app shortcuts share the logo row ${role} ${width}/${scale}`);assert(m.buttons.every(b=>b.width>=44&&b.height>=44),'shortcuts preserve touch targets');
   if(role==='driver'&&width===572&&scale===100){assert(m.header.height<100,'572px header should save the old shortcut row');await page.screenshot({path:out+'/driver-vehicles-572.png'});}
   if(role==='driver'&&width===320&&scale===100)await page.screenshot({path:out+'/driver-vehicles-320.png'});
   metrics.push({role,width,scale,...m});
  }
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});await page.setViewportSize({width:572,height:850});await open('driver','journeys');
 const rail=page.getByRole('navigation',{name:'Booking types',exact:true});assert.equal(await rail.getByRole('button').count(),2);assert.equal(await rail.getByRole('button',{name:'Bike rides',exact:true}).count(),0);await rail.getByRole('button',{name:'Shared journeys',exact:true}).click();await page.locator('.suite-driver[data-panel="shared"]').waitFor();await rail.getByRole('button',{name:'Cab journeys',exact:true}).click();await page.locator('.suite-driver[data-panel="journeys"]').waitFor();
 await page.screenshot({path:out+'/driver-journeys-572.png'});
 invitation={id:'fixture-invitation',vehicle_name:'Fixture Himalayan',state:'pending'};await open();await page.getByRole('button',{name:'Accept vehicle assignment',exact:true}).click();await page.getByText('Assigned',{exact:true}).waitFor();assert.equal(writes.length,1,'assignment acceptance still works');
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 const violations=await page.evaluate(async()=>(await window.axe.run('.ops-heading,.driver-invitations',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));assert.deepEqual(violations,[]);
 assert.deepEqual(errors,[]);await writeFile(out+'/checks.json',JSON.stringify({passed:true,metrics,fixture_writes:writes,checks:['logo-row app shortcuts at320–1440 and100/200% text for three roles','44px touch targets','single assignment heading','collapsed ID and clipboard fallback','visible invitation acceptance','cab/shared tabs without duplicate Bike rides','WCAG A/AA header and assignments']},null,2));console.log('PASS: compact worker headers, assignment help/copy/acceptance, cab/shared navigation and accessibility. Evidence: '+out);
}catch(error){await page?.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.error(log.slice(-1000));throw error;}finally{await browser?.close();server.kill('SIGTERM');}
