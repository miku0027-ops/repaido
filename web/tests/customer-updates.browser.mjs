import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend'),python=resolve(backend,'.venv/bin/python');
const work=await mkdtemp(resolve(tmpdir(),'customer-updates-')),db=resolve(work,'operations.db');
const apiOrigin='http://127.0.0.1:8020',origin=process.env.CUSTOMER_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
let server,browser,log='';const errors=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,account,method='GET',body){const r=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text);}catch{await pause(100);throw Error(`${path} returned ${r.status}: ${text}\n${log.slice(-4000)}`);}assert.ok(r.ok,JSON.stringify(json));return json;}
function fixture(kind,id,value){const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nmain.operations_store.run(lambda u:u.put(sys.argv[2],sys.argv[3],json.loads(sys.argv[4])))';const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(value)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
function domain(code){const result=spawnSync(python,['-c','import os,sys,time\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main,repaidians_work\n'+code,db],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}
try{
  server=spawn(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port','8020'],{cwd:backend,env:{...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite',REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:''},stdio:['ignore','pipe','pipe']});
  for(const s of [server.stdout,server.stderr])s.on('data',chunk=>log+=chunk);
  for(let i=0;i<100;i++){try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}if(i===99)throw Error(log);await pause(100);}
  const account=await api('/auth/register',null,'POST',{name:'Customer Test',email:'customer-updates@example.com',password:'isolated-password'});
  const job=await api('/operations/bookings',account,'POST',{service_id:'ac-service',city:'Balasore',address:'Test customer street 123',phone:'9876543210',location:{lat:21.4934,lng:86.9135},starts_at:new Date(Date.now()+4*3600000).toISOString(),idempotency_key:crypto.randomUUID()});
  fixture('notifications','real-booking-update',{id:'real-booking-update',user_id:account.user.id,job_id:job.id,title:'Booking requested',body:'Your AC service request has been received.',event_id:'isolated-event',created_at:Date.now()/1000,read_at:null});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  for(const width of [320,390,524,1280]){
    const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'});
    await context.addInitScript(token=>localStorage.setItem('repaido.token',token),account.token);
    let notificationReads=0;
    await context.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/operations/notifications')notificationReads++;const r=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response:r});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/tests/customer-updates-preview.html');await page.getByRole('region',{name:'Live bookings'}).waitFor();
    await page.getByText(job.service_name,{exact:false}).first().waitFor();
    await page.getByRole('button',{name:'Notifications',exact:true}).click();const panel=page.getByRole('dialog',{name:'Notifications',exact:true});await panel.waitFor();
    await panel.getByRole('heading',{name:'Booking requested'}).waitFor();
    assert.equal(await panel.getByText(/55%|escrow guarantee|100% protected/i).count(),0);
    assert.equal(await panel.locator('.notif-card').count(),1);
    const bounds=await panel.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    for(const button of await panel.locator('button:visible').all()){const b=await button.boundingBox();assert.ok(b.width>=44&&b.height>=44);}
    await page.keyboard.press('Tab');assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true);
    await page.keyboard.press('Escape');assert.equal(await panel.count(),0);assert.equal(await page.getByRole('button',{name:'Notifications',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'Notifications',exact:true}).click();await panel.waitFor();assert.equal(notificationReads,1,'A fresh reopen uses the shared response cache.');
    if(width===320){await panel.getByRole('button',{name:'Mark all read',exact:true}).click();await panel.getByText('You’re up to date',{exact:true}).waitFor();const persisted=await api('/operations/notifications',account);assert.ok(persisted.notifications[0].read_at);}
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await panel.getByRole('button',{name:'View booking',exact:true}).click();await page.locator('.live-tracking-overlay').waitFor();
    assert.equal(await page.locator('.repaido-launch,.repaido-loading-notice').count(),0,'Customer requests never introduce a blocking loading dialog.');
    await context.close();
  }
  const agent=await api('/auth/register',null,'POST',{name:'Discovery Agent',email:'discovery-agent@example.com',password:'isolated-password'});
  await api('/repaidians/state',agent);const now=Date.now()/1000;
  fixture('workers',agent.user.id,{id:agent.user.id,name:'Discovery Agent',status:'approved',role:'technician',categories:['electrician'],city:'Balasore',skills:['Electrical installation'],experience_years:4});
  domain(`main.operations_store.run(lambda u:u.put('rp_members',${JSON.stringify(agent.user.id)},{**u.get('rp_members',${JSON.stringify(agent.user.id)}),'trade':'electrician','city':'Balasore','skills':['Electrical installation'],'experienceYears':4,'workStatus':'open_to_work'}))`);
  fixture('workers','discovery-owner',{id:'discovery-owner',name:'Discovery Contractor',status:'approved',role:'technician',contractor_verified:true,categories:['electrician'],city:'Balasore'});
  const project={id:'matching-job',owner_id:'discovery-owner',owner_name:'Discovery Contractor',title:'Electrical installation project',source_kind:'commercial_project',status:'planning',starts_at:now+5*86400,ends_at:now+30*86400,team:[],goals:[],created_at:now,site:'PRIVATE EXACT SITE',scope:'PRIVATE CONTRACT SCOPE',budget_paise:999999999,version:1,hiring:{status:'open',sector:'Electrical',work_trade:'electrician',city:'Balasore',area:'Published neighbourhood',skills:['Electrical installation'],minimum_experience:2,worker_role:'any',summary:'Published work and safety requirements.',daily_rate_paise:80000,openings:3,deadline:now+4*86400,terms:'Published fair work terms.',version:1}};
  fixture('contract_projects',project.id,project);
  await api('/repaidians/work/preferences',agent,'PATCH',{jobDiscovery:true});
  const delivered=domain(`print(main.operations_store.run(lambda u:repaidians_work.deliver_job_discoveries(u,${JSON.stringify(agent.user.id)})))`).trim().split('\n').at(-1);
  assert.equal(delivered,'1','The bounded discovery worker delivers a matching canonical hiring notice.');
  const native=(await api('/operations/notifications',agent)).notifications.filter(row=>row.kind==='job_discovery');
  assert.equal(native.length,1);assert.equal(native[0].kind,'job_discovery');assert.equal(native[0].community_job_id,project.id);assert.equal(native[0].job_id,undefined);
  for(const width of [320,509]){
    const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'});
    await context.addInitScript(token=>localStorage.setItem('repaido.token',token),agent.token);
    const jobRequests=[];let acknowledged=false;
    await context.route('**/api/**',async route=>{const url=new URL(route.request().url()),ack=url.pathname==='/api/operations/notifications/'+native[0].id+'/read';if(ack)await pause(150);if(url.pathname.startsWith('/api/repaidians/work/jobs/'))jobRequests.push({path:url.pathname,acknowledged});const r=await route.fetch({url:apiOrigin+url.pathname+url.search});if(ack&&r.ok())acknowledged=true;await route.fulfill({response:r});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/tests/customer-updates-preview.html?account='+encodeURIComponent(agent.user.id));
    await page.getByRole('button',{name:'Notifications',exact:true}).click();const panel=page.getByRole('dialog',{name:'Notifications',exact:true});
    await panel.getByRole('heading',{name:'A matching job is open'}).waitFor();
    await panel.getByRole('button',{name:'Discoveries',exact:true}).click();assert.equal(await panel.locator('.notif-card').count(),1);
    await panel.getByRole('button',{name:'Bookings',exact:true}).click();assert.equal(await panel.locator('.notif-card').count(),0,'A community job never routes or filters as a customer booking.');
    await panel.getByRole('button',{name:'Discoveries',exact:true}).click();
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await panel.getByRole('button',{name:'View matching job',exact:true}).click();
    const detail=page.getByRole('dialog',{name:project.title,exact:true});await detail.waitFor();
    assert(jobRequests.some(request=>request.path==='/api/repaidians/work/jobs/'+project.id&&request.acknowledged),'The bell settles a delayed mirrored acknowledgement before refetching this exact live native job.');
    assert.equal(await page.locator('.live-tracking-overlay').count(),0,'A matching-job action never opens booking tracking.');
    assert.equal(await page.getByRole('heading',{name:'Work & market',exact:true}).count(),1);
    assert.equal(await detail.getByText('PRIVATE EXACT SITE',{exact:true}).count(),0);
    for(let attempt=0;attempt<40;attempt++){const rows=(await api('/operations/notifications',agent)).notifications;if(rows.find(row=>row.id===native[0].id)?.read_at)break;await pause(50);}
    assert((await api('/operations/notifications',agent)).notifications.find(row=>row.id===native[0].id).read_at>0);
    assert.equal((await api('/repaidians/notifications',agent)).notifications.find(row=>row.id===native[0].id).read,true,'Opening the main bell card acknowledges the same community discovery atomically.');
    await context.close();
  }
  await api('/repaidians/work/preferences',agent,'PATCH',{jobDiscovery:false});
  assert.deepEqual((await api('/operations/notifications',agent)).notifications.filter(row=>row.kind==='job_discovery'),[],'Revoking discovery consent removes the mirrored actionable alert.');
  assert.deepEqual(errors,[]);console.log('PASS: real customer bookings; matching-job discoveries open live Work & market details, avoid booking routes, acknowledge both bells; read persistence, cached reopening, focus, mobile/dark/200% layouts, no blocking loaders.');
}finally{await browser?.close();server?.kill('SIGTERM');await pause(150);await rm(work,{recursive:true,force:true});}
