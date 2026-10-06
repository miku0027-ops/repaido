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
let server,browser,serverLog='',succeeded=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fixture(kind,id,body){
  const code='import json,sqlite3,sys\nc=sqlite3.connect(sys.argv[1],timeout=15)\nc.execute("INSERT INTO operation_records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",(sys.argv[2],sys.argv[3],sys.argv[4]))\nc.commit()\nc.close()';
  const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(body)],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
function grantPro(account){
  fixture('rp_subscriptions',account.user.id,{userId:account.user.id,plan:'pro',amountPaise:19900,provider:'razorpay',startsAt:Date.now()-60000,endsAt:Date.now()+86400000,status:'active',paymentId:'test-only',attemptId:'test-only'});
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
async function newPage(account,width=390){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'});
  await context.addInitScript(({token})=>{
    if(token)localStorage.setItem('repaido.token',token);
    // A prior browser prototype must not become a public post or entitlement.
    localStorage.setItem('repaidians.v1.subscription.guest',JSON.stringify({plan:'demo-pro',provider:'mock',startsAt:0,endsAt:9999999999999}));
    localStorage.setItem('repaidians.v1.community',JSON.stringify({version:1,posts:[{id:'old-local-mock',caption:'OLD MOCK MUST NOT APPEAR'}]}));
  },{token:account?.token||''});
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
const shell=page=>page.getByRole('dialog',{name:'Repaidians community',exact:true});
async function nav(page,label){
  if(label==='Tenders')return shell(page).locator('.rp-toolbar').getByRole('button',{name:label,exact:true}).click();
  const mobile=shell(page).locator('.rp-bottom-nav').getByRole('button',{name:label,exact:true});
  if(await mobile.count())return mobile.click();
  return shell(page).locator('.rp-desktop-sidebar').getByRole('button',{name:label,exact:true}).click();
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
  const initial=await api('/repaidians/state',alice);
  assert.equal(initial.authenticated,true);assert.equal(initial.subscription,null);assert.equal(initial.paymentsReady,false);
  assert.deepEqual(initial.data.posts,[],'A new database must not generate sample posts.');
  await api('/repaidians/publications',alice,'POST',{kind:'post',caption:'Free account attempt',trade:'electrician',visibility:'public',media:[]},402);
  await api('/repaidians/subscription/order',alice,'POST',undefined,503);
  const avatar=await upload(alice,resolve(web,'public/images/electrical.jpg'),'image/jpeg');
  await api('/repaidians/profile',alice,'PATCH',{avatarUrl:avatar.url});
  assert.equal((await api('/repaidians/members/'+alice.user.id,bob)).member.avatarUrl,avatar.url);
  assert.equal((await fetch(apiOrigin+avatar.url,{headers:{Authorization:'Bearer '+bob.token}})).status,200,'Free member profile photos are shared after attachment to the profile.');
  await api('/repaidians/media',alice,'POST',Buffer.alloc(2*1024*1024+1),413,{'Content-Type':'image/jpeg'});
  for(let count=0;count<3;count++)await upload(alice,resolve(web,'public/images/electrical.jpg'),'image/jpeg');
  await api('/repaidians/media',alice,'POST',await readFile(resolve(web,'public/images/electrical.jpg')),429,{'Content-Type':'image/jpeg'});
  grantPro(bob);
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
  await api('/repaidians/media',alice,'POST',await readFile(clip),402,{'Content-Type':'video/webm'});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  await mkdir(resolve(web,'test-results'),{recursive:true});
  const page=await newPage(alice);
  await shell(page).getByText('Shared cleaning work from a real API.',{exact:false}).waitFor();
  assert.equal(await shell(page).getByText('OLD MOCK MUST NOT APPEAR',{exact:false}).count(),0);
  assert.equal(await shell(page).locator('.rp-post').count(),1);
  await shell(page).getByRole('button',{name:'Create',exact:true}).click();
  const upgrade=page.getByRole('dialog',{name:'Repaidians Pro',exact:true});await upgrade.waitFor();
  assert.equal(await upgrade.getByRole('button',{name:/simulate|demo/i}).count(),0);
  await upgrade.getByRole('button',{name:'Pay ₹199 for one month',exact:true}).waitFor();
  assert.equal(await upgrade.getByRole('button',{name:'Pay ₹199 for one month',exact:true}).isDisabled(),true,'Unavailable payment gateway must not unlock membership.');
  await upgrade.getByRole('button',{name:'Close dialog',exact:true}).click();
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

  grantPro(alice);await page.reload();await shell(page).getByText('Shared cleaning work from a real API.',{exact:false}).waitFor();
  await shell(page).getByRole('button',{name:'Create',exact:true}).click();
  let studio=page.getByRole('dialog',{name:'Publishing studio',exact:true});
  await studio.getByLabel('Upload publication media',{exact:true}).setInputFiles(resolve(web,'public/images/electrical.jpg'));
  await studio.getByLabel('Caption & visual description',{exact:true}).fill('Electrical portfolio uploaded to the shared backend.');
  await studio.getByRole('button',{name:'Share with Repaidians',exact:true}).click();
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
  await studio.getByRole('button',{name:'Reel',exact:true}).click();
  await studio.getByLabel('Upload publication media',{exact:true}).setInputFiles(clip);
  await studio.getByLabel('Caption & visual description',{exact:true}).fill('A work reel stored on the server.');
  await studio.getByRole('button',{name:'Share with Repaidians',exact:true}).click();await shell(page).locator('.rp-reel video').waitFor();
  await page.waitForFunction(()=>document.querySelector('.rp-reel video')?.readyState>=2);
  assert.equal(await shell(page).locator('.rp-reel video').evaluate(video=>video.paused),true,'Reduced motion starts reels paused.');
  await shell(page).getByRole('button',{name:'Play reel',exact:true}).click();await shell(page).getByRole('button',{name:'Pause reel',exact:true}).waitFor();
  await shell(page).getByRole('button',{name:'Pause reel',exact:true}).click();
  await page.reload();await nav(page,'Reels');await shell(page).locator('.rp-reel video').waitFor();
  await page.waitForFunction(()=>document.querySelector('.rp-reel video')?.readyState>=2);
  assert.equal((await api('/repaidians/feed?kind=reel',bob)).items[0].caption,'A work reel stored on the server.');
  await shell(page).getByRole('button',{name:'Book a service',exact:true}).click();await page.getByLabel('Home search',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Home search',{exact:true}).inputValue(),'Electrical');
  await page.getByRole('button',{name:'Open Repaidians community',exact:true}).click();await shell(page).waitFor();

  for(const width of [320,390,430,524,1280]){
    await page.setViewportSize({width,height:850});await nav(page,'Home');await layout(page);
    if(width===1280)await page.screenshot({path:resolve(web,'test-results/repaidians-desktop.png')});
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');await layout(page);
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
  }
  await page.setViewportSize({width:390,height:850});await audit(page);
  await page.screenshot({path:resolve(web,'test-results/repaidians-phone.png')});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await audit(page);
  await page.screenshot({path:resolve(web,'test-results/repaidians-dark.png')});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');await layout(page);
  await page.evaluate(()=>document.documentElement.style.fontSize='100%');
  await nav(page,'Search');await shell(page).getByLabel('Search Repaidians',{exact:true}).fill('Alice');
  await shell(page).locator('.rp-search-results').getByText('Alice Electrician',{exact:true}).waitFor();
  assert.equal(await shell(page).locator('.rp-search-results').getByText('Bob Cleaning',{exact:true}).count(),0,'Server search must filter results.');
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

  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const subject='user_'+createHash('sha256').update(carol.user.id).digest('hex').slice(0,32);
  fixture('rp_usage',subject,{day,usedMs:900000,leaseUntil:0});
  const exhausted=await newPage(carol);assert.equal(await shell(exhausted).locator('.rp-post').count(),0);
  assert.equal((await api('/repaidians/state',carol)).remainingMs,0);
  await api('/repaidians/feed?kind=post',carol,'GET',undefined,402);
  assert.deepEqual(errors,[]);
  succeeded=true;
  console.log('Repaidians real backend: shared posts/media/comments/follows/DMs, membership and ownership gates, protected trade content, reels, bids, search, server quota, mobile/desktop themes, reduced motion, enlarged text and accessibility passed.');
}catch(error){
  await writeFile(resolve(work,'backend.log'),serverLog);console.error('Isolated backend logs: '+resolve(work,'backend.log'));throw error;
}finally{
  await browser?.close();server?.kill('SIGTERM');
  if(server)await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(3000)]);
  if(succeeded)await rm(work,{recursive:true,force:true});
}
