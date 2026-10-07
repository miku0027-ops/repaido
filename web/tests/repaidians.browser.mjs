import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Social responses are never mocked. The route below forwards Vite's /api
// requests to this test's real isolated SQLite API, including protected media.
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const backend=resolve(web,'../backend');
const work=await mkdtemp(resolve(tmpdir(),'repaidians-e2e-'));
const db=resolve(work,'community.db');
const python=process.env.REPAIDIANS_TEST_PYTHON||resolve(backend,'.venv/bin/python');
const origin=process.env.REPAIDIANS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const port=Number(process.env.REPAIDIANS_TEST_PORT||8019),apiOrigin='http://127.0.0.1:'+port;
const errors=[];
const releaseReads=[];
let server,browser,serverLog='',succeeded=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fixture(kind,id,body){
  const code='import json,sqlite3,sys\nc=sqlite3.connect(sys.argv[1],timeout=15)\nc.execute("INSERT INTO operation_records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",(sys.argv[2],sys.argv[3],sys.argv[4]))\nc.commit()\nc.close()';
  const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(body)],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
function nativeFixture(kind,id,body){
  // Use the same transactional write and source index hook as native APIs.
  const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nmain.operations_store.run(lambda u:u.put(sys.argv[2],sys.argv[3],json.loads(sys.argv[4])))';
  const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(body)],{cwd:backend,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
function grantPro(account){
  fixture('rp_subscriptions',account.user.id,{userId:account.user.id,plan:'pro',amountPaise:19900,provider:'razorpay',startsAt:Date.now()-60000,endsAt:Date.now()+86400000,status:'active',paymentId:'test-only',attemptId:'test-only'});
}
function storedRecord(kind,id){
  const code='import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nrow=c.execute("SELECT body FROM operation_records WHERE kind=? AND id=?",(sys.argv[2],sys.argv[3])).fetchone()\nprint(row[0] if row else "null")\nc.close()';
  const result=spawnSync(python,['-c',code,db,kind,id],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
function expireTrial(account){
  const trial=storedRecord('rp_trials',account.user.id);
  assert.ok(trial,'The real server must create the once-per-account trial.');
  fixture('rp_trials',account.user.id,{...trial,startsAt:Date.now()-61*86400000,endsAt:Date.now()-1000});
}
async function api(path,account,method='GET',body,expected=200,headers={}){
  const response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body&&!Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>({}));
  assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(data));return data;
}
async function register(name){
  return api('/auth/register',null,'POST',{name,email:name.toLowerCase().replace(/ /g,'.')+'@community.test',password:'isolated-test-password'},201);
}
async function upload(account,file,mime){
  const {url,kind,alt}=await api('/repaidians/media',account,'POST',await readFile(file),201,{'Content-Type':mime});
  return {url,kind,alt};
}
async function publication(account,draft){
  const result=await api('/repaidians/publications',account,'POST',{...draft,clientId:randomUUID()},201);
  return result.item||result;
}
async function newPage(account,width=390,clockMs){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'});
  // Shared workspace edits must not restart a running browser scenario.
  await context.routeWebSocket('**',socket=>socket.close());
  await context.addInitScript(({token,clockMs})=>{
    if(clockMs)Date.now=()=>clockMs;
    if(token)localStorage.setItem('repaido.token',token);
    // A prior browser prototype must not become a public post or entitlement.
    localStorage.setItem('repaidians.v1.subscription.guest',JSON.stringify({plan:'demo-pro',provider:'mock',startsAt:0,endsAt:9999999999999}));
    localStorage.setItem('repaidians.v1.community',JSON.stringify({version:1,posts:[{id:'old-local-mock',caption:'OLD MOCK MUST NOT APPEAR'}]}));
  },{token:account?.token||'',clockMs});
  await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    const response=await route.fetch({url:apiOrigin+url.pathname+url.search});
    await route.fulfill({response});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/tests/repaidians-preview.html');
  await page.getByRole('dialog',{name:'Repaidians community',exact:true}).waitFor();
  await page.locator('.rp-loading').waitFor({state:'hidden'});
  return page;
}
async function delayedRealRead(page,path){
  let release,captured,finished;
  const barrier=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{captured=resolve;}),done=new Promise(resolve=>{finished=resolve;});
  releaseReads.push(release);
  const pattern='**/api'+path+'*';
  const handler=async route=>{
    const url=new URL(route.request().url());
    const response=await route.fetch({url:apiOrigin+url.pathname+url.search});
    captured(await response.json());await barrier;
    await route.fulfill({response});finished();
  };
  await page.context().route(pattern,handler);
  return {reached,release,done,remove:()=>page.context().unroute(pattern,handler)};
}
async function switchPreviewAccount(page,account){
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/repaidians/state'&&response.request().headers().authorization==='Bearer '+account.token);
  await page.evaluate(({id,token})=>{localStorage.setItem('repaido.token',token);window.dispatchEvent(new CustomEvent('repaidians-preview-account',{detail:id}));},{id:account.user.id,token:account.token});
  assert.equal((await(await response).json()).member.id,account.user.id);
  await shell(page).locator('.rp-loading').waitFor({state:'hidden'});
}
const shell=page=>page.getByRole('dialog',{name:'Repaidians community',exact:true});
async function nav(page,label){
  if(label==='Tenders')return shell(page).locator('.rp-toolbar').getByRole('button',{name:label,exact:true}).click();
  const mobile=shell(page).locator('.rp-bottom-nav').getByRole('button',{name:label,exact:true});
  if(await mobile.count())return mobile.click();
  return shell(page).locator('.rp-desktop-sidebar').getByRole('button',{name:label,exact:true}).click();
}
async function openWork(page){
  await nav(page,'My profile');
  await shell(page).getByRole('button',{name:'Open Work and market business suite',exact:true}).click();
}
async function layout(page){
  const issues=await shell(page).evaluate(root=>{
    const issues=[];
    if(root.scrollWidth>root.clientWidth+1)issues.push('community dialog overflows');
    for(const e of root.querySelectorAll('.rp-post,.rp-header,.rp-toolbar,.rp-tender,.rp-profile,.rp-compose'))
      if(e.getClientRects().length&&e.scrollWidth>e.clientWidth+1)issues.push('content overflow: '+e.className);
    for(const e of root.querySelectorAll('button')){
      if(!e.getClientRects().length)continue;
      const rect=e.getBoundingClientRect();
      if(rect.height<44)issues.push('target smaller than 44px: '+(e.getAttribute('aria-label')||e.textContent));
    }
    return issues;
  });assert.deepEqual(issues,[]);
}
async function audit(page){
  await page.addScriptTag({path:require.resolve('axe-core')});
  const result=await page.evaluate(async()=>window.axe.run(document.querySelector('.rp-shell'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  assert.deepEqual(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[]);
}
async function mediaLayout(page){
  const post=shell(page).locator('.rp-post').first();
  if(!await post.count())return;
  const image=post.locator('.rp-post-media img.rp-media').first();
  await image.waitFor();
  const bounds=await post.evaluate(article=>{
    const media=article.querySelector('.rp-post-media'),image=media?.querySelector('img.rp-media');
    if(!media||!image)return null;
    const card=article.getBoundingClientRect(),box=media.getBoundingClientRect(),picture=image.getBoundingClientRect();
    return {left:box.left-card.left,right:card.right-box.right,fit:getComputedStyle(image).objectFit,
      contained:picture.left>=box.left-1&&picture.right<=box.right+1&&picture.top>=box.top-1&&picture.bottom<=box.bottom+1};
  });
  assert.ok(bounds,'A shared photo has its own padded media region.');
  assert.equal(bounds.fit,'contain','Community photos preserve their original composition.');
  assert.ok(bounds.left>=8&&bounds.right>=8,'Photos keep visible gutters inside the feed card: '+JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.left-bounds.right)<2,'Media frame is centered within its feed card: '+JSON.stringify(bounds));
  assert.equal(bounds.contained,true,'Photo contents stay within the padded card region.');
}

try{
  const env={...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite',REPAIDO_COMMUNITY_MEDIA_DIR:resolve(work,'media'),REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''};
  server=spawn(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port',String(port)],{cwd:backend,env,stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>serverLog+=chunk.toString());
  for(let attempt=0;attempt<100;attempt++){
    if(server.exitCode!==null)throw new Error('Isolated backend could not start: '+serverLog);
    try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}
    if(attempt===99)throw new Error('Isolated backend was not ready: '+serverLog);
    await pause(200);
  }
  const alice=await register('Alice Electrician'),bob=await register('Bob Cleaning'),carol=await register('Carol Plumbing');
  for(const [account,trade] of [[alice,'electrician'],[bob,'cleaning'],[carol,'plumber']]){
    await api('/repaidians/state',account);
    await api('/repaidians/profile',account,'PATCH',{name:account.user.name,trade,bio:'Test account in an isolated community database.'});
  }
  const professional={headline:'Electrical specialist for homes and project teams',city:'Balasore',skills:['Wiring','Inspection'],experienceYears:7,workStatus:'open_to_work',professionalType:'specialist'};
  await api('/repaidians/profile',alice,'PATCH',professional);
  const professionalProfile=(await api('/repaidians/members/'+alice.user.id,bob)).member;
  for(const [key,value] of Object.entries(professional))assert.deepEqual(professionalProfile[key],value,'Professional profile persists '+key+'.');
  assert.equal(professionalProfile.professionalInfoSource,'profile');
  assert.equal(!!professionalProfile.reviewed,false,'Choosing a professional role does not grant a reviewed Repaido badge.');
  const professionalQuery='/repaidians/members?search=Alice&trade=electrician&city=balasore&workStatus=open_to_work&professionalType=specialist';
  assert.deepEqual((await api(professionalQuery,bob)).members.map(member=>member.id),[alice.user.id]);
  assert.deepEqual((await api(professionalQuery.replace('open_to_work','hiring'),bob)).members,[],'Professional discovery combines real profile and category filters.');
  const initial=await api('/repaidians/state',alice);
  assert.equal(initial.authenticated,true);assert.equal(initial.paymentsReady,false);
  assert.equal(initial.subscription.plan,'trial');assert.equal(initial.subscription.provider,'trial');assert.equal(initial.subscription.amountPaise,0);
  assert.equal(initial.trial.status,'active');assert.equal(initial.trial.endsAt-initial.trial.startsAt,60*86400000);
  assert.equal(initial.subscription.endsAt,initial.trial.endsAt);
  const trialEnd=initial.trial.endsAt;
  const login=await api('/auth/login',null,'POST',{email:alice.user.email,password:'isolated-test-password'});
  assert.equal(login.user.id,alice.user.id);alice.token=login.token;
  assert.equal((await api('/repaidians/state',alice)).trial.endsAt,trialEnd,'Another session must not restart an account trial.');
  assert.equal((await api('/repaidians/subscription',alice)).trial.status,'active');
  assert.equal((await api('/repaidians/usage',alice,'POST',{active:true})).subscription.plan,'trial');
  const quotaDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const signedSubject='user_'+createHash('sha256').update(alice.user.id).digest('hex').slice(0,32);
  fixture('rp_usage',signedSubject,{day:quotaDay,usedMs:900000,leaseUntil:0});
  assert.equal((await api('/repaidians/state',alice)).subscription.plan,'trial','A trial has unlimited browsing even when the guest-style quota record is exhausted.');
  assert.deepEqual(initial.data.posts,[],'A new database must not generate sample posts.');
  await api('/repaidians/subscription/order',alice,'POST',undefined,503);
  const avatar=await upload(alice,resolve(web,'public/images/electrical.jpg'),'image/jpeg');
  await api('/repaidians/profile',alice,'PATCH',{avatarUrl:avatar.url});
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.avatarUrl,avatar.url);
  assert.equal((await fetch(apiOrigin+avatar.url,{headers:{Authorization:'Bearer '+bob.token}})).status,200,'Trial member profile photos are shared after attachment to the profile.');
  await api('/repaidians/media',alice,'POST',Buffer.alloc(8*1024*1024+1),413,{'Content-Type':'image/jpeg'});
  const photo=await upload(bob,resolve(web,'public/images/cleaning.jpg'),'image/jpeg');
  const bobPost=await publication(bob,{kind:'post',caption:'Shared cleaning work from a real API.',trade:'cleaning',visibility:'public',media:[{...photo,alt:'Cleaning a tile wall'}]});
  const privatePost=await publication(bob,{kind:'post',caption:'Only cleaning members can see this scope.',trade:'cleaning',visibility:'trade',media:[{...photo,alt:'Trade-only cleaning scope'}]});
  const bobStory=await publication(bob,{kind:'story',caption:'Fresh work story.',trade:'cleaning',visibility:'public',media:[{...photo,alt:'Cleaning story'}]});
  assert.ok(bobStory.expiresAt-bobStory.createdAt===86400000);
  assert.equal((await api('/repaidians/feed?kind=post&trade=all&mode=all',alice)).items.some(item=>item.id===privatePost.id),false);
  await api('/repaidians/comments/'+privatePost.id,alice,'POST',{text:'Hidden post comment',clientId:randomUUID()},404);
  const hiddenMedia=await upload(bob,resolve(web,'public/images/bathroom.jpg'),'image/jpeg');
  await publication(bob,{kind:'post',caption:'Private media.',trade:'cleaning',visibility:'trade',media:[{...hiddenMedia,alt:'Private image'}]});
  const inaccessible=await fetch(apiOrigin+hiddenMedia.url,{headers:{Authorization:'Bearer '+alice.token}});assert.equal(inaccessible.status,404);

  const clip=resolve(work,'work.webm');
  const ffmpeg=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0xd73484:s=360x640:d=3','-an','-c:v','libvpx','-y',clip],{encoding:'utf8'});
  assert.equal(ffmpeg.status,0,'ffmpeg fixture creation: '+ffmpeg.stderr);
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  await mkdir(resolve(web,'test-results'),{recursive:true});
  const page=await newPage(alice);
  await shell(page).getByText('Shared cleaning work from a real API.',{exact:false}).waitFor();
  assert.equal(await shell(page).getByText('OLD MOCK MUST NOT APPEAR',{exact:false}).count(),0);
  assert.equal(await shell(page).locator('.rp-post').count(),1);
  const trialBadge=shell(page).getByRole('button',{name:/^Free trial:/});await trialBadge.waitFor();
  assert.match(await trialBadge.getAttribute('aria-label'),/All Repaidians features included/);
  assert.ok((await trialBadge.getAttribute('aria-label')).includes(new Date(trialEnd).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST'),'The trial badge names the exact server-owned expiry in India time.');
  await trialBadge.click();
  const membership=page.getByRole('dialog',{name:'Repaidians membership',exact:true});await membership.waitFor();
  await membership.getByText('₹199/month after your trial',{exact:false}).waitFor();
  await membership.getByText('No automatic charge',{exact:false}).waitFor();
  assert.equal(await membership.getByRole('button',{name:'Pay ₹199 for one month',exact:true}).count(),0,'Joining the trial never starts a checkout.');
  await membership.getByRole('button',{name:'Close dialog',exact:true}).click();
  assert.equal(storedRecord('rp_subscriptions',alice.user.id),null,'An account trial does not invent a captured paid subscription.');
  assert.equal(storedRecord('rp_subscriptions',bob.user.id),null);
  await mediaLayout(page);
  await shell(page).getByRole('button',{name:'Expand photo',exact:true}).click();
  const photoViewer=page.getByRole('dialog',{name:'Photo by Bob Cleaning',exact:true});await photoViewer.waitFor();
  assert.equal(await photoViewer.locator('img.rp-media').evaluate(image=>getComputedStyle(image).objectFit),'contain');
  await photoViewer.getByRole('button',{name:'Close photo',exact:true}).click();
  await shell(page).getByRole('button',{name:'Expand photo',exact:true}).click();
  await page.keyboard.press('Escape');await photoViewer.waitFor({state:'hidden'});
  const options=shell(page).getByRole('button',{name:'Post options',exact:true});await options.click();
  await shell(page).getByRole('button',{name:'Report post',exact:true}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await options.getAttribute('aria-expanded'),'false');
  await options.click();await shell(page).locator('.rp-wordmark').click();
  assert.equal(await options.getAttribute('aria-expanded'),'false','Post tools dismiss when focus moves outside their menu.');
  await shell(page).getByRole('button',{name:'Like post',exact:true}).click();await shell(page).getByRole('button',{name:'Unlike post',exact:true}).waitFor();
  assert.equal((await api('/repaidians/feed?kind=post',bob)).items.find(p=>p.id===bobPost.id).likeCount,1);
  await shell(page).getByRole('button',{name:'Save post',exact:true}).click();
  await shell(page).getByRole('button',{name:'Open comments',exact:true}).click();
  const comments=page.getByRole('dialog',{name:'Comments',exact:true});
  await comments.getByLabel('Your comment',{exact:true}).fill('A real shared scope discussion.');
  await comments.getByRole('button',{name:'Post comment',exact:true}).click();await comments.getByText('A real shared scope discussion.',{exact:true}).waitFor();
  await comments.getByRole('button',{name:'Close dialog',exact:true}).click();
  assert.equal((await api('/repaidians/comments/'+bobPost.id,bob)).comments[0].text,'A real shared scope discussion.');
  await shell(page).getByRole('button',{name:'View Bob Cleaning profile',exact:true}).first().click();
  await shell(page).getByRole('button',{name:'Follow',exact:true}).click();await shell(page).getByRole('button',{name:'Following',exact:true}).waitFor();
  assert.equal((await api('/repaidians/members/'+bob.user.id,bob)).stats.followers,1);
  await shell(page).getByRole('button',{name:'Back to community',exact:true}).click();
  await shell(page).getByRole('button',{name:'View Bob Cleaning stories',exact:true}).click();
  const story=page.getByRole('dialog',{name:'Story by Bob Cleaning',exact:true});await story.waitFor();
  assert.equal(await story.getByRole('button',{name:'Play story',exact:true}).count(),1,'Reduced motion starts stories paused.');
  await story.getByRole('button',{name:'Close story',exact:true}).click();

  await page.reload();await shell(page).getByText('Shared cleaning work from a real API.',{exact:false}).waitFor();
  await shell(page).getByRole('button',{name:'Create',exact:true}).click();
  let studio=page.getByRole('dialog',{name:'Publishing studio',exact:true});
  await studio.getByLabel('Upload publication media',{exact:true}).setInputFiles(resolve(web,'public/images/electrical.jpg'));
  await studio.getByLabel('Caption & visual description',{exact:true}).fill('Electrical portfolio uploaded to the shared backend.');
  await studio.getByRole('button',{name:'Share with Repaidians',exact:true}).click();await studio.waitFor({state:'hidden'});
  await shell(page).getByText('Electrical portfolio uploaded to the shared backend.',{exact:false}).waitFor();
  await page.reload();await shell(page).getByText('Electrical portfolio uploaded to the shared backend.',{exact:false}).waitFor();
  const alicePost=(await api('/repaidians/feed?kind=post',bob)).items.find(p=>p.authorId===alice.user.id);assert.ok(alicePost);
  const bobPage=await newPage(bob);await shell(bobPage).getByText('Electrical portfolio uploaded to the shared backend.',{exact:false}).waitFor();
  await shell(page).getByRole('button',{name:'View Bob Cleaning profile',exact:true}).first().click();
  await shell(page).getByRole('button',{name:'Message',exact:true}).click();
  const message=page.getByRole('dialog',{name:'Message Bob Cleaning',exact:true});
  await message.getByLabel('Message',{exact:true}).fill('Please confirm the scope in this shared thread.');
  await message.getByRole('button',{name:'Send message',exact:true}).click();await message.getByText('Please confirm the scope in this shared thread.',{exact:true}).waitFor();
  await message.getByRole('button',{name:'Close dialog',exact:true}).click();
  assert.equal((await api('/repaidians/messages/'+alice.user.id,bob)).messages[0].text,'Please confirm the scope in this shared thread.');
  assert.equal((await api('/repaidians/messages/'+bob.user.id,carol)).messages.length,0,'Unrelated accounts cannot read an existing private thread.');
  assert.equal((await api('/repaidians/threads',bob)).threads.length,1);
  await shell(bobPage).getByRole('button',{name:'Open messages',exact:true}).click();
  await shell(bobPage).locator('.rp-inbox').getByRole('button').filter({hasText:'Alice Electrician'}).click();
  const received=bobPage.getByRole('dialog',{name:'Message Alice Electrician',exact:true});
  await received.getByText('Please confirm the scope in this shared thread.',{exact:true}).waitFor();
  await received.getByLabel('Message',{exact:true}).fill('Confirmed. This reply comes from a second account.');
  await received.getByRole('button',{name:'Send message',exact:true}).click();
  await received.getByText('Confirmed. This reply comes from a second account.',{exact:true}).waitFor();
  await received.getByRole('button',{name:'Close dialog',exact:true}).click();
  assert.ok((await api('/repaidians/messages/'+bob.user.id,alice)).messages.some(m=>m.senderId===bob.user.id&&m.text==='Confirmed. This reply comes from a second account.'));
  assert.ok((await api('/repaidians/notifications',bob)).notifications.length>=3);
  await api('/repaidians/publications/'+alicePost.id,bob,'DELETE',undefined,404);
  assert.ok((await api('/repaidians/feed?kind=post',bob)).items.some(p=>p.id===alicePost.id));
  await nav(page,'Home');
  await shell(page).getByRole('button',{name:'Create',exact:true}).click();studio=page.getByRole('dialog',{name:'Publishing studio',exact:true});
  await studio.getByRole('button',{name:'Work video',exact:true}).click();
  await studio.getByLabel('Upload publication media',{exact:true}).setInputFiles(clip);
  await studio.getByLabel('Caption & visual description',{exact:true}).fill('A work reel stored on the server.');
  await studio.getByRole('button',{name:'Share with Repaidians',exact:true}).click();await studio.waitFor({state:'hidden'});await shell(page).locator('.rp-reel video').waitFor();
  await page.waitForFunction(()=>document.querySelector('.rp-reel video')?.readyState>=2);
  assert.equal(await shell(page).locator('.rp-reel video').evaluate(video=>video.paused),true,'Reduced motion starts reels paused.');
  await shell(page).getByRole('button',{name:'Play work video',exact:true}).click();await shell(page).getByRole('button',{name:'Pause work video',exact:true}).waitFor();
  await shell(page).getByRole('button',{name:'Pause work video',exact:true}).click();
  await page.reload();await nav(page,'Works');await shell(page).locator('.rp-reel video').waitFor();
  await page.waitForFunction(()=>document.querySelector('.rp-reel video')?.readyState>=2);
  assert.equal((await api('/repaidians/feed?kind=reel',bob)).items[0].caption,'A work reel stored on the server.');
  await shell(page).getByRole('button',{name:'Book a service',exact:true}).click();await page.getByLabel('Home search',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Home search',{exact:true}).inputValue(),'Electrical');
  await page.getByRole('button',{name:'Open Repaidians community',exact:true}).click();await shell(page).waitFor();
  const legacyHandle='historical.worker.name.12345678';assert.equal(legacyHandle.length,31);
  fixture('rp_members',alice.user.id,{...storedRecord('rp_members',alice.user.id),handle:legacyHandle});
  await page.reload();
  await nav(page,'My profile');await shell(page).getByText('Edit profile',{exact:true}).click();
  assert.equal(await shell(page).getByLabel('Handle',{exact:true}).inputValue(),legacyHandle);
  const profileCommands=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/repaidians/profile'&&r.method()==='PATCH')profileCommands.push(r.postDataJSON());});
  await shell(page).getByLabel('Headline',{exact:true}).fill('Electrical specialist available for project teams');
  await shell(page).getByLabel('City',{exact:true}).fill('Balasore');
  await shell(page).locator('.rp-edit-profile form').getByLabel(/^Skills/).fill('Wiring, Inspection');
  await shell(page).getByLabel('Years of experience',{exact:true}).fill('8');
  await shell(page).locator('.rp-edit-profile form').getByLabel(/^Work status/).selectOption('open_to_work');
  await shell(page).locator('.rp-edit-profile form').getByLabel(/^Professional type/).selectOption('specialist');
  await shell(page).getByRole('button',{name:'Save profile',exact:true}).click();
  await shell(page).getByText('Profile saved.',{exact:true}).waitFor();
  assert.equal(profileCommands.length,1);assert.equal('handle' in profileCommands[0],false,'An unchanged legacy handle does not block other edits.');
  const handleField=shell(page).getByLabel('Handle',{exact:true});
  await handleField.fill('paramesh electrician');
  await shell(page).getByLabel('Headline',{exact:true}).fill('This draft must survive handle validation.');
  await shell(page).locator('#rp-handle-error').getByText('Handles cannot contain spaces. Use dots or underscores between words.',{exact:true}).waitFor();
  await shell(page).getByRole('button',{name:'Save profile',exact:true}).click();
  assert.equal(await handleField.getAttribute('aria-invalid'),'true');assert.equal(await handleField.evaluate(e=>e===document.activeElement),true);
  assert.equal(profileCommands.length,1,'Invalid input is caught before any profile write.');
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.headline,'Electrical specialist available for project teams');
  assert.equal(await shell(page).getByLabel('Headline',{exact:true}).inputValue(),'This draft must survive handle validation.');
  await shell(page).getByRole('button',{name:'Use @paramesh_electrician',exact:true}).click();
  assert.equal(await handleField.inputValue(),'paramesh_electrician');assert.equal(profileCommands.length,1,'A suggestion is never an automatic rename.');
  await shell(page).getByLabel('Headline',{exact:true}).fill('Electrical specialist available for project teams');
  await shell(page).getByRole('button',{name:'Save profile',exact:true}).click();
  await shell(page).getByText('Profile saved.',{exact:true}).waitFor();
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.handle,'paramesh_electrician');
  const takenHandle=(await api('/repaidians/members/'+bob.user.id,alice)).member.handle;
  await handleField.fill(takenHandle);await shell(page).getByRole('button',{name:'Save profile',exact:true}).click();
  await shell(page).locator('#rp-handle-error').getByText('This handle is already in use. Choose another.',{exact:true}).waitFor();
  assert.equal(await handleField.evaluate(e=>e===document.activeElement),true);assert.equal(await handleField.inputValue(),takenHandle);
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.handle,'paramesh_electrician');
  await handleField.fill('alice.electrical');
  await shell(page).getByRole('button',{name:'Save profile',exact:true}).click();
  await shell(page).locator('.rp-profile').getByText('@alice.electrical',{exact:true}).waitFor();
  await shell(page).getByRole('button',{name:'Open profile tools and settings',exact:true}).click();
  await page.getByRole('dialog',{name:'Profile tools and settings',exact:true}).getByRole('button',{name:/^Privacy & notifications/}).click();
  const settingsDrawer=page.getByRole('dialog',{name:'Privacy and notifications',exact:true});
  await settingsDrawer.getByLabel('Allow messages from',{exact:true}).selectOption('following');
  await settingsDrawer.getByLabel('Likes on my publications',{exact:true}).uncheck();
  await settingsDrawer.getByRole('button',{name:'Save settings',exact:true}).click();
  await settingsDrawer.getByText('Privacy and notification settings saved.',{exact:true}).waitFor();
  const settings=(await api('/repaidians/settings',alice)).settings;
  assert.equal(settings.messagePrivacy,'following');assert.equal(settings.likeNotifications,false);
  // Restore the default so later message/reply tests remain independent.
  await settingsDrawer.getByLabel('Allow messages from',{exact:true}).selectOption('everyone');
  await settingsDrawer.getByLabel('Likes on my publications',{exact:true}).check();
  await settingsDrawer.getByRole('button',{name:'Save settings',exact:true}).click();
  await settingsDrawer.getByText('Privacy and notification settings saved.',{exact:true}).waitFor();
  await settingsDrawer.getByRole('button',{name:'Close profile tools',exact:true}).click();
  await shell(page).getByLabel('Profile photo',{exact:true}).setInputFiles(resolve(web,'public/images/electrical.jpg'));
  await page.waitForFunction(()=>!document.querySelector('.rp-profile input[type="file"]')?.disabled);
  const uploadedProfile=(await api('/repaidians/members/'+alice.user.id,bob)).member;
  assert.notEqual(uploadedProfile.avatarUrl,avatar.url,'Profile-photo control uploads and attaches a new real image.');
  avatar.url=uploadedProfile.avatarUrl;
  await shell(page).getByRole('button',{name:'Remove profile photo',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.rp-profile input[type="file"]')?.disabled);
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.avatarUrl,'');
  const editedProfile=(await api('/repaidians/members/'+alice.user.id,bob)).member;
  assert.equal(editedProfile.headline,'Electrical specialist available for project teams');assert.equal(editedProfile.experienceYears,8);
  await page.reload();await nav(page,'My profile');
  await shell(page).getByText('Electrical specialist available for project teams',{exact:true}).waitFor();
  assert.equal(await shell(page).getByText('Professional details shared by this member.',{exact:true}).count(),0);
  await shell(page).locator('.rp-portfolio-tabs').getByRole('button',{name:'Works',exact:true}).click();
  const selectedReel=(await api('/repaidians/feed?kind=reel',bob)).items[0];
  await shell(page).getByRole('button',{name:'Open video by Alice Electrician: '+selectedReel.caption,exact:true}).click();
  const reelPublication=page.getByRole('dialog',{name:'Publication',exact:true});await reelPublication.waitFor();
  await reelPublication.getByText(selectedReel.caption,{exact:false}).waitFor();
  await reelPublication.locator('video.rp-media').waitFor();
  assert.equal(await reelPublication.locator('video.rp-media').getAttribute('aria-label'),selectedReel.media.alt,'A portfolio reel opens the exact selected publication and media.');
  await reelPublication.getByRole('button',{name:'Close dialog',exact:true}).click();

  for(const width of [320,390,430,524,1280]){
    await page.setViewportSize({width,height:850});await nav(page,'Home');await layout(page);await mediaLayout(page);
    if(width===1280)await page.screenshot({path:resolve(web,'test-results/repaidians-desktop.png')});
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');await layout(page);await mediaLayout(page);
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
  }
  await page.setViewportSize({width:390,height:850});await audit(page);
  await page.screenshot({path:resolve(web,'test-results/repaidians-phone.png')});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await audit(page);
  await page.screenshot({path:resolve(web,'test-results/repaidians-dark.png')});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');await layout(page);await mediaLayout(page);
  await page.evaluate(()=>document.documentElement.style.fontSize='100%');
  await nav(page,'Search');await shell(page).getByLabel('Search Repaidians',{exact:true}).fill('Alice');
  await shell(page).locator('.rp-search-results').getByText('Alice Electrician',{exact:true}).waitFor();
  assert.equal(await shell(page).locator('.rp-search-results').getByText('Bob Cleaning',{exact:true}).count(),0,'Server search must filter results.');
  await shell(page).locator('.rp-professional-filters > summary').click();
  await shell(page).locator('.rp-professional-filters').getByLabel(/^Trade/).selectOption('electrician');
  await shell(page).getByLabel('City',{exact:true}).fill('Balasore');
  await shell(page).locator('.rp-professional-filters').getByLabel(/^Work status/).selectOption('open_to_work');
  await shell(page).locator('.rp-professional-filters').getByLabel(/^Professional type/).selectOption('specialist');
  await shell(page).locator('.rp-search-results').getByText('Alice Electrician',{exact:true}).waitFor();
  await shell(page).locator('.rp-professional-filters').getByLabel(/^Work status/).selectOption('hiring');
  await shell(page).getByText('No matching professionals yet.',{exact:true}).waitFor();
  await shell(page).locator('.rp-professional-filters').getByLabel(/^Work status/).selectOption('open_to_work');
  await shell(page).locator('.rp-search-results').getByText('Electrical specialist available for project teams',{exact:true}).waitFor();
  await layout(page);await audit(page);
  await page.evaluate(()=>document.documentElement.dataset.theme='light');await layout(page);await audit(page);
  const tender=await publication(bob,{kind:'tender',caption:'A real crew brief created by a test member.',title:'Cleaning crew request',trade:'cleaning',visibility:'public',media:[],location:'Balasore',budgetRupees:650,slots:3,deadline:Date.now()+86400000,contact:'Contact the project owner through their Repaidians profile.'});
  await page.reload();await nav(page,'Tenders');await shell(page).getByRole('button',{name:/Submit interest|Submit bid/}).click();
  await shell(page).getByRole('button',{name:'Interest submitted',exact:true}).waitFor();
  assert.equal((await api('/repaidians/bids/'+tender.id,bob)).bids.length,1);
  await shell(page).getByRole('button',{name:'Contact',exact:true}).click();await shell(page).getByText('Contact the project owner through their Repaidians profile.',{exact:true}).waitFor();
  await api('/repaidians/publications/'+alicePost.id,alice,'DELETE');
  assert.equal((await api('/repaidians/feed?kind=post',bob)).items.some(p=>p.id===alicePost.id),false);

  await page.goto(origin+'/?noSplash=1&tab=explore');
  const launcher=page.getByRole('button',{name:'Open Repaidians community',exact:true});await launcher.waitFor();
  const placeBefore=await page.evaluate(()=>localStorage.getItem('repaido.place'));
  await launcher.click();await shell(page).waitFor();
  await shell(page).getByRole('button',{name:'Close Repaidians',exact:true}).click();await launcher.waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('repaido.place')),placeBefore,'Closing the community preserves the customer location.');

  const skewed=await newPage(carol,390,new Date('2040-01-01T00:00:00Z').getTime());
  await shell(skewed).getByRole('button',{name:/^Free trial:/}).waitFor();
  await shell(skewed).getByText('Shared cleaning work from a real API.',{exact:false}).waitFor();
  await shell(skewed).getByRole('button',{name:'Create',exact:true}).click();
  await skewed.getByRole('dialog',{name:'Publishing studio',exact:true}).waitFor();
  expireTrial(carol);
  await shell(skewed).getByText('Your free trial has ended.',{exact:true}).waitFor({timeout:20000});
  assert.equal(await skewed.getByRole('dialog',{name:'Publishing studio',exact:true}).count(),0,'Server-confirmed trial expiry closes open privileged dialogs despite an incorrect local clock.');
  const expired=await api('/repaidians/state',carol);
  assert.equal(expired.trial.status,'expired');assert.equal(expired.subscription,null);assert.equal(expired.remainingMs,0);
  for(const [path,method,body] of [
    ['/feed?kind=post','GET'],['/members?search=Alice','GET'],['/members/'+bob.user.id,'GET'],['/opportunities','GET'],
    ['/comments/'+bobPost.id,'GET'],['/comments/'+bobPost.id,'POST',{text:'Expired account comment',clientId:randomUUID()}],
    ['/activity/likes/'+bobPost.id,'PUT',{active:true}],['/follow/'+bob.user.id,'PUT',{active:true}],
    ['/messages/'+bob.user.id,'GET'],['/messages/'+bob.user.id,'POST',{text:'Expired account DM',clientId:randomUUID()}],
    ['/threads','GET'],['/notifications','GET'],
    ['/publications','POST',{kind:'post',caption:'Expired publication',trade:'plumber',visibility:'public',media:[avatar],clientId:randomUUID()}],
    ['/bids/'+tender.id,'POST',{clientId:randomUUID()}],['/tenders/'+tender.id+'/contact','GET'],
  ]){
    const result=await api('/repaidians'+path,carol,method,body,402);
    assert.equal(result.detail.code,'TRIAL_EXPIRED',method+' '+path+' must require paid access after the trial.');
  }
  const expiredLogin=await api('/auth/login',null,'POST',{email:carol.user.email,password:'isolated-test-password'});
  carol.token=expiredLogin.token;
  assert.equal((await api('/repaidians/state',carol)).trial.endsAt,expired.trial.endsAt,'Signing in again cannot renew an expired trial.');
  const exhausted=await newPage(carol);assert.equal(await shell(exhausted).locator('.rp-post').count(),0);
  await shell(exhausted).getByRole('button',{name:/₹199/}).click();
  await shell(exhausted).getByText('Your free trial has ended.',{exact:true}).waitFor();
  const upgrade=exhausted.getByRole('dialog',{name:'Repaidians membership',exact:true});await upgrade.waitFor();
  assert.equal(await upgrade.getByRole('button',{name:/simulate|demo/i}).count(),0);
  await upgrade.getByRole('button',{name:'Pay ₹199 for one month',exact:true}).waitFor();
  assert.equal(await upgrade.getByRole('button',{name:'Pay ₹199 for one month',exact:true}).isDisabled(),true,'Unavailable payment gateway must not grant membership after the trial.');
  await upgrade.getByRole('button',{name:'Close dialog',exact:true}).click();
  grantPro(carol);
  const restored=await api('/repaidians/state',carol);
  assert.equal(restored.subscription.plan,'pro');assert.equal(restored.subscription.provider,'razorpay');assert.equal(restored.trial.status,'expired');
  await exhausted.reload();await shell(exhausted).getByText('Shared cleaning work from a real API.',{exact:false}).waitFor();
  await shell(exhausted).getByRole('button',{name:'Create',exact:true}).click();await exhausted.getByRole('dialog',{name:'Publishing studio',exact:true}).waitFor();
  await exhausted.getByRole('dialog',{name:'Publishing studio',exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click();
  assert.equal((await api('/repaidians/feed?kind=post',carol)).items.length,1);

  const nativeNow=Date.now()/1000;
  nativeFixture('workers',bob.user.id,{id:bob.user.id,name:bob.user.name,status:'approved',role:'specialist',contractor_verified:true,categories:['cleaning'],city:'Balasore'});
  nativeFixture('shops','community-shop',{id:'community-shop',owner_id:bob.user.id,name:'Bob parts shop',status:'approved',city:'Balasore',location:{lat:21.49,lng:86.94},phone:'PRIVATE_SHOP_CONTACT'});
  const nativeTender={id:'native-tender',owner_id:bob.user.id,owner_name:bob.user.name,status:'open',title:'School electrical maintenance tender',scope:'Replace and inspect the agreed electrical circuits.',sector:'Electrical',city:'Balasore',site:'PRIVATE_SITE_ADDRESS',budget_paise:850000,opens_at:nativeNow-3600,deadline:nativeNow+3600,starts_at:nativeNow+7200,ends_at:nativeNow+86400};
  const nativeCareer={id:'native-career',owner_id:bob.user.id,owner_name:bob.user.name,status:'planning',title:'Electrical project team opening',scope:'Electrical maintenance project',site:'PRIVATE_CAREER_SITE',starts_at:nativeNow+7200,ends_at:nativeNow+86400,team:[],goals:[],hiring:{status:'open',summary:'Join a project team for electrical maintenance and inspections.',sector:'Electrical',city:'Balasore',area:'Town centre',skills:['Wiring','Inspection'],daily_rate_paise:95000,openings:2,deadline:nativeNow+3600,version:1,updated_at:nativeNow,worker_role:'any',minimum_experience:1,hours_per_day:8,terms:'Agreed working hours and site safety equipment are required.'}};
  const refurbishment={grade:'B',cosmetic_condition:'Minor marks on the case',tested_functions:'Cooling and electrical safety checked',tested_on:'2026-01-01',repairs:'Thermostat replaced',known_defects:'Minor case marks only',accessories:'Power cable',warranty_days:90,warranty_terms:'Shop repair warranty',return_days:7,return_terms:'Return for an undisclosed fault'};
  const nativeProduct={id:'native-product',shop_id:'community-shop',name:'Refurbished refrigerator checked by the shop',sku:'FRIDGE-REF',category:'AC parts',compatibility:'Shop-tested refrigerator with disclosed condition.',condition:'refurbished',refurbishment,status:'approved',stock:2,reserved:0,stock_confirmed_at:nativeNow,price_paise:239900,image_url:'/images/ac.jpg',version:1};
  const nativeSecondHand={id:'native-second-hand',owner_id:alice.user.id,owner_name:alice.user.name,name:'Second hand electrical tool kit',brand:'Test brand',product_type:'tools',mode:'second_hand',condition:'Tools are working with normal visible wear.',status:'published',value_paise:120000,purchase_paise:180000,age_months:24,manufacture_year:2024,warranty:'No remaining manufacturer warranty',reason:'Moving to a different workshop',radius_km:10,photo_id:'fixture-photo',city:'Balasore',location:{lat:21.49,lng:86.94},expires_at:nativeNow+86400,created_at:nativeNow};
  nativeFixture('contract_tenders',nativeTender.id,nativeTender);
  nativeFixture('contract_projects',nativeCareer.id,nativeCareer);
  nativeFixture('inventory',nativeProduct.id,nativeProduct);
  nativeFixture('market_listings',nativeSecondHand.id,nativeSecondHand);
  const nativeCards=(await api('/repaidians/opportunities?city=Balasore',alice)).items;
  assert.deepEqual(nativeCards.map(card=>card.source).sort(),['career','contract','inventory','second_hand']);
  assert.equal(JSON.stringify(nativeCards).includes('PRIVATE_'),false,'Community cards never disclose native site addresses or private shop contacts.');
  assert.deepEqual(nativeCards.find(card=>card.source==='inventory').refurbishment,refurbishment);
  assert.equal(nativeCards.find(card=>card.source==='inventory').condition,'refurbished');
  assert.equal(nativeCards.find(card=>card.source==='inventory').shareable,false,'A customer must have a verified paid native purchase before sharing a shop product.');
  assert.deepEqual((await api('/repaidians/opportunities?kind=jobs&trade=electrician&city=balasore',alice)).items.map(card=>card.id),[nativeCareer.id]);
  await api('/repaidians/publications',carol,'POST',{kind:'post',caption:'Forged shop ownership.',trade:'spares',visibility:'public',media:[],reference:{source:'inventory',id:nativeProduct.id},clientId:randomUUID()},403);
  await api('/repaidians/publications',alice,'POST',{kind:'post',caption:'A forged price is not a genuine native reference.',trade:'spares',visibility:'public',media:[],reference:{source:'inventory',id:nativeProduct.id,pricePaise:1},clientId:randomUUID()},422);
  nativeFixture('retail_orders','native-customer-purchase',{id:'native-customer-purchase',customer_id:alice.user.id,state:'paid',payment_id:'pay_CommunityFixture1',items:[{product_id:nativeProduct.id,quantity:1}]});
  const shareable=(await api('/repaidians/opportunities?kind=products&mode=shareable',alice)).items;
  assert.deepEqual(shareable.map(card=>card.id).sort(),[nativeProduct.id,nativeSecondHand.id].sort(),'Shareable products come from actual ownership or a verified native paid purchase.');
  assert.equal((await api('/repaidians/opportunities/inventory/'+nativeProduct.id,carol)).shareable,false,'Purchase proof cannot be borrowed from another account.');
  const nativeShare=await publication(bob,{kind:'post',caption:'Our inspected refurbished refrigerator is now available.',trade:'spares',visibility:'public',media:[],reference:{source:'inventory',id:nativeProduct.id}});
  const customerShare=await publication(alice,{kind:'post',caption:'I purchased this checked refurbished item through Repaido.',trade:'spares',visibility:'public',media:[],reference:{source:'inventory',id:nativeProduct.id}});
  assert.deepEqual(customerShare.reference,{source:'inventory',id:nativeProduct.id});
  assert.equal((await api('/repaidians/publications/'+nativeShare.id,alice)).item.referenceCard.pricePaise,nativeProduct.price_paise);
  nativeFixture('inventory',nativeProduct.id,{...nativeProduct,price_paise:249900,version:2});
  assert.equal((await api('/repaidians/publications/'+nativeShare.id,alice)).item.referenceCard.pricePaise,249900,'Shared posts hydrate the current native product price instead of a stale copied listing.');
  await api('/repaidians/opportunities/inventory/'+nativeProduct.id+'/saved',alice,'PUT',{active:true});
  assert.deepEqual((await api('/repaidians/opportunities?mode=saved',alice)).items.map(card=>card.id),[nativeProduct.id]);
  nativeFixture('contract_tenders',nativeTender.id,{...nativeTender,status:'withdrawn'});
  await api('/repaidians/opportunities/contract/'+nativeTender.id,alice,'GET',undefined,404);
  assert.equal((await api('/repaidians/opportunities?kind=tenders',alice)).items.length,0,'Withdrawn native tenders are immediately removed from community discovery.');
  nativeFixture('contract_tenders',nativeTender.id,nativeTender);

  const opportunityPage=await newPage(alice);
  await openWork(opportunityPage);
  const board=shell(opportunityPage).getByRole('region',{name:'Professional opportunities',exact:true});
  await board.getByText(nativeTender.title,{exact:true}).waitFor();
  await board.getByText(nativeCareer.title,{exact:true}).waitFor();
  await board.getByText(nativeProduct.name,{exact:true}).waitFor();
  await board.getByText(nativeSecondHand.name,{exact:true}).waitFor();
  await board.getByRole('group',{name:'Opportunity category',exact:true}).getByRole('button',{name:'Jobs',exact:true}).click();
  await board.getByText(nativeCareer.title,{exact:true}).waitFor();
  assert.equal(await board.getByText(nativeProduct.name,{exact:true}).count(),0,'Job discovery does not show products from another category.');
  await board.getByRole('group',{name:'Opportunity category',exact:true}).getByRole('button',{name:'Products',exact:true}).click();
  await board.getByText(nativeProduct.name,{exact:true}).waitFor();
  const productCard=board.locator('.rp-opportunity-card').filter({has:opportunityPage.getByRole('heading',{name:nativeProduct.name,exact:true})});
  await productCard.getByText('Refurbished',{exact:true}).waitFor();
  assert.equal(await productCard.getByText('Prime shop',{exact:true}).count(),0,'A genuine shop listing does not get a paid Prime badge without a paid membership.');
  await productCard.getByRole('button',{name:'Unsave opportunity',exact:true}).click();
  await productCard.getByRole('button',{name:'Save opportunity',exact:true}).waitFor();
  assert.equal((await api('/repaidians/opportunities?mode=saved',alice)).items.length,0);
  await productCard.getByRole('button',{name:'Save opportunity',exact:true}).click();
  await productCard.getByRole('button',{name:'Unsave opportunity',exact:true}).waitFor();
  for(const width of [320,390,430,524]){
    await opportunityPage.setViewportSize({width,height:850});await layout(opportunityPage);
    await opportunityPage.evaluate(()=>document.documentElement.dataset.theme='dark');await layout(opportunityPage);
    await opportunityPage.evaluate(()=>document.documentElement.dataset.theme='light');
  }
  await opportunityPage.setViewportSize({width:390,height:850});await audit(opportunityPage);
  await opportunityPage.evaluate(()=>document.documentElement.dataset.theme='dark');await audit(opportunityPage);
  await opportunityPage.evaluate(()=>document.documentElement.style.fontSize='200%');await layout(opportunityPage);
  await opportunityPage.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});
  await productCard.getByRole('button',{name:'View product',exact:true}).click();
  const destination=opportunityPage.getByRole('status');await destination.waitFor();
  assert.equal(await destination.textContent(),'Opened inventory:'+nativeProduct.id+' · '+nativeProduct.name);
  assert.equal(await shell(opportunityPage).count(),0,'Opening a native product hands off its actual source and record to Repaido.');
  await opportunityPage.getByRole('button',{name:'Open Repaidians community',exact:true}).click();await shell(opportunityPage).waitFor();
  await openWork(opportunityPage);
  await board.getByRole('group',{name:'Opportunity category',exact:true}).getByRole('button',{name:'Products',exact:true}).click();
  await productCard.getByRole('button',{name:'Share opportunity with Repaidians',exact:true}).click();
  const attachedStudio=opportunityPage.getByRole('dialog',{name:'Publishing studio',exact:true});await attachedStudio.waitFor();
  await attachedStudio.getByText('Attached to your post',{exact:true}).waitFor();
  const purchaseCaption='A community update linked to my verified Repaido purchase.';
  await attachedStudio.getByLabel('Caption & visual description',{exact:true}).fill(purchaseCaption);
  await attachedStudio.getByRole('button',{name:'Share with Repaidians',exact:true}).click();await attachedStudio.waitFor({state:'hidden'});
  const attachedPost=shell(opportunityPage).locator('.rp-post').filter({hasText:purchaseCaption});
  await attachedPost.getByText(nativeProduct.name,{exact:true}).waitFor();
  assert.equal(await attachedPost.locator('.rp-media-missing').count(),0,'A linked product post uses its listing card without a blank failed-media panel.');
  const storedPurchaseShare=(await api('/repaidians/feed?kind=post',bob)).items.find(post=>post.caption===purchaseCaption);
  assert.deepEqual(storedPurchaseShare.reference,{source:'inventory',id:nativeProduct.id});
  assert.equal(storedPurchaseShare.authorId,alice.user.id);assert.equal(storedPurchaseShare.referenceCard.pricePaise,249900);
  await opportunityPage.reload();await shell(opportunityPage).locator('.rp-post').filter({hasText:purchaseCaption}).getByText(nativeProduct.name,{exact:true}).waitFor();
  nativeFixture('inventory',nativeProduct.id,{...nativeProduct,price_paise:269900,version:3});
  await opportunityPage.evaluate(()=>window.dispatchEvent(new Event('repaidians:update')));
  const refreshedPurchase=shell(opportunityPage).locator('.rp-post').filter({hasText:purchaseCaption});
  await refreshedPurchase.getByText('₹2,699',{exact:true}).waitFor();
  assert.equal(await refreshedPurchase.getByText('₹2,499',{exact:true}).count(),0,'Refreshing a community publication replaces the previously loaded native price.');
  await shell(opportunityPage).getByRole('button',{name:'Create',exact:true}).click();
  const listingStudio=opportunityPage.getByRole('dialog',{name:'Publishing studio',exact:true});
  await listingStudio.getByRole('button',{name:/^Attach an opportunity/}).click();
  await listingStudio.locator('.rp-studio-reference-option').filter({hasText:nativeSecondHand.name}).click();
  await listingStudio.getByText('Attached to your post',{exact:true}).waitFor();
  const secondHandCaption='My used electrical tools are listed for another member.';
  await listingStudio.getByLabel('Caption & visual description',{exact:true}).fill(secondHandCaption);
  await listingStudio.getByRole('button',{name:'Share with Repaidians',exact:true}).click();await listingStudio.waitFor({state:'hidden'});
  await shell(opportunityPage).locator('.rp-post').filter({hasText:secondHandCaption}).getByText(nativeSecondHand.name,{exact:true}).waitFor();
  assert.deepEqual((await api('/repaidians/feed?kind=post',bob)).items.find(post=>post.caption===secondHandCaption).reference,{source:'second_hand',id:nativeSecondHand.id});

  const appPage=await newPage(alice);
  await appPage.goto(origin+'/?noSplash=1&tab=explore');
  await appPage.getByRole('button',{name:'Open Repaidians community',exact:true}).click();await shell(appPage).waitFor();
  await openWork(appPage);
  const appBoard=shell(appPage).getByRole('region',{name:'Professional opportunities',exact:true});
  await appBoard.getByRole('group',{name:'Opportunity category',exact:true}).getByRole('button',{name:'Products',exact:true}).click();
  await appBoard.locator('.rp-opportunity-card').filter({hasText:nativeProduct.name}).getByRole('button',{name:'View product',exact:true}).click();
  const productDetails=appPage.getByRole('dialog',{name:nativeProduct.name,exact:true});await productDetails.waitFor();
  await productDetails.getByText(refurbishment.repairs,{exact:true}).waitFor();
  await productDetails.getByText(refurbishment.warranty_terms,{exact:false}).waitFor();
  await productDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
  await appPage.getByRole('button',{name:'Back to Repaidians',exact:true}).click();await shell(appPage).waitFor();
  await appBoard.getByRole('group',{name:'Opportunity category',exact:true}).getByRole('button',{name:'Products',exact:true}).click();
  await appBoard.locator('.rp-opportunity-card').filter({hasText:nativeSecondHand.name}).getByRole('button',{name:'View product',exact:true}).click();
  const usedDetails=appPage.getByRole('dialog',{name:nativeSecondHand.name,exact:true});await usedDetails.waitFor();
  await usedDetails.getByText(nativeSecondHand.condition,{exact:true}).waitFor();
  await usedDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
  await appPage.getByRole('button',{name:'Back to Repaidians',exact:true}).click();await shell(appPage).waitFor();
  await appBoard.getByRole('group',{name:'Opportunity category',exact:true}).getByRole('button',{name:'Jobs',exact:true}).click();
  await appBoard.locator('.rp-opportunity-card').filter({hasText:nativeCareer.title}).getByRole('button',{name:'View job',exact:true}).click();
  const careerDetails=appPage.getByRole('dialog',{name:'Project opportunity',exact:true});await careerDetails.waitFor();
  await careerDetails.getByRole('heading',{name:nativeCareer.title,exact:true}).waitFor();
  await careerDetails.getByText(nativeCareer.hiring.summary,{exact:true}).waitFor();
  await careerDetails.getByRole('button',{name:'Close dialog',exact:true}).click();await shell(appPage).waitFor();
  nativeFixture('inventory',nativeProduct.id,{...nativeProduct,stock:0,price_paise:269900,version:4});
  const unavailableShare=(await api('/repaidians/publications/'+nativeShare.id,alice)).item;
  assert.equal(unavailableShare.referenceCard,null);assert.equal(unavailableShare.referenceUnavailable,true,'A sold-out native product cannot remain an actionable live offer on its shared post.');
  await api('/repaidians/opportunities/inventory/'+nativeProduct.id,alice,'GET',undefined,404);
  await opportunityPage.evaluate(()=>window.dispatchEvent(new Event('repaidians:update')));
  await refreshedPurchase.getByText('This listing is no longer available. Your publication stays in your portfolio.',{exact:true}).waitFor();
  assert.equal(await refreshedPurchase.getByRole('button',{name:'View product',exact:true}).count(),0,'A source withdrawn after initial hydration cannot keep an actionable stale offer in the loaded feed.');
  await nav(opportunityPage,'My profile');
  const listingUpdates=shell(opportunityPage).getByRole('region',{name:'Listing updates',exact:true});await listingUpdates.waitFor();
  await listingUpdates.getByRole('button',{name:'Open listing update: '+nativeSecondHand.name,exact:true}).click();
  const profileListing=opportunityPage.getByRole('dialog',{name:'Publication',exact:true});await profileListing.waitFor();
  await profileListing.getByText(secondHandCaption,{exact:false}).waitFor();
  await profileListing.getByText(nativeSecondHand.name,{exact:true}).waitFor();
  await profileListing.getByRole('button',{name:'Close dialog',exact:true}).click();
  await listingUpdates.getByRole('button',{name:'Open listing update: Listing unavailable',exact:true}).first().click();
  await profileListing.getByText('This listing is no longer available. Your publication stays in your portfolio.',{exact:true}).waitFor();
  assert.equal(await profileListing.getByRole('button',{name:'View product',exact:true}).count(),0,'A profile retains an honest portfolio update after its original listing is withdrawn.');
  await profileListing.getByRole('button',{name:'Close dialog',exact:true}).click();

  const privateCaption='Private electrical portfolio for my trade only.';
  const switchPrivate=await publication(alice,{kind:'post',caption:privateCaption,trade:'electrician',visibility:'trade',media:[avatar]});
  const privateComment='Private electrical work discussion.';
  await api('/repaidians/comments/'+switchPrivate.id,alice,'POST',{text:privateComment,clientId:randomUUID()},201);
  const bobPrivateComment='A different private cleaning discussion.';
  await api('/repaidians/comments/'+privatePost.id,bob,'POST',{text:bobPrivateComment,clientId:randomUUID()},201);
  const switching=await newPage(alice);
  await nav(switching,'My profile');
  const oldDetail=await delayedRealRead(switching,'/repaidians/publications/'+switchPrivate.id);
  await shell(switching).getByRole('button',{name:'Open image by Alice Electrician: '+privateCaption,exact:true}).click();
  assert.equal((await oldDetail.reached).item.caption,privateCaption,'The held response is the real previously authorized private publication.');
  await switchPreviewAccount(switching,bob);
  await shell(switching).locator('.rp-profile-title h2').waitFor();
  assert.equal(await shell(switching).locator('.rp-profile-title h2').textContent(),bob.user.name);
  oldDetail.release();await oldDetail.done;await oldDetail.remove();
  await switching.waitForLoadState('networkidle');
  assert.equal(await switching.getByText(privateCaption,{exact:false}).count(),0,'An old authorized publication response cannot open after the account has switched.');
  assert.equal(await shell(switching).locator('.rp-profile-title h2').textContent(),bob.user.name,'An account change clears the previous private profile/portfolio data.');
  await switchPreviewAccount(switching,alice);await nav(switching,'Home');
  const privateFeedCard=shell(switching).locator('.rp-post').filter({hasText:privateCaption});await privateFeedCard.waitFor();
  const oldComments=await delayedRealRead(switching,'/repaidians/comments/'+switchPrivate.id);
  await privateFeedCard.getByRole('button',{name:'Open comments',exact:true}).click();
  await switching.getByRole('dialog',{name:'Comments',exact:true}).waitFor();
  assert.equal((await oldComments.reached).comments[0].text,privateComment);
  await switchPreviewAccount(switching,bob);
  assert.equal(await switching.getByRole('dialog',{name:'Comments',exact:true}).count(),0,'Account changes close an open private conversation even while its prior response is pending.');
  const newPrivateCard=shell(switching).locator('.rp-post').filter({hasText:privatePost.caption});await newPrivateCard.waitFor();
  await newPrivateCard.getByRole('button',{name:'Open comments',exact:true}).click();
  const newComments=switching.getByRole('dialog',{name:'Comments',exact:true});
  await newComments.getByText(bobPrivateComment,{exact:true}).waitFor();
  oldComments.release();await oldComments.done;await oldComments.remove();
  await switching.waitForLoadState('networkidle');
  await newComments.getByText(bobPrivateComment,{exact:true}).waitFor();
  assert.equal(await switching.getByText(privateComment,{exact:true}).count(),0);
  assert.equal(await shell(switching).getByText(privateCaption,{exact:false}).count(),0);
  await newComments.getByRole('button',{name:'Close dialog',exact:true}).click();

  const paginationPosts=[];
  for(let index=0;index<14;index++)paginationPosts.push(await publication(bob,{kind:'post',caption:'Shared work update '+(index+1)+' from Bob.',trade:'cleaning',visibility:'public',media:[photo]}));
  const paginationPage=await newPage(carol);
  await shell(paginationPage).getByRole('button',{name:'Load more',exact:true}).waitFor();
  assert.equal(await shell(paginationPage).locator('.rp-post').count(),12,'The first authoritative feed page remains bounded.');
  assert.equal(await shell(paginationPage).getByText(paginationPosts[0].caption,{exact:false}).count(),0,'The target publication is genuinely outside the first page.');
  await shell(paginationPage).getByRole('button',{name:'Load more',exact:true}).click();
  const laterPost=shell(paginationPage).locator('.rp-post').filter({hasText:paginationPosts[0].caption});await laterPost.waitFor();
  const loadedExtent=await shell(paginationPage).locator('.rp-post').count();assert.ok(loadedExtent>12);
  const reloadedFeed=()=>paginationPage.waitForResponse(response=>{
    const url=new URL(response.url());return url.pathname==='/api/repaidians/feed'&&url.searchParams.get('kind')==='post'&&!url.searchParams.get('cursor')&&Number(url.searchParams.get('limit'))>=loadedExtent;
  });
  const laterLike=laterPost.getByRole('button',{name:'Like post',exact:true});await laterLike.scrollIntoViewIfNeeded();
  const scrollBeforeLike=await shell(paginationPage).locator('.rp-content').evaluate(content=>content.scrollTop);
  const afterLike=reloadedFeed();await laterLike.click();
  const likedReload=await(await afterLike).json();
  assert.equal(likedReload.items.find(post=>post.id===paginationPosts[0].id).liked,true);
  await paginationPage.waitForLoadState('networkidle');
  await laterPost.getByRole('button',{name:'Unlike post',exact:true}).waitFor();
  assert.ok(await shell(paginationPage).locator('.rp-post').count()>=loadedExtent,'Liking an item on the second page preserves the loaded feed extent.');
  const scrollAfterLike=await shell(paginationPage).locator('.rp-content').evaluate(content=>content.scrollTop);
  assert.ok(Math.abs(scrollAfterLike-scrollBeforeLike)<=8,'Liking a later-page post preserves the current scroll position: '+scrollBeforeLike+' → '+scrollAfterLike);
  const afterUpdate=reloadedFeed();await paginationPage.evaluate(()=>window.dispatchEvent(new Event('repaidians:update')));await afterUpdate;
  await paginationPage.waitForLoadState('networkidle');
  await laterPost.getByRole('button',{name:'Unlike post',exact:true}).waitFor();
  assert.ok(await shell(paginationPage).locator('.rp-post').count()>=loadedExtent,'An authoritative update replaces fresh records across the loaded window without removing the second page.');

  const guest=await newPage(null);
  const cookies=await guest.context().cookies(origin);
  const session=cookies.find(cookie=>cookie.name==='__session');assert.ok(session,'Guest browsing uses the Hosting-supported quota cookie.');
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const guestSubject='guest_'+createHash('sha256').update(session.value).digest('hex').slice(0,32);
  fixture('rp_usage',guestSubject,{day,usedMs:900000,leaseUntil:0});
  await guest.reload();assert.equal(await shell(guest).locator('.rp-post').count(),0);
  assert.deepEqual(errors,[]);
  succeeded=true;
  console.log('Repaidians real SQLite/API/browser checks passed: 60-day trial and expiry/paid restoration, posts/media/comments/follows/DMs and privacy, exact portfolio reel/listing viewers, account-switch delayed private response isolation, preserved loaded feed pages after likes/refresh, professional profile persistence, inline invalid/taken handle errors, explicit suggestions and unchanged legacy-handle compatibility, filtered discovery, all four native opportunity sources, ownership/purchase-proven sharing, live UI listing prices and withdrawal, saved opportunities, attached purchased/refurbished and second-hand posts, real app product/career handoff and return, padded contained photos and expansion/tools, guest quota, 320–524px/desktop light-dark themes, 200% text, reduced motion and WCAG AA audits.');
}catch(error){
  for(const [contextIndex,context] of (browser?.contexts()||[]).entries())for(const [index,page] of context.pages().entries()){
    await page.screenshot({path:resolve(work,'failure-'+contextIndex+'-'+index+'.png')}).catch(()=>{});
    await writeFile(resolve(work,'failure-'+contextIndex+'-'+index+'.html'),await page.content().catch(()=>''));
  }
  await writeFile(resolve(work,'backend.log'),serverLog);console.error('Isolated backend logs: '+resolve(work,'backend.log'));throw error;
}finally{
  releaseReads.forEach(release=>release());
  await browser?.close();server?.kill('SIGTERM');
  if(server)await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(3000)]);
  if(succeeded)await rm(work,{recursive:true,force:true});
}
