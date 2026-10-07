import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Render the real community against its own isolated database. Only the deliberate
// failed-write case injects a transport error; profiles, preferences and media use API storage.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend');
const artifacts=await mkdtemp(resolve(tmpdir(),'repaidians-social-navigation-'));
const python=process.env.REPAIDIANS_TEST_PYTHON||resolve(backend,'.venv/bin/python');
const port=Number(process.env.SOCIAL_NAV_TEST_PORT||8034),apiOrigin='http://127.0.0.1:'+port;
const origin=process.env.REPAIDIANS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
let server,browser,serverLog='',success=false;
const errors=[],releaseReads=[];
function fixture(kind,id,body){
  const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nmain.operations_store.run(lambda u:u.put(sys.argv[2],sys.argv[3],json.loads(sys.argv[4])))';
  const result=spawnSync(python,['-c',code,resolve(artifacts,'social.db'),kind,id,JSON.stringify(body)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
function processUpdates(){
  const code='import os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main,repaidians_work\nfor _ in range(3): repaidians_work.process_updates(main)';
  const result=spawnSync(python,['-c',code,resolve(artifacts,'social.db')],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,expected=200,headers={}){
  const binary=Buffer.isBuffer(body),response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body&&!binary?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
  const result=await response.json().catch(()=>({}));assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(result));return result;
}
async function register(name){const account=await api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','.')+'@social-navigation.test',password:'isolated-test-password'},201);fixture('e2e_verified_phone',account.user.id,{phone:'+919876543210'});return account;}
const shell=page=>page.getByRole('dialog',{name:'Repaidians community',exact:true});
const nav=(page,label)=>shell(page).locator('.rp-bottom-nav').getByRole('button',{name:label,exact:true}).click();
async function profile(page){await nav(page,'My profile');await shell(page).locator('.rp-profile').waitFor();}
async function audit(page,selector='.rp-shell'){
  await page.addScriptTag({path:require.resolve('axe-core')});
  const issues=await page.evaluate(async selector=>(await window.axe.run(document.querySelector(selector),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),selector);
  assert.deepEqual(issues,[]);
}
async function settings(page){
  await shell(page).getByRole('button',{name:'Open profile tools and settings',exact:true}).click();
  const tools=page.getByRole('dialog',{name:'Profile tools and settings',exact:true});
  await tools.getByRole('button',{name:/^Privacy & notifications/}).click();
  const drawer=page.getByRole('dialog',{name:'Privacy and notifications',exact:true});
  await drawer.getByLabel('Allow messages from',{exact:true}).waitFor();return drawer;
}
try{
  const code='import main,uvicorn\nfrom fastapi import Header\noriginal=main.current_user\ndef verified(authorization: str=Header(default="")):\n user=original(authorization)\n claim=main.operations_store.run(lambda u:u.get("e2e_verified_phone",user["id"]))\n return {**user,**({"phone":claim["phone"],"phone_verified":True,"phone_authenticated":True} if claim else {})}\nmain.app.dependency_overrides[original]=verified\nuvicorn.run(main.app,host="127.0.0.1",port='+port+')';
  server=spawn(python,['-c',code],{cwd:backend,env:{...process.env,REPAIDO_STORAGE:'sqlite',REPAIDO_DB:resolve(artifacts,'social.db'),REPAIDO_COMMUNITY_MEDIA_DIR:resolve(artifacts,'media'),REPAIDO_COMMUNITY_BUCKET:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});
  for(const output of [server.stdout,server.stderr])output.on('data',chunk=>serverLog+=chunk.toString());
  for(let attempt=0;attempt<100;attempt++){
    if(server.exitCode!==null)throw new Error('Isolated backend stopped: '+serverLog);
    try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}
    if(attempt===99)throw new Error('Isolated backend did not start: '+serverLog);
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  const alice=await register('Alice Electrician'),bob=await register('Bob Carpenter');
  for(const [account,trade] of [[alice,'electrician'],[bob,'carpenter']]){
    await api('/repaidians/state',account);
    await api('/repaidians/profile',account,'PATCH',{trade,name:account.user.name,bio:'Work shared through the isolated community.',workStatus:account===alice?'not_looking':'open_to_work',skills:account===alice?['Wiring','Inspection']:['Furniture repairs'],city:'Balasore'});
  }
  await api('/repaidians/work/preferences',alice,'PATCH',{personalizedDiscovery:true});
  await api('/repaidians/work/behavior',alice,'POST',{eventId:randomUUID(),trade:'electrician',type:'search',query:'electrical work'});
  const asset=await api('/repaidians/media',bob,'POST',await readFile(resolve(web,'public/images/cleaning.jpg')),201,{'Content-Type':'image/jpeg'});
  const publication=await api('/repaidians/publications',bob,'POST',{kind:'post',trade:'carpenter',visibility:'public',caption:'A completed repair shared through the real isolated API.',media:[{url:asset.url,kind:asset.kind,alt:'A repair photo preserved at its original aspect ratio'}],clientId:randomUUID()},201);
  fixture('workers',alice.user.id,{id:alice.user.id,name:alice.user.name,status:'approved',role:'technician',city:'Balasore',categories:['electrician'],skills:['Wiring','Inspection'],experience_years:8});
  fixture('workers',bob.user.id,{id:bob.user.id,name:bob.user.name,status:'approved',role:'specialist',contractor_verified:true,city:'Balasore',categories:['carpenter'],skills:['Furniture repairs']});
  const now=Date.now()/1000;
  let project=await api('/operations/contractor/projects',bob,'POST',{request_id:randomUUID(),title:'Actual electrical team opening',scope:'Inspect and repair electrical circuits with documented safety checks.',site:'PRIVATE exact worksite',starts_at:now+7200,ends_at:now+86400,budget_paise:1000000});
  project=await api('/operations/contractor/projects/'+project.id+'/hiring',bob,'PUT',{expected_version:project.version,status:'open',city:'Balasore',area:'Town centre',sector:'Electrical',summary:'Electrical maintenance and circuit inspection with safe equipment.',skills:['Wiring','Inspection'],worker_role:'any',openings:1,minimum_experience:1,daily_rate_paise:95000,hours_per_day:8,deadline:now+3600,terms:'Eight hours daily with documented attendance and safety equipment.'});
  let application=await api('/operations/contractor/projects/'+project.id+'/apply',alice,'POST',{hiring_version:project.hiring.version,note:'Experienced in wiring and electrical inspections and available for these project dates.',available:true});
  await api('/repaidians/follow/'+alice.user.id,bob,'PUT',{active:true});
  await api('/repaidians/work/preferences',alice,'PATCH',{sharePlacements:true,shareSalary:false});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
  // Shared workspace edits must not restart a running browser scenario.
  await context.routeWebSocket('**',socket=>socket.close());
  await context.addInitScript(token=>localStorage.setItem('repaido.token',token),alice.token);
  await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/tests/repaidians-preview.html');await shell(page).locator('.rp-post').first().waitFor();
  assert.deepEqual(await shell(page).getByRole('tablist',{name:'Feed source'}).getByRole('tab').allTextContents(),['For you','My jobs','Apply Status','Saved']);
  assert.equal(await shell(page).locator('main .rp-work-entry').count(),0,'Work tools do not displace the feed.');
  assert.equal(await shell(page).getByRole('button',{name:'Your activity',exact:true}).count(),0);
  await page.waitForFunction(()=>document.querySelectorAll('.rp-genres button')[1]?.textContent==='Electrical');
  await shell(page).getByRole('button',{name:'Like post',exact:true}).click();await shell(page).getByRole('button',{name:'Unlike post',exact:true}).waitFor();
  await shell(page).getByRole('button',{name:'Your interests',exact:true}).click();await shell(page).locator('.rp-post').first().waitFor();
  const liked=await api('/repaidians/feed?kind=post&mode=liked',alice);assert.deepEqual(liked.items.map(item=>item.id),[publication.item.id]);
  for(const width of [320,390,473])for(const theme of ['light','dark'])for(const text of [100,200]){
    await page.setViewportSize({width,height:850});await page.evaluate(({theme,text})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=text+'%';},{theme,text});
    await shell(page).locator('.rp-post-media img').waitFor();
    const bounds=await shell(page).locator('.rp-post').first().evaluate(card=>{
      const frame=card.querySelector('.rp-post-media'),image=frame.querySelector('img'),c=card.getBoundingClientRect(),f=frame.getBoundingClientRect(),i=image.getBoundingClientRect();
      return {left:f.left-c.left,right:c.right-f.right,contained:i.left>=f.left-1&&i.right<=f.right+1&&i.top>=f.top-1&&i.bottom<=f.bottom+1,fit:getComputedStyle(image).objectFit,overflow:card.scrollWidth>card.clientWidth+1};
    });
    assert.ok(Math.abs(bounds.left-bounds.right)<2,JSON.stringify({width,theme,text,bounds}));assert.ok(bounds.contained);assert.equal(bounds.fit,'contain');assert.equal(bounds.overflow,false);
  }
  await page.setViewportSize({width:390,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await audit(page);
  await shell(page).getByRole('tab',{name:'My jobs',exact:true}).click();await shell(page).getByRole('region',{name:'My jobs',exact:true}).waitFor();
  await shell(page).getByRole('tab',{name:'Apply Status',exact:true}).click();await shell(page).getByRole('region',{name:'Apply Status',exact:true}).waitFor();
  await profile(page);assert.equal(await shell(page).locator('.rp-profile .rp-account-settings').count(),0,'Settings are in the drawer.');
  assert.equal(await shell(page).getByText('Professional details shared by this member.',{exact:true}).count(),0);
  await shell(page).locator('.rp-portfolio-tabs').getByRole('button',{name:'Photos',exact:true}).waitFor();
  await shell(page).getByRole('button',{name:'Open Work and market business suite',exact:true}).waitFor();
  await shell(page).getByText('Edit profile',{exact:true}).click();await shell(page).getByLabel('Headline',{exact:true}).fill('An unsaved headline must survive availability changes.');
  const status=shell(page).getByRole('switch',{name:'Ready for work',exact:true});assert.equal(await status.getAttribute('aria-checked'),'false');
  let release,reached;const barrier=new Promise(resolve=>{release=resolve;}),requestReached=new Promise(resolve=>{reached=resolve;});releaseReads.push(release);
  const delayed=async route=>{if(route.request().method()!=='PATCH')return route.fallback();assert.deepEqual(route.request().postDataJSON(),{workStatus:'open_to_work'});const response=await route.fetch({url:apiOrigin+'/repaidians/profile'});reached();await barrier;await route.fulfill({response});};
  await context.route('**/api/repaidians/profile',delayed);await status.click();await requestReached;assert.equal(await status.isDisabled(),true);assert.equal(await status.getAttribute('aria-checked'),'false','Availability waits for confirmed persistence.');
  release();await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='true');await context.unroute('**/api/repaidians/profile',delayed);
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.workStatus,'open_to_work');
  assert.equal(await shell(page).getByLabel('Headline',{exact:true}).inputValue(),'An unsaved headline must survive availability changes.');
  await shell(page).locator('.rp-profile-header').getByRole('img',{name:'Ready for work',exact:true}).waitFor();
  const fail=route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Temporarily unavailable. Retry your status update.'})}):route.fallback();
  await context.route('**/api/repaidians/profile',fail);await status.click();await shell(page).locator('.rp-work-status-control [role=alert]').waitFor();assert.equal(await status.getAttribute('aria-checked'),'true');await context.unroute('**/api/repaidians/profile',fail);
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.workStatus,'open_to_work','A failed write leaves persisted availability unchanged.');
  let drawer=await settings(page);await drawer.getByLabel('Allow messages from',{exact:true}).selectOption('following');await drawer.getByRole('button',{name:'Save settings',exact:true}).click();await drawer.getByText('Privacy and notification settings saved.',{exact:true}).waitFor();assert.equal((await api('/repaidians/settings',alice)).settings.messagePrivacy,'following');
  await drawer.getByRole('checkbox',{name:/Personalized work discovery/}).uncheck();await drawer.getByText('Personalized work discovery updated.',{exact:true}).waitFor();await audit(page,'.rp-options-drawer');
  await page.keyboard.press('Escape');assert.equal(await drawer.count(),0);assert.equal(await shell(page).getByRole('button',{name:'Open profile tools and settings',exact:true}).evaluate(button=>button===document.activeElement),true);
  await nav(page,'Home');await shell(page).getByRole('tab',{name:'For you',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.rp-genres button')[1]?.textContent==='Cleaning');
  application=await api('/operations/contractor/hiring/applications/'+application.id+'/view',bob,'POST',{expected_version:application.version,action:'profile_viewed',request_id:randomUUID()});
  await shell(page).getByRole('button',{name:'Notifications',exact:true}).click();
  await shell(page).locator('.rp-notification-row').filter({hasText:'Your profile was viewed'}).click();
  await shell(page).getByRole('region',{name:'Apply Status',exact:true}).waitFor();
  const timeline=page.getByRole('dialog',{name:'Application timeline',exact:true});
  if(!await timeline.count())await shell(page).getByRole('button',{name:'View timeline',exact:true}).click();
  await timeline.waitFor();await timeline.getByText('Profile viewed',{exact:true}).waitFor();await timeline.getByRole('button',{name:'Close dialog',exact:true}).click();
  application=await api('/operations/contractor/hiring/applications/'+application.id+'/decision',bob,'POST',{expected_version:application.version,project_version:project.version,action:'offer',daily_rate_paise:123400,terms:'Eight hours daily, weekly payment and agreed safety equipment.'});
  project=(await api('/operations/contractor/workspace',alice)).projects.find(row=>row.id===project.id);
  await api('/operations/contractor/projects/'+project.id+'/commands',alice,'POST',{expected_version:project.version,action:'accept',target_id:application.invitation_id});
  processUpdates();
  const announcement=(await api('/repaidians/notifications',bob)).notifications.find(note=>note.type==='placement');assert.ok(announcement,'A real accepted placement creates its follower notification.');
  const placement=await api('/repaidians/placements/'+announcement.targetId,bob);assert.equal('dailyRatePaise' in placement,false,'Pay is private until independently shared.');assert.equal(JSON.stringify(placement).includes('PRIVATE exact worksite'),false);
  await nav(page,'Home');await shell(page).getByRole('tab',{name:'For you',exact:true}).click();
  await shell(page).getByRole('button',{name:'View Bob Carpenter profile',exact:true}).first().click();await shell(page).locator('.rp-profile-header').getByRole('img',{name:'Ready for work',exact:true}).waitFor();assert.equal(await shell(page).getByRole('switch',{name:'Ready for work',exact:true}).count(),0,'Other members availability is read-only.');
  await profile(page);drawer=await settings(page);
  await page.evaluate(({token,id})=>{localStorage.setItem('repaido.token',token);window.dispatchEvent(new CustomEvent('repaidians-preview-account',{detail:id}));},{token:bob.token,id:bob.user.id});
  await shell(page).locator('.rp-profile-title').getByText(bob.user.name,{exact:true}).waitFor();assert.equal(await page.locator('.rp-options-drawer').count(),0,'An account switch closes private tools.');await profile(page);await shell(page).locator('.rp-profile-details').getByText('@'+(await api('/repaidians/members/'+bob.user.id,bob)).member.handle,{exact:true}).waitFor();
  assert.equal(await shell(page).getByLabel('Headline',{exact:true}).count(),1); // The edit form stays rendered but closed.
  assert.equal(await shell(page).getByLabel('Headline',{exact:true}).inputValue(),'','Another account does not inherit an unsaved profile draft.');
  await shell(page).getByRole('button',{name:'Notifications',exact:true}).click();
  await shell(page).locator('.rp-notification-row').filter({hasText:announcement.title}).click();
  const milestone=page.getByRole('dialog',{name:'A new work milestone',exact:true});await milestone.waitFor();await milestone.getByText('Actual electrical team opening',{exact:true}).waitFor();
  assert.equal(await milestone.getByText('Shared daily rate',{exact:true}).count(),0);assert.equal((await milestone.innerText()).includes('1,234'),false);
  await milestone.getByRole('button',{name:'Congratulations',exact:true}).click();await milestone.getByText('Your congratulations have been sent.',{exact:true}).waitFor();
  assert.equal((await api('/repaidians/placements/'+announcement.targetId,bob)).congratulated,true);
  assert.equal((await api('/repaidians/notifications',alice)).notifications.filter(note=>note.type==='congratulation'&&note.targetId===announcement.targetId).length,1);
  await milestone.getByRole('button',{name:'Close dialog',exact:true}).click();
  assert.deepEqual(errors,[]);success=true;
  await page.screenshot({path:resolve(artifacts,'profile.png')});
  console.log(JSON.stringify({passed:true,checks:['real liked feed','centered media across 12 phone/theme/text variants','profile availability persistence and failed-write recovery','unsaved draft preservation','drawer privacy and work opt-ins','personalized rail and opt-out fallback','jobs/status navigation','account isolation','real application update timeline','accepted placement notification with private pay and congratulations','WCAG AA audits'],artifacts},null,2));
}catch(error){if(browser){for(const context of browser.contexts())for(const page of context.pages()){try{await page.screenshot({path:resolve(artifacts,'failure.png')});await writeFile(resolve(artifacts,'failure.html'),await page.content());}catch{}}}throw error;
}finally{for(const release of releaseReads)release();if(browser)await browser.close();if(server)server.kill('SIGTERM');await writeFile(resolve(artifacts,'backend.log'),serverLog);if(!success)console.error('Social navigation artifacts: '+artifacts);}
