import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend'),python=resolve(backend,'.venv/bin/python');
const temporary=await mkdtemp(resolve(tmpdir(),'scrap-lifecycle-')),db=resolve(temporary,'scrap.db'),apiOrigin='http://127.0.0.1:8057',origin=process.env.SCRAP_PREVIEW_ORIGIN||'http://127.0.0.1:5186';
let browser,server,log='',passed=false;const errors=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const serverCode=`import os,pathlib,uvicorn,main,local_business,scrap_experience
root=pathlib.Path(os.environ['SCRAP_FIXTURE_ROOT'])
def upload(key,data):
    flag=root/'fail-upload'
    if flag.exists():
        flag.unlink()
        raise RuntimeError('Fixture temporary private storage failure')
    path=root/'objects'/key
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as f:f.write(data)
def download(key):return (root/'objects'/key).read_bytes()
for module in [local_business,scrap_experience]:
    module.upload_object=upload
    module.download_object=download
uvicorn.run(main.app,host='127.0.0.1',port=8057)
`;
async function api(path,actor,method='GET',body){
 const response=await fetch(apiOrigin+path,{method,headers:{...(actor?{Authorization:'Bearer '+actor.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();assert.ok(response.ok,path+': '+JSON.stringify(data));return data;
}
async function register(name){return api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','-')+'@scrap.fixture',password:'isolated-password-fixture'});}
function record(kind,id,body){
 const script='import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute("INSERT INTO operation_records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",(sys.argv[2],sys.argv[3],sys.argv[4]));c.commit();c.close()';
 const result=spawnSync(python,['-c',script,db,kind,id,JSON.stringify(body)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
async function readyTask(page){await page.locator('.scrap-task-shell').waitFor();}
async function openTask(page){await page.locator('.scrap-task-preview').first().click();await readyTask(page);}
async function layout(page){
 const result=await page.locator('.scrap-task-shell').evaluate(element=>({overflow:element.scrollWidth>element.clientWidth+1,width:element.clientWidth,scroll:element.scrollWidth,footerVisible:element.querySelector('.agent-stage-footer').getBoundingClientRect().bottom<=innerHeight,targets:[...element.querySelectorAll('button')].filter(button=>button.getClientRects().length&&button.getBoundingClientRect().height<43).map(button=>button.textContent),wide:[...element.children].filter(child=>child.scrollWidth>child.clientWidth+1).map(child=>({class:child.className,width:child.clientWidth,scroll:child.scrollWidth}))}));
 assert.equal(result.overflow,false,JSON.stringify(result));assert.equal(result.footerVisible,true,JSON.stringify(result));assert.deepEqual(result.targets,[]);
}
try{
 server=spawn(python,['-c',serverCode],{cwd:backend,env:{...process.env,REPAIDO_STORAGE:'sqlite',REPAIDO_DB:db,REPAIDO_KYC_BUCKET:'fixture-private',SCRAP_FIXTURE_ROOT:temporary,RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:''},stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',value=>log+=value.toString());
 for(let count=0;count<100;count++){if(server.exitCode!==null)throw Error(log);try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}await pause(100);}
 const customer=await register('Pickup Customer'),collector=await register('Scrap Collector');
 record('business_partners',collector.user.id,{id:collector.user.id,user_id:collector.user.id,role:'scrap_owner',name:'Fixture collector',city:'Balasore',address:'Fixture collector base 123',location:{lat:21.4934,lng:86.9135},status:'approved',valid_until:Date.now()/1000+365*86400,version:2});
 const fixture={customer:{id:customer.user.id,token:customer.token},collector:{id:collector.user.id,token:collector.token}};
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({viewport:{width:390,height:850},timezoneId:'Asia/Kolkata',permissions:['camera','geolocation'],geolocation:{latitude:21.4934,longitude:86.9135,accuracy:5}});
 await context.routeWebSocket('**',socket=>socket.close());
 await context.addInitScript(value=>{localStorage.setItem('scrap.fixture',JSON.stringify(value));localStorage.setItem('repaido.token',value.customer.token);},fixture);
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/tests/scrap-preview.html');
 await page.getByLabel('Scrap details',{exact:true}).fill('Dry household metal ready for collection.');await page.getByLabel('Material',{exact:true}).selectOption('metal');await page.getByRole('button',{name:'Continue',exact:true}).click();
 const pickup=await page.evaluate(()=>{const value=new Date(Date.now()+7200000);return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}T${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;});
 await page.getByLabel('Preferred pickup',{exact:true}).fill(pickup);await page.getByLabel('Contact phone',{exact:true}).fill('9876543210');await page.getByRole('button',{name:'Continue',exact:true}).click();
 assert.equal(await page.locator('.scrap-request-wizard input[type=file]').count(),0,'Customer pickup evidence has no gallery uploader.');
 assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Open Repaido camera',exact:true}).click();await page.getByRole('button',{name:'Take pickup photo',exact:true}).waitFor();
 await page.getByRole('button',{name:'Take pickup photo',exact:true}).click();await page.locator('.scrap-photo-receipt').waitFor();
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Request collection',exact:true}).click();await page.locator('.scrap-task-preview').first().waitFor();
 assert.equal((await api('/operations/local-business/scrap',customer)).collections.length,1);
 await page.getByRole('button',{name:'Switch to collector',exact:true}).click();await openTask(page);await page.getByRole('button',{name:'Accept collection',exact:true}).click();
 await page.getByRole('button',{name:'Start journey & share location',exact:true}).click();await page.getByRole('button',{name:'Confirm arrival',exact:true}).click();
 await page.getByRole('button',{name:'Record inspection & weight',exact:true}).waitFor();await layout(page);
 await page.getByRole('button',{name:'Record inspection & weight',exact:true}).click();const quote=page.getByRole('dialog',{name:'Inspect & weigh scrap',exact:true});
 await quote.getByLabel('Grade / condition',{exact:true}).fill('Clean dry metal');await quote.getByLabel('Gross weight · kg',{exact:true}).fill('10.5');await quote.getByLabel('Container weight · kg',{exact:true}).fill('0.5');await quote.getByLabel('Price · ₹ per kg',{exact:true}).fill('25');await quote.getByLabel('Scale / calibration reference',{exact:true}).fill('fixture-scale-123');await quote.getByLabel('Inspection notes',{exact:true}).fill('Scale zeroed and scrap inspected at the pickup.');await quote.getByLabel('Scale reading photo',{exact:true}).setInputFiles(resolve(web,'public/images/cleaning.jpg'));
 await writeFile(resolve(temporary,'fail-upload'),'fixture failure');await quote.getByRole('button',{name:'Send weighed quote',exact:true}).click();await quote.getByText(/The photo could not upload/).waitFor();
 assert.equal(await quote.getByLabel('Gross weight · kg',{exact:true}).inputValue(),'10.5','An upload failure preserves the weighing draft.');
 let lose=true;await context.route('**/api/operations/local-business/scrap/*/evaluation',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname});if(lose){lose=false;await route.abort('failed');}else await route.fulfill({response});});
 await quote.getByRole('button',{name:'Send weighed quote',exact:true}).click();await quote.waitFor({state:'hidden'});
 await page.locator('.scrap-quote .scrap-amount strong').filter({hasText:'₹250.00'}).waitFor();
 const rows=(await api('/operations/local-business/scrap',collector)).collections;assert.equal(rows[0].state,'evaluated');assert.equal(rows[0].evaluation.lines[0].net_grams,10000);
 await page.getByRole('button',{name:'Back to collections',exact:true}).click();await page.getByRole('button',{name:'Switch to customer',exact:true}).click();await openTask(page);await page.getByRole('button',{name:'Accept quote · ₹250.00',exact:true}).click();
 await page.getByRole('button',{name:'Back to collections',exact:true}).click();await page.getByRole('button',{name:'Switch to collector',exact:true}).click();await openTask(page);await page.getByRole('button',{name:'Record customer payment',exact:true}).click();
 const payment=page.getByRole('dialog',{name:'Record customer payment',exact:true});await payment.getByLabel('Payment reference',{exact:true}).fill('cash-fixture-123');await payment.getByLabel('Payment notes',{exact:true}).fill('Cash paid in full at the pickup.');await payment.getByRole('button',{name:'Record payment',exact:true}).click();await payment.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Back to collections',exact:true}).click();await page.getByRole('button',{name:'Switch to customer',exact:true}).click();await openTask(page);await page.getByRole('button',{name:'I received ₹250.00',exact:true}).click();await page.getByText('Payment receipt confirmed. Your collection is complete.',{exact:true}).waitFor();
 const completed=(await api('/operations/local-business/scrap',customer)).collections[0];assert.equal(completed.state,'completed');assert.equal((await api('/operations/local-business/scrap/'+completed.id+'/tracking',customer)).position,null);
 await page.getByRole('button',{name:'History',exact:true}).click();await openTask(page);
 await mkdir(resolve(web,'test-results'),{recursive:true});
 for(const width of [320,476,1280]){await page.setViewportSize({width,height:850});await layout(page);await page.screenshot({path:resolve(web,'test-results/scrap-complete-'+width+'.png')});}
 await page.addScriptTag({path:require.resolve('axe-core')});
 for(const dark of [false,true]){
  await page.evaluate(dark=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.dataset.theme=dark?'dark':'light';},dark);
  const audit=await page.evaluate(()=>window.axe.run(document.querySelector('.scrap-task-shell'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}}));
  assert.deepEqual(audit.violations.map(value=>({id:value.id,nodes:value.nodes.map(node=>node.target)})),[]);
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await page.setViewportSize({width:320,height:850});await layout(page);
 await page.evaluate(()=>{document.documentElement.style.fontSize='';document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light';});
 await page.getByRole('button',{name:'Back to collections',exact:true}).click();
 const cards=page.getByRole('region',{name:'Home Services Category Grid',exact:true});assert.equal(await cards.getByText('Explore service',{exact:true}).count(),0);
 await cards.scrollIntoViewIfNeeded();assert.notEqual(await cards.locator('.repaido-service-icon-img').first().evaluate(element=>getComputedStyle(element).animationName),'none');await cards.getByRole('button',{name:'Pause service cards',exact:true}).click();assert.equal(await cards.locator('.repaido-service-icon-img').first().evaluate(element=>getComputedStyle(element).animationPlayState),'paused');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await cards.locator('.repaido-service-icon-img').first().evaluate(element=>getComputedStyle(element).animationName),'none');
 const audit=await page.evaluate(()=>window.axe.run(document.querySelector('.repaido-services-grid-container'),{runOnly:{type:'rule',values:['color-contrast-enhanced']}}));assert.deepEqual(audit.violations.map(value=>({id:value.id,nodes:value.nodes.map(node=>node.target)})),[]);
 await page.setViewportSize({width:476,height:850});await cards.screenshot({path:resolve(web,'test-results/home-service-cards.png')});
 assert.deepEqual(errors,[]);passed=true;console.log('Scrap browser lifecycle passed: mandatory live camera, private stamped photo, collector acceptance/GPS/arrival, failed scale upload and preserved draft, real quote save with lost response recovery, customer quote approval, reported payment and confirmed receipt, cleared tracking, 320/476/1280px task layout, service-card motion/pause/reduced motion and AAA card contrast.');
}finally{
 if(browser)await browser.close();if(server){server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(2000)]);}
 if(passed)await rm(temporary,{recursive:true,force:true});else{await writeFile(resolve(temporary,'backend.log'),log);console.error('Isolated scrap API logs:',resolve(temporary,'backend.log'));}
}
