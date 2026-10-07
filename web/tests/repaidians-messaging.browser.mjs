import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Real approved identities, conversations and messages use a disposable API.
// Only the two deliberate read-failure checks inject a single transport error.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend');
const artifacts=await mkdtemp(resolve(tmpdir(),'repaidians-messaging-'));
const db=resolve(artifacts,'community.db');
const python=process.env.REPAIDIANS_TEST_PYTHON||resolve(backend,'.venv/bin/python');
const origin=process.env.REPAIDIANS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const port=Number(process.env.MESSAGING_TEST_PORT||8042),apiOrigin='http://127.0.0.1:'+port;
let server,browser,serverLog='',success=false;
const errors=[],checks=[],releaseReads=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shell=page=>page.getByRole('dialog',{name:'Repaidians community',exact:true});
const inbox=page=>shell(page).locator('.rp-inbox');
const threadRows=page=>inbox(page).locator(':scope > button.rp-member-row');
const messageDialog=(page,account)=>page.getByRole('dialog',{name:'Message '+account.user.name,exact:true});
const messageTexts=dialog=>dialog.locator('.rp-messages > article > p').allTextContents();
const chronological=messages=>[...messages].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));

function nativeFixtures(rows){
  const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nrows=json.loads(sys.argv[2])\ndef save(u):\n for kind,key,row in rows:u.put(kind,key,row)\nmain.operations_store.run(save)';
  const result=spawnSync(python,['-c',code,db,JSON.stringify(rows)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
function worker(account,status='approved'){return ['workers',account.user.id,{id:account.user.id,name:account.user.name,status,role:'technician',categories:['electrician'],city:'Balasore',skills:['Wiring'],experience_years:5}];}
function memberFixtures(accounts){
  // Only the participants who sign in need auth registrations. Other inbox
  // peers are canonical reviewed recipient fixtures, created through the same
  // server member bootstrap used by signed community state.
  const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main,repaidians\nusers=json.loads(sys.argv[2])\ndef save(u):\n for user in users:repaidians.member_ensure(u,user)\nmain.operations_store.run(save)';
  const result=spawnSync(python,['-c',code,db,JSON.stringify(accounts.map(account=>account.user))],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,expected=200,headers={}){
  const binary=Buffer.isBuffer(body),response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body&&!binary?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
  const result=await response.json().catch(()=>({}));assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(result));return result;
}
async function register(name){return api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','.')+'@messaging.test',password:'isolated-test-password'},201);}
async function send(from,to,text){return (await api('/repaidians/messages/'+to.user.id,from,'POST',{text,clientId:randomUUID()},201)).message;}
async function newPage(account){
  const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
  await context.routeWebSocket('**',socket=>socket.close());
  await context.addInitScript(token=>localStorage.setItem('repaido.token',token),account.token);
  await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/tests/repaidians-preview.html');await shell(page).waitFor();await shell(page).locator('.rp-loading').waitFor({state:'hidden'});return page;
}
async function openInbox(page){await shell(page).getByRole('button',{name:'Open messages',exact:true}).click();await inbox(page).getByRole('heading',{name:'Messages',exact:true}).waitFor();}
async function openConversation(page,account){await threadRows(page).filter({has:page.getByText(account.user.name,{exact:true})}).click();const dialog=messageDialog(page,account);await dialog.waitFor();return dialog;}
async function actualRefresh(page,path){
  const response=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api'+path&&!url.searchParams.get('cursor');});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));return response;
}
async function failOneRead(page,path){
  const pattern='**/api'+path+'*';let failed=false;
  const handler=async route=>{if(!failed&&route.request().method()==='GET'){failed=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'The isolated messaging read failed. Retry the conversation.'})});}return route.fallback();};
  await page.context().route(pattern,handler);return {remove:()=>page.context().unroute(pattern,handler)};
}
async function heldRead(page,path){
  let release,captured,finished;
  const barrier=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{captured=resolve;}),done=new Promise(resolve=>{finished=resolve;});releaseReads.push(release);
  const pattern='**/api'+path+'*';
  const handler=async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});captured(await response.json());await barrier;await route.fulfill({response});finished();};
  await page.context().route(pattern,handler);return {reached,done,release,remove:()=>page.context().unroute(pattern,handler)};
}
async function switchAccount(page,account){
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/repaidians/state'&&response.request().headers().authorization==='Bearer '+account.token);
  await page.evaluate(({token,id})=>{localStorage.setItem('repaido.token',token);window.dispatchEvent(new CustomEvent('repaidians-preview-account',{detail:id}));},{token:account.token,id:account.user.id});
  assert.equal((await(await response).json()).member.id,account.user.id);await shell(page).locator('.rp-loading').waitFor({state:'hidden'});
}
async function headerLayout(page){
  for(const width of [320,509])for(const theme of ['light','dark'])for(const text of [100,200]){
    await page.setViewportSize({width,height:850});await page.evaluate(({theme,text})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=text+'%';},{theme,text});
    const boxes=await shell(page).locator('.rp-header').evaluate(header=>{
      const title=header.querySelector('.rp-wordmark h1'),range=document.createRange();range.selectNodeContents(title);
      const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,center:r.top+r.height/2};};
      return {centers:[rect(title).center,...[...header.querySelectorAll('.rp-header-actions button')].map(button=>rect(button).center)],boxes:[rect(range),...[...header.querySelectorAll('.rp-header-actions button')].map(rect)],overflow:header.scrollWidth>header.clientWidth+1};
    });
    assert.equal(boxes.overflow,false);assert.ok(Math.max(...boxes.centers)-Math.min(...boxes.centers)<=2);
    for(let index=1;index<boxes.boxes.length;index++)assert.ok(boxes.boxes[index-1].right<=boxes.boxes[index].left+.5,'Header controls do not overlap.');
    assert.equal((await shell(page).getByRole('button',{name:'Create publication',exact:true}).textContent()).trim(),'');
    assert.equal(await shell(page).locator('.rp-bottom-nav > button').count(),5);
  }
  await page.setViewportSize({width:390,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});
}

try{
  server=spawn(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port',String(port)],{cwd:backend,env:{...process.env,REPAIDO_STORAGE:'sqlite',REPAIDO_DB:db,REPAIDO_COMMUNITY_MEDIA_DIR:resolve(artifacts,'media'),REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>serverLog+=chunk.toString());
  for(let attempt=0;attempt<100;attempt++){
    if(server.exitCode!==null)throw new Error('Isolated backend stopped: '+serverLog);
    try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}
    if(attempt===99)throw new Error('Isolated backend did not become ready: '+serverLog);await pause(200);
  }
  const alice=await register('Alice Messaging'),bob=await register('Bob Messaging'),retired=await register('Retired Member');
  const switchPeer=await register('Peer Agent 01'),peers=[];
  for(let index=0;index<30;index++){const name='Peer Agent '+String(index).padStart(2,'0');peers.push(index===1?switchPeer:{user:{id:randomUUID(),name,email:name.toLowerCase().replaceAll(' ','.')+'@messaging.test'}});}
  nativeFixtures([alice,bob,retired,...peers].map(account=>worker(account)));
  memberFixtures(peers.filter(account=>account!==switchPeer));
  for(const account of [alice,bob,retired,switchPeer])await api('/repaidians/state',account);
  const history=[];
  for(let index=0;index<38;index++)history.push(await send(index%2?bob:alice,index%2?alice:bob,'Private history '+String(index).padStart(2,'0')+' between Alice and Bob.'));
  for(const peer of peers)await send(alice,peer,'A real conversation with '+peer.user.name+'.');
  // Reproduce the user's exact unavailable-conversation source: a once-valid
  // thread survives after the canonical peer approval is revoked.
  await send(alice,retired,'This historical thread must not open after peer approval is revoked.');
  const media=await api('/repaidians/media',retired,'POST',await readFile(resolve(web,'public/images/electrical.jpg')),201,{'Content-Type':'image/jpeg'});
  await api('/repaidians/publications',retired,'POST',{kind:'post',trade:'electrician',visibility:'public',caption:'A historical public portfolio retained after review changed.',media:[{url:media.url,kind:media.kind,alt:'Published electrical portfolio'}],clientId:randomUUID()},201);
  nativeFixtures([worker(retired,'pending')]);
  const unavailable=await api('/repaidians/messages/'+retired.user.id,alice,'GET',undefined,404);assert.equal(unavailable.detail.message,'Conversation unavailable.');
  const first=await api('/repaidians/threads?limit=30',alice);assert.equal(first.threads.length,30);assert.ok(first.nextCursor);assert.equal(first.threads.some(thread=>thread.id===retired.user.id||thread.id===bob.user.id),false);
  const earlier=await api('/repaidians/threads?limit=30&cursor='+encodeURIComponent(first.nextCursor),alice);assert.deepEqual(earlier.threads.map(thread=>thread.id),[bob.user.id]);
  checks.push('Actual revoked-peer conversation returns the exact unavailable error and both inbox pages omit its stale summary');
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  const alicePage=await newPage(alice),bobPage=await newPage(bob);
  await headerLayout(alicePage);checks.push('Eight responsive/theme/text variants preserve the corrected icon-only one-line header and five bottom actions');
  await shell(alicePage).getByRole('button',{name:'View '+retired.user.name+' profile',exact:true}).first().click();
  await shell(alicePage).locator('.rp-profile-title').getByText(retired.user.name,{exact:true}).waitFor();
  assert.equal(await shell(alicePage).getByRole('button',{name:'Message',exact:true}).count(),0,'An unapproved public peer profile cannot offer a broken messaging action.');
  await shell(alicePage).getByRole('button',{name:'Back to community',exact:true}).click();
  await openInbox(alicePage);await alicePage.waitForLoadState('networkidle');
  assert.equal(await threadRows(alicePage).count(),30);assert.equal(await inbox(alicePage).getByText(retired.user.name,{exact:true}).count(),0);assert.equal(await inbox(alicePage).getByText(bob.user.name,{exact:true}).count(),0);
  await inbox(alicePage).getByRole('button',{name:'Earlier conversations',exact:true}).click();await inbox(alicePage).getByText(bob.user.name,{exact:true}).waitFor();assert.equal(await threadRows(alicePage).count(),31);
  // An expanded inbox must refresh its complete loaded window authoritatively.
  nativeFixtures([worker(peers[0],'pending')]);await actualRefresh(alicePage,'/repaidians/threads');
  await inbox(alicePage).getByText(peers[0].user.name,{exact:true}).waitFor({state:'hidden'});await alicePage.waitForLoadState('networkidle');assert.equal(await threadRows(alicePage).count(),30);await inbox(alicePage).getByText(bob.user.name,{exact:true}).waitFor();
  checks.push('Header inbox opens, 31 live conversations paginate, and expanded refresh removes a revoked peer without hiding the valid oldest thread');
  let dialog=await openConversation(alicePage,bob);await dialog.locator('.rp-messages > article').first().waitFor();
  assert.deepEqual(await messageTexts(dialog),chronological(history).slice(-30).map(message=>message.text),'The latest server page renders oldest to newest.');
  await dialog.getByRole('button',{name:'Earlier messages',exact:true}).click();await dialog.getByText(history[0].text,{exact:true}).waitFor();assert.deepEqual(await messageTexts(dialog),chronological(history).map(message=>message.text));
  await actualRefresh(alicePage,'/repaidians/messages/'+bob.user.id);await alicePage.waitForLoadState('networkidle');assert.deepEqual(await messageTexts(dialog),chronological(history).map(message=>message.text),'Refreshing retains the previously opened older message page.');
  await dialog.getByLabel('Message',{exact:true}).fill('Alice sends a confirmed browser reply.');await dialog.getByRole('button',{name:'Send message',exact:true}).click();await dialog.getByText('Alice sends a confirmed browser reply.',{exact:true}).waitFor();
  const aliceReply=(await api('/repaidians/messages/'+alice.user.id,bob)).messages.find(message=>message.text==='Alice sends a confirmed browser reply.');assert.ok(aliceReply);history.push(aliceReply);
  assert.deepEqual(await messageTexts(dialog),chronological(history).map(message=>message.text),'Sending retains older opened history and appends the canonical reply.');
  await openInbox(bobPage);const bobDialog=await openConversation(bobPage,alice);await bobDialog.getByText('Alice sends a confirmed browser reply.',{exact:true}).waitFor();
  await bobDialog.getByLabel('Message',{exact:true}).fill('Bob replies from his separate approved account.');await bobDialog.getByRole('button',{name:'Send message',exact:true}).click();await bobDialog.getByText('Bob replies from his separate approved account.',{exact:true}).waitFor();
  const bobReply=(await api('/repaidians/messages/'+bob.user.id,alice)).messages.find(message=>message.text==='Bob replies from his separate approved account.');assert.ok(bobReply);history.push(bobReply);
  await actualRefresh(alicePage,'/repaidians/messages/'+bob.user.id);await dialog.getByText(bobReply.text,{exact:true}).waitFor();assert.deepEqual(await messageTexts(dialog),chronological(history).map(message=>message.text));
  checks.push('Thirty-eight real private messages render chronologically, earlier pages survive refresh/send, and two approved accounts exchange confirmed browser replies');
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await shell(alicePage).locator('.rp-bottom-nav').getByRole('button',{name:'Home',exact:true}).click();
  let failure=await failOneRead(alicePage,'/repaidians/threads');await openInbox(alicePage);await inbox(alicePage).getByRole('button',{name:'Retry inbox',exact:true}).click();await inbox(alicePage).getByText(bob.user.name,{exact:true}).waitFor();assert.equal(await inbox(alicePage).getByRole('alert').count(),0);await failure.remove();
  failure=await failOneRead(alicePage,'/repaidians/messages/'+bob.user.id);dialog=await openConversation(alicePage,bob);await dialog.getByRole('button',{name:'Retry messages',exact:true}).click();await dialog.getByText(bobReply.text,{exact:true}).waitFor();assert.equal(await dialog.getByRole('alert').count(),0);await failure.remove();
  failure=await failOneRead(alicePage,'/repaidians/messages/'+bob.user.id);await dialog.getByRole('button',{name:'Earlier messages',exact:true}).click();await dialog.getByRole('button',{name:'Retry messages',exact:true}).waitFor();assert.equal(await dialog.locator('.rp-messages > article').count(),30);await dialog.getByRole('button',{name:'Retry messages',exact:true}).click();await dialog.getByText(history[0].text,{exact:true}).waitFor();assert.deepEqual(await messageTexts(dialog),chronological(history).map(message=>message.text));await failure.remove();
  checks.push('Inbox, initial conversation and earlier-history failures expose working retries without losing already loaded messages');
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  const held=await heldRead(alicePage,'/repaidians/messages/'+bob.user.id);dialog=await openConversation(alicePage,bob);const oldResponse=await held.reached;assert.ok(oldResponse.messages.some(message=>message.text===bobReply.text));
  await switchAccount(alicePage,peers[1]);await messageDialog(alicePage,bob).waitFor({state:'hidden'});held.release();await held.done;await held.remove();await alicePage.waitForLoadState('networkidle');
  assert.equal(await alicePage.getByText(bobReply.text,{exact:true}).count(),0,'An authorized private response from the previous account never appears after switching accounts.');
  await openInbox(alicePage);await inbox(alicePage).getByText(alice.user.name,{exact:true}).waitFor();assert.equal(await inbox(alicePage).getByText(bob.user.name,{exact:true}).count(),0);assert.equal(await threadRows(alicePage).count(),1);
  checks.push('Switching accounts closes private conversation state and rejects a delayed real response while loading only the new account inbox');
  assert.deepEqual(errors,[]);success=true;
  await bobPage.screenshot({path:resolve(artifacts,'confirmed-two-account-reply.png')});await alicePage.screenshot({path:resolve(artifacts,'isolated-switched-inbox.png')});
  await writeFile(resolve(artifacts,'results.json'),JSON.stringify({passed:true,checks,pageErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks,artifacts},null,2));
}catch(error){
  for(const [contextIndex,context] of (browser?.contexts()||[]).entries())for(const [pageIndex,page] of context.pages().entries()){
    await page.screenshot({path:resolve(artifacts,'failure-'+contextIndex+'-'+pageIndex+'.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure-'+contextIndex+'-'+pageIndex+'.html'),await page.content().catch(()=>''));
  }
  await writeFile(resolve(artifacts,'partial-results.json'),JSON.stringify({passed:false,checks,pageErrors:errors},null,2));console.error('Messaging artifacts: '+artifacts);throw error;
}finally{
  releaseReads.forEach(release=>release());await browser?.close();server?.kill('SIGTERM');
  if(server)await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(3000)]);await writeFile(resolve(artifacts,'backend.log'),serverLog);
  if(!success)console.error('Backend log: '+resolve(artifacts,'backend.log'));
}
