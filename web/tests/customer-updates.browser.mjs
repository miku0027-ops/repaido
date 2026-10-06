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
async function api(path,account,method='GET',body){const r=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const json=await r.json();assert.ok(r.ok,JSON.stringify(json));return json;}
function fixture(kind,id,value){const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nmain.operations_store.run(lambda u:u.put(sys.argv[2],sys.argv[3],json.loads(sys.argv[4])))';const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(value)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
try{
  server=spawn(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port','8020'],{cwd:backend,env:{...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite',REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:''},stdio:['ignore','pipe','pipe']});
  for(const s of [server.stdout,server.stderr])s.on('data',chunk=>log+=chunk);
  for(let i=0;i<100;i++){try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}if(i===99)throw Error(log);await pause(100);}
  const account=await api('/auth/register',null,'POST',{name:'Customer Test',email:'customer-updates@test.invalid',password:'isolated-password'});
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
  assert.deepEqual(errors,[]);console.log('PASS: real customer bookings, notifications/read persistence, cached reopening, focus, mobile/dark/200% layouts, no blocking loaders.');
}finally{await browser?.close();server?.kill('SIGTERM');await pause(150);await rm(work,{recursive:true,force:true});}
