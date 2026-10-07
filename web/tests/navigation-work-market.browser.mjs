import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// All browser data comes from a real API and a disposable SQLite database.
// Canonical reviewed worker fixtures use the native transactional index hook.
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const backend=resolve(web,'../backend');
const artifacts=await mkdtemp(resolve(tmpdir(),'repaidians-work-navigation-'));
const db=resolve(artifacts,'community.db');
const python=process.env.REPAIDIANS_TEST_PYTHON||resolve(backend,'.venv/bin/python');
const origin=process.env.REPAIDIANS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const port=Number(process.env.WORK_NAV_TEST_PORT||8038),apiOrigin='http://127.0.0.1:'+port;
const errors=[],checks=[],variants=[];
let server,browser,serverLog='',success=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function nativeFixture(kind,id,body){
  const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nmain.operations_store.run(lambda u:u.put(sys.argv[2],sys.argv[3],json.loads(sys.argv[4])))';
  const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(body)],{cwd:backend,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
function processUpdates(){
  const code='import os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main,repaidians_work\nfor _ in range(6): repaidians_work.process_updates(main)';
  const result=spawnSync(python,['-c',code,db],{cwd:backend,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,expected=200,headers={}){
  const binary=Buffer.isBuffer(body);
  const response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body&&!binary?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
  const result=await response.json().catch(()=>({}));
  assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(result));return result;
}
let phoneSequence=0;
async function register(name){
  const account=await api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','.')+'@work-navigation.test',password:'isolated-test-password'},201);
  // The same isolated verified identity fixture used by the social navigation
  // harness supplies the phone claim; no SMS or external identity is contacted.
  nativeFixture('e2e_verified_phone',account.user.id,{phone:'+91987654'+String(++phoneSequence).padStart(4,'0')});return account;
}
const shell=page=>page.getByRole('dialog',{name:'Repaidians community',exact:true});
async function newPage(account){
  const context=await browser.newContext({viewport:{width:509,height:850},reducedMotion:'reduce'});
  await context.routeWebSocket('**',socket=>socket.close());
  await context.addInitScript(token=>{if(token)localStorage.setItem('repaido.token',token);},account?.token||'');
  await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/tests/repaidians-preview.html');await shell(page).waitFor();await shell(page).locator('.rp-loading').waitFor({state:'hidden'});
  return page;
}
const nav=(page,label)=>shell(page).locator('.rp-bottom-nav').getByRole('button',{name:label,exact:true}).click();
async function hub(page,label){
  const navigation=shell(page).getByRole('navigation',{name:'Work and market sections',exact:true});
  const category=['Market','Matching jobs','Companies'].includes(label)?'Browse':['Applications','Contracts','Shared work history'].includes(label)?'My work':'Professional tools';
  const toggle=navigation.getByRole('button',{name:category,exact:true});
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await navigation.getByRole('group',{name:category,exact:true}).getByRole('button',{name:label,exact:true}).click();
}
async function assertNavigation(page,role){
  const navState=await shell(page).locator('.rp-bottom-nav').evaluate(nav=>{
    const buttons=[...nav.querySelectorAll(':scope > button')].map(button=>{const rect=button.getBoundingClientRect();return {label:button.getAttribute('aria-label')||button.textContent.trim(),top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,width:rect.width,height:rect.height};});
    return {buttons,overflow:nav.scrollWidth>nav.clientWidth+1,height:nav.getBoundingClientRect().height};
  });
  assert.equal(navState.buttons.length,5,role+' has exactly five mobile navigation actions.');
  assert.equal(navState.overflow,false,role+' bottom navigation does not overflow.');
  assert.ok(Math.max(...navState.buttons.map(button=>button.top))-Math.min(...navState.buttons.map(button=>button.top))<=1,role+' bottom buttons remain on one horizontal row: '+JSON.stringify(navState));
  assert.equal(navState.buttons.some(button=>/create|publication|upload/i.test(button.label)),false,'Creation does not occupy a bottom navigation slot.');
  assert.deepEqual(navState.buttons.map(button=>button.label),['Home','Search','Works','Work & market',role==='professional'?'My profile':'Account']);
  for(const button of navState.buttons)assert.ok(button.width>=44&&button.height>=44,'Navigation remains touchable: '+JSON.stringify(button));
  const layout=await shell(page).evaluate(root=>({shellOverflow:root.scrollWidth>root.clientWidth+1,contentOverflow:root.querySelector('.rp-content').scrollWidth>root.querySelector('.rp-content').clientWidth+1,headerOverflow:root.querySelector('.rp-header').scrollWidth>root.querySelector('.rp-header').clientWidth+1}));
  assert.deepEqual(layout,{shellOverflow:false,contentOverflow:false,headerOverflow:false},role+' has no horizontal overflow.');
  const create=shell(page).locator('.rp-header').getByRole('button',{name:'Create publication',exact:true});
  assert.equal(await create.count(),role==='professional'?1:0,'Top creation follows the canonical professional role.');
  if(role==='professional')assert.equal(await shell(page).getByRole('button',{name:/^Create(?: publication)?$/,exact:true}).count(),1,'There is one primary creation action in the community shell.');
  return navState;
}
async function audit(page,variant=''){
  await page.addScriptTag({path:require.resolve('axe-core')});
  const issues=await page.evaluate(async()=>(await window.axe.run(document.querySelector('.rp-shell'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(violation=>({id:violation.id,nodes:violation.nodes.map(node=>node.target)})));
  assert.deepEqual(issues,[],variant+' meets WCAG AA checks.');
}
async function variantsFor(page,role,view){
  for(const width of [320,509])for(const theme of ['light','dark'])for(const text of [100,200]){
    await page.setViewportSize({width,height:850});
    await page.evaluate(({theme,text})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=text+'%';},{theme,text});
    const state=await assertNavigation(page,role);await audit(page,[role,view,width,theme,text].join(' / '));
    variants.push({role,view,width,theme,text,labels:state.buttons.map(button=>button.label),navHeight:state.height});
  }
  await page.setViewportSize({width:509,height:850});
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});
}

try{
  const serverCode='import main,uvicorn\nfrom fastapi import Header\noriginal=main.current_user\ndef verified(authorization: str=Header(default="")):\n user=original(authorization)\n claim=main.operations_store.run(lambda u:u.get("e2e_verified_phone",user["id"]))\n return {**user,**({"phone":claim["phone"],"phone_verified":True,"phone_authenticated":True} if claim else {})}\nmain.app.dependency_overrides[original]=verified\nuvicorn.run(main.app,host="127.0.0.1",port='+port+')';
  server=spawn(python,['-c',serverCode],{cwd:backend,env:{...process.env,REPAIDO_STORAGE:'sqlite',REPAIDO_DB:db,REPAIDO_COMMUNITY_MEDIA_DIR:resolve(artifacts,'media'),REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>serverLog+=chunk.toString());
  for(let attempt=0;attempt<100;attempt++){
    if(server.exitCode!==null)throw new Error('Isolated backend stopped: '+serverLog);
    try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}
    if(attempt===99)throw new Error('Isolated backend was not ready: '+serverLog);
    await pause(200);
  }
  const agent=await register('Asha Electrician'),contractor=await register('Dev Contractor'),customer=await register('Neel Customer');
  nativeFixture('workers',agent.user.id,{id:agent.user.id,name:agent.user.name,status:'approved',role:'technician',categories:['electrician'],city:'Balasore',skills:['Wiring','Inspection'],experience_years:8});
  nativeFixture('workers',contractor.user.id,{id:contractor.user.id,name:contractor.user.name,status:'approved',role:'specialist',contractor_verified:true,categories:['electrician'],city:'Balasore',skills:['Wiring','Inspection'],experience_years:12});
  for(const account of [agent,contractor,customer])await api('/repaidians/state',account);
  for(const account of [agent,contractor])await api('/repaidians/profile',account,'PATCH',{trade:'electrician',name:account.user.name,headline:'Reviewed electrical work from a canonical partner profile',city:'Balasore',skills:['Wiring','Inspection'],experienceYears:account===agent?8:12,workStatus:account===agent?'open_to_work':'hiring'});
  await api('/repaidians/network/profile',contractor,'PATCH',{expectedVersion:0,clientId:randomUUID(),visibility:'public',about:'Electrical contracting experience published for customers and professional peers.',experience:[{id:'published-experience',title:'Electrical team lead',organization:'Independent project teams',city:'Balasore',startMonth:'2018-01',current:true,description:'Managed teams and electrical safety inspections.'}]});
  const media=await api('/repaidians/media',contractor,'POST',await readFile(resolve(web,'public/images/electrical.jpg')),201,{'Content-Type':'image/jpeg'});
  const publication=(await api('/repaidians/publications',contractor,'POST',{kind:'post',trade:'electrician',visibility:'public',caption:'Documented electrical work from a real approved contractor.',media:[{url:media.url,kind:media.kind,alt:'Published electrical work photo'}],clientId:randomUUID()},201)).item;
  assert.ok(publication.id);
  await api('/repaidians/work/preferences',agent,'PATCH',{personalizedDiscovery:true,contractUpdates:true,jobDiscovery:true});
  const now=Date.now()/1000;
  const job={id:'matching-electrical-project',owner_id:contractor.user.id,owner_name:contractor.user.name,title:'Circuit inspection project team',source_kind:'commercial_project',status:'planning',starts_at:now+172800,ends_at:now+30*86400,team:[],goals:[],created_at:now,updated_at:now,version:1,site:'PRIVATE SITE ADDRESS',scope:'PRIVATE CONTRACT SCOPE',budget_paise:2000000,hiring:{status:'open',sector:'Electrical',city:'Balasore',area:'Published neighbourhood',skills:['Wiring','Inspection'],minimum_experience:2,worker_role:'technician',summary:'Inspect circuits with a documented safety checklist.',daily_rate_paise:90000,openings:2,deadline:now+86400,terms:'Published hours and agreed equipment.',version:1,updated_at:now}};
  nativeFixture('contract_projects',job.id,job);
  assert.ok((await api('/repaidians/work/jobs',agent)).items.some(item=>item.id===job.id),'The discovery fixture is a real eligible native job.');
  processUpdates();
  const notices=(await api('/repaidians/notifications',agent)).notifications;
  const discovery=notices.find(item=>item.type==='job_discovery'&&item.jobId===job.id);
  assert.ok(discovery,'The durable worker publishes an eligible job discovery to the bell.');
  assert.equal(JSON.stringify(discovery).includes('PRIVATE'),false);
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  const agentPage=await newPage(agent),contractorPage=await newPage(contractor),customerPage=await newPage(customer),guestPage=await newPage(null);
  // Exercise the read acknowledgement and exact-job navigation race before
  // the longer responsive matrix, using the worker's fresh unread notice.
  await shell(agentPage).getByRole('button',{name:'Notifications',exact:true}).click();
  await shell(agentPage).locator('.rp-notification-row').filter({hasText:discovery.title}).click();
  const jobDetails=agentPage.getByRole('dialog',{name:job.title,exact:true});await jobDetails.waitFor();
  await jobDetails.getByRole('heading',{name:job.title,exact:true}).waitFor();
  assert.equal((await jobDetails.innerText()).includes('PRIVATE'),false,'Notification navigation only exposes the published eligible job details.');
  assert.equal((await api('/repaidians/notifications',agent)).notifications.find(item=>item.id===discovery.id).read,true,'Opening a discovery marks exactly the selected notice read.');
  await jobDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
  checks.push('A fresh matching-job bell notice acknowledges read state and opens its exact canonical job without a cache-generation race');
  console.log('Fresh discovery → read acknowledgement → exact job dialog passed.');
  await nav(agentPage,'Home');
  await variantsFor(agentPage,'professional','feed');
  await variantsFor(contractorPage,'professional','contractor-feed');
  await variantsFor(customerPage,'customer','feed');
  await variantsFor(guestPage,'guest','feed');
  checks.push('32 agent, contractor, customer and guest feed variants retain five touchable bottom actions on one row without horizontal overflow');
  await shell(agentPage).locator('.rp-header').getByRole('button',{name:'Create publication',exact:true}).click();
  const studio=agentPage.getByRole('dialog',{name:'Publishing studio',exact:true});await studio.waitFor();
  await studio.getByRole('button',{name:'Close dialog',exact:true}).click();
  checks.push('The single top creation action opens the genuine publishing studio');
  await nav(agentPage,'My profile');await shell(agentPage).locator('.rp-profile').waitFor();
  await shell(agentPage).getByRole('button',{name:'Open Work and market business suite',exact:true}).waitFor();
  assert.equal(await shell(agentPage).locator('.rp-profile .rp-professional-profile,.rp-profile .public-contract-history,.rp-profile .rp-work-hub,.rp-profile .rp-professional-network').count(),0,'Own profile no longer contains the detailed work, career, hiring or network panels.');
  assert.equal(await shell(agentPage).getByRole('button',{name:'Open Work and market business suite',exact:true}).count(),1,'Own profile has one clear work hub shortcut.');
  await shell(agentPage).locator('.rp-portfolio-tabs').getByRole('button',{name:'Photos',exact:true}).waitFor();
  await variantsFor(agentPage,'professional','own-profile');
  await shell(agentPage).getByRole('button',{name:'Open Work and market business suite',exact:true}).click();
  await shell(agentPage).getByRole('navigation',{name:'Work and market sections',exact:true}).waitFor();
  // These panels use their existing authenticated server reads and native handoffs.
  for(const [label,region] of [['Market','Professional opportunities'],['Matching jobs','My jobs'],['Applications','Apply Status'],['Companies','Company directory'],['Contracts','Professional contract opportunities'],['Network','Professional network'],['Background','Professional background and network'],['Shared work history','Public contract history'],['Preferences','Work discovery & sharing']]){
    await hub(agentPage,label);await shell(agentPage).getByRole('region',{name:region,exact:true}).waitFor();
    await agentPage.waitForLoadState('networkidle');
    assert.equal(await shell(agentPage).getByRole('alert').count(),0,label+' loads actual authorized server data without an error panel.');
  }
  await hub(agentPage,'Matching jobs');await shell(agentPage).getByText(job.title,{exact:true}).waitFor();
  await variantsFor(agentPage,'professional','work-and-market-jobs');
  checks.push('Own profile preserves portfolio and routes every work category to one Work & market hub');
  await nav(agentPage,'Home');await shell(agentPage).getByRole('button',{name:'View '+contractor.user.name+' profile',exact:true}).first().click();
  await shell(agentPage).getByText('Electrical team lead',{exact:true}).waitFor();
  await shell(agentPage).getByRole('region',{name:'Public contract history',exact:true}).waitFor();
  assert.equal(await shell(agentPage).getByRole('button',{name:'Open Work and market business suite',exact:true}).count(),0,'Another member profile does not expose the private own-work shortcut.');
  checks.push('Other profiles retain published career experience and public contract history');
  for(const [page,role] of [[customerPage,'customer'],[guestPage,'guest']]){
    await nav(page,'Home');await shell(page).getByRole('button',{name:'View '+contractor.user.name+' profile',exact:true}).first().click();
    await shell(page).getByText('Electrical team lead',{exact:true}).waitFor();
    await shell(page).getByRole('region',{name:'Public contract history',exact:true}).waitFor();
    assert.equal(await shell(page).getByRole('button',{name:'Open Work and market business suite',exact:true}).count(),0,role+' sees the member credibility without private owner tools.');
    assert.equal(await shell(page).getByRole('button',{name:'Connect',exact:true}).count(),0,role+' cannot request a professional connection.');
  }
  checks.push('Customer and guest browsing preserve the contractor public background and history');
  await nav(contractorPage,'My profile');await shell(contractorPage).locator('.rp-profile').waitFor();
  assert.equal(await shell(contractorPage).locator('.rp-profile .rp-professional-profile,.rp-profile .public-contract-history').count(),0,'Own contractor work history and background also live in the hub.');
  await shell(contractorPage).getByRole('button',{name:'Open Work and market business suite',exact:true}).click();
  await hub(contractorPage,'Contracts');await shell(contractorPage).getByRole('region',{name:'Professional contract opportunities',exact:true}).waitFor();
  await contractorPage.waitForLoadState('networkidle');assert.equal(await shell(contractorPage).getByRole('alert').count(),0);
  checks.push('Contractor own profile also routes management into its authorized contract hub');
  await nav(customerPage,'Account');await customerPage.getByRole('dialog',{name:'Profile tools and settings',exact:true}).waitFor();
  await customerPage.getByRole('dialog',{name:'Profile tools and settings',exact:true}).getByRole('button',{name:'Close profile tools',exact:true}).click();
  await nav(guestPage,'Account');await shell(guestPage).getByText(/Sign in/).first().waitFor();
  await nav(customerPage,'Work & market');assert.equal(await shell(customerPage).getByRole('button',{name:'Matching jobs',exact:true}).count(),0,'Customer hub does not suggest private professional jobs access.');
  await hub(customerPage,'Contracts');await shell(customerPage).getByRole('region',{name:'Customer custom contracts',exact:true}).waitFor();
  checks.push('Customer Account opens its actual tools and guest Account offers sign-in while professional-only work remains gated');
  assert.deepEqual(errors,[]);
  await mkdir(resolve(web,'test-results'),{recursive:true});
  await nav(agentPage,'Home');await agentPage.setViewportSize({width:320,height:850});
  await agentPage.screenshot({path:resolve(artifacts,'professional-320-top-create.png')});
  await nav(agentPage,'My profile');await agentPage.screenshot({path:resolve(artifacts,'own-profile-320.png')});
  await nav(agentPage,'Work & market');await hub(agentPage,'Matching jobs');await agentPage.setViewportSize({width:509,height:850});
  await agentPage.evaluate(()=>document.documentElement.dataset.theme='dark');
  await agentPage.screenshot({path:resolve(artifacts,'work-market-509-dark.png')});
  success=true;
  await writeFile(resolve(artifacts,'results.json'),JSON.stringify({passed:true,checks,variants,pageErrors:errors},null,2));
  console.log(JSON.stringify({passed:true,checks,variantCount:variants.length,artifacts},null,2));
}catch(error){
  await writeFile(resolve(artifacts,'partial-results.json'),JSON.stringify({passed:false,checks,variants,pageErrors:errors},null,2));
  for(const [contextIndex,context] of (browser?.contexts()||[]).entries())for(const [pageIndex,page] of context.pages().entries()){
    await page.screenshot({path:resolve(artifacts,'failure-'+contextIndex+'-'+pageIndex+'.png')}).catch(()=>{});
    await writeFile(resolve(artifacts,'failure-'+contextIndex+'-'+pageIndex+'.html'),await page.content().catch(()=>''));
  }
  console.error('Work navigation artifacts: '+artifacts);throw error;
}finally{
  await browser?.close();server?.kill('SIGTERM');
  if(server)await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(3000)]);
  await writeFile(resolve(artifacts,'backend.log'),serverLog);
  if(!success)console.error('Backend log: '+resolve(artifacts,'backend.log'));
}
