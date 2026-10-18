import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend'),work=await mkdtemp('/tmp/repaidians-activity-');
const python=resolve(backend,'.venv/bin/python'),db=work+'/activity.db',port=8062,apiOrigin='http://127.0.0.1:'+port,origin=process.env.REPAIDIANS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
let server,browser,log='',recordReads=0,failRecords=false;const checks=[],errors=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixtures(rows){
  const code='import json,os,sys\nos.environ["REPAIDO_STORAGE"]="sqlite"\nos.environ["REPAIDO_DB"]=sys.argv[1]\nimport main\nrows=json.loads(sys.argv[2])\nmain.operations_store.run(lambda u:[u.put(kind,key,body) for kind,key,body in rows])';
  const result=spawnSync(python,['-c',code,db,JSON.stringify(rows)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,status=200){
  const response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
const publication=(account,source,id,caption)=>api('/repaidians/publications',account,'POST',{clientId:randomUUID(),kind:'post',trade:'electrician',visibility:'public',caption,media:[],milestone:{source,id}},201);
async function audit(page,width,theme,scale){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'document reflow');
  assert.equal(await page.locator('.rp-shell').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'community reflow');
  const card=page.locator('.rp-post-activity').filter({hasText:'Electrical inspection in progress'});
  for(const button of await card.locator('.rp-activity-decisions button').all()){
    assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;}),'44 px activity controls');
    await button.scrollIntoViewIfNeeded();assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el;}),'action remains unobscured');
  }
  assert(await card.locator('.rp-activity-profile').evaluate(el=>{const style=getComputedStyle(el),luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(n=>Number(n)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;},a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5;}),'profile action text contrast, including controls clipped by the feed scrollport');
  assert.notEqual(await card.evaluate(el=>getComputedStyle(el).boxShadow),'none','activity depth survives shared theme rules');
  if(!await page.evaluate(()=>Boolean(window.axe)))await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
  const issues=await page.evaluate(async()=>(await window.axe.run('.rp-feed',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
  assert.deepEqual(issues,[],'activity accessibility '+width+' '+theme+' '+scale);
  await page.screenshot({path:work+`/activity-${width}-${theme}-${scale}.png`,fullPage:true});
}
try{
  server=spawn(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port',String(port)],{cwd:backend,env:{...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite',REPAIDO_COMMUNITY_MEDIA_DIR:work+'/media',REPAIDO_COMMUNITY_BUCKET:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});for(const output of [server.stdout,server.stderr])output.on('data',value=>log+=value);
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error(log);try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}if(i===99)throw Error(log);await pause(200);}
  const worker=await api('/auth/register',null,'POST',{name:'Paramesh Prasad Mohapatra',email:'activity.worker@isolated.test',password:'isolated-test-password'},201),customer=await api('/auth/register',null,'POST',{name:'Repaido Member',email:'activity.customer@isolated.test',password:'isolated-test-password'},201),now=Date.now()/1000;
  const common={worker_id:worker.user.id,customer_id:customer.user.id,category:'electrician',created_at:now-86400,city:'Balasore',address:'SECRET ADDRESS',phone:'SECRET PHONE',notes:'SECRET NOTES'};
  const active={...common,id:'activity-job',state:'in_progress',service_name:'Electrical safety inspection'};
  fixtures([
    ['workers',worker.user.id,{id:worker.user.id,name:worker.user.name,status:'approved',role:'technician',categories:['electrician'],skills:['Electrical repairs'],tools:[],city:'Balasore',experience_years:5,completed_tasks:2,rating_count:2,rating_sum:9}],
    ['jobs',active.id,active],
    ['jobs','work-one',{...common,id:'work-one',state:'completed',service_name:'Verified electrical safety inspection',completed_at:now-86400,review:{rating:5,text:'Careful work and a clear explanation.',at:now-86400}}],
    ['jobs','work-two',{...common,id:'work-two',state:'completed',service_name:'Switch and socket repair',completed_at:now-172800,review:{rating:4,text:'Completed the agreed repair.',at:now-172800}}],
    ['shared_departures','activity-ride',{id:'activity-ride',owner_id:worker.user.id,driver_id:worker.user.id,state:'in_progress',city:'Balasore',origin:{lat:21.49,lng:86.91},starts_at:now-100,address:'SECRET RIDE ADDRESS',destination:{lat:21.5,lng:86.9}}],
    ['shared_passengers','activity-seat',{id:'activity-seat',departure_id:'activity-ride',customer_id:customer.user.id,state:'boarded'}]
  ]);
  await api('/repaidians/state',worker);await api('/repaidians/state',customer);
  await publication(worker,'shared','activity-ride','Sharing my drive today');await publication(customer,'shared','activity-ride','Going to Baripada');const post=await publication(worker,'service',active.id,'Electrical inspection in progress');
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:472,height:850},reducedMotion:'reduce'});
  await context.addInitScript(({token,user})=>{localStorage.setItem('repaido.token',token);localStorage.setItem('repaidians.test-user',JSON.stringify(user));},{token:worker.token,user:worker.user});
  await context.routeWebSocket('**',socket=>socket.close());
  await context.route('**/api/**',async route=>{try{const url=new URL(route.request().url());if(url.pathname.startsWith('/api/operations/professionals/')){recordReads++;if(failRecords){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'Records temporarily unavailable. Please retry.'}})});return;}}const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/tests/repaidians-preview.html');
  const professional=page.locator('.rp-post-activity').filter({hasText:'Electrical inspection in progress'}),passenger=page.locator('.rp-post-activity').filter({hasText:'Going to Baripada'});
  await professional.locator('.rp-activity[data-current=true]').waitFor();await professional.getByText('4.5',{exact:true}).waitFor();assert.equal(recordReads,0,'no per-post rich profile fetch at feed load');assert.equal(await passenger.getByText('Profile reviewed',{exact:true}).count(),0);await passenger.getByText('Passenger update',{exact:true}).waitFor();assert.equal(await professional.getByText('Driver update',{exact:true}).count(),0);checks.push('real source status, review counts and author roles render without fetching full records for every card');
  for(const width of [320,390,472,768])for(const theme of ['light','dark'])await audit(page,width,theme,width===320?200:100);
  await page.setViewportSize({width:472,height:850});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});
  failRecords=true;await professional.getByRole('button',{name:'Quick record',exact:true}).click();await professional.getByText('Records temporarily unavailable. Please retry.',{exact:true}).waitFor();failRecords=false;await professional.getByRole('button',{name:'Retry records',exact:true}).click();await professional.getByText('Verified electrical safety inspection',{exact:true}).waitFor();await professional.getByText('“Careful work and a clear explanation.”',{exact:true}).waitFor();assert.equal(recordReads,2);assert.equal((await page.locator('.rp-feed').innerText()).includes('SECRET'),false);await audit(page,472,'light',100);await audit(page,320,'dark',200);checks.push('quick record retries a failed real request and shows public completed work and verified reviews without private evidence');
  await passenger.getByRole('button',{name:'Quick record',exact:true}).click();await passenger.getByRole('heading',{name:'Shared activity history',exact:true}).waitFor();assert.equal(await passenger.getByText('Profile reviewed',{exact:true}).count(),0);checks.push('community authors get shared history without invented professional ratings or badges');
  await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});await professional.scrollIntoViewIfNeeded();await page.screenshot({path:work+'/activity-record.png',fullPage:true});
  fixtures([['jobs',active.id,{...active,state:'completed',completed_at:Date.now()/1000}]]);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await professional.getByText('Work completed',{exact:true}).waitFor();assert.equal(await professional.locator('.rp-activity').getAttribute('data-current'),'false');checks.push('live validation replaces active work with completed state from the backend');
  await professional.getByRole('button',{name:'Explore '+worker.user.name+' profile',exact:true}).click();await page.locator('.rp-profile-title h2').filter({hasText:worker.user.name}).waitFor();checks.push('profile action opens the real author profile');assert.deepEqual(errors,[]);
  await writeFile(work+'/report.json',JSON.stringify({passed:true,checks,recordReads,postId:post.item.id},null,2));console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);console.error(log.slice(-1500));process.exitCode=1;}finally{await browser?.close();server?.kill('SIGTERM');console.log('Evidence: '+work);}
