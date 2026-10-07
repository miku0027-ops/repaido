import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Measured requests and bytes come from the real disposable API. Baseline mode
// uses the same fixtures/gestures against the archived preceding release.
// Cold media responses have a documented 400 ms delivery hold so simultaneous
// avatar/story/post observers exercise in-flight coalescing deterministically.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const defaultWeb=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const web=process.env.PERFORMANCE_WEB_DIR||defaultWeb,backend=resolve(web,'../backend');
const baseline=process.env.PERFORMANCE_BASELINE==='1';
const artifacts=await mkdtemp(resolve(tmpdir(),'repaidians-content-performance-'));
const db=resolve(artifacts,'community.db'),python=process.env.REPAIDIANS_TEST_PYTHON||resolve(backend,'.venv/bin/python');
const origin=process.env.REPAIDIANS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const port=Number(process.env.PERFORMANCE_TEST_PORT||8043),apiOrigin='http://127.0.0.1:'+port;
let server,browser,serverLog='',stage='setup',success=false;
const requests=[],checks=[],errors=[],releases=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shell=page=>page.getByRole('dialog',{name:'Repaidians community',exact:true});
const metrics={},counts=(stageName,predicate=()=>true)=>requests.filter(row=>row.stage===stageName&&predicate(row));
const mediaPath=row=>row.path.startsWith('/api/repaidians/media/');
const feedPath=row=>row.path==='/api/repaidians/feed';
function nativeFixtures(rows){
  const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nrows=json.loads(sys.argv[2])\ndef save(u):\n for kind,key,row in rows:u.put(kind,key,row)\nmain.operations_store.run(save)';
  const result=spawnSync(python,['-c',code,db,JSON.stringify(rows)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,expected=200,headers={}){
  const binary=Buffer.isBuffer(body),response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body&&!binary?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
  const result=await response.json().catch(()=>({}));assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(result));return result;
}
async function rawMedia(url,account,headers={}){
  const response=await fetch(apiOrigin+url,{headers:{Authorization:'Bearer '+account.token,...headers}});return {status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())};
}
async function register(name){return api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','.')+'@performance.test',password:'isolated-test-password'},201);}
async function upload(account,file,mime){const value=await api('/repaidians/media',account,'POST',await readFile(file),201,{'Content-Type':mime});return {url:value.url,kind:value.kind,alt:'Real isolated performance fixture'};}
async function publication(account,kind,media,caption,visibility='public'){return (await api('/repaidians/publications',account,'POST',{kind,trade:'electrician',visibility,caption,media:[media],clientId:randomUUID()},201)).item;}
async function settle(page){await page.waitForLoadState('networkidle');}
async function newPage(account,{clock=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});await context.routeWebSocket('**',socket=>socket.close());
  await context.addInitScript(token=>localStorage.setItem('repaido.token',token),account.token);
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),currentStage=stage;
    const response=await route.fetch({url:apiOrigin+url.pathname+url.search});
    const bytes=(await response.body()).length;
    requests.push({stage:currentStage,path:url.pathname,search:url.search,method:request.method(),status:response.status(),bytes,authorization:request.headers().authorization?'signed':'guest'});
    if(currentStage==='cold'&&url.pathname.startsWith('/api/repaidians/media/'))await pause(400);
    await route.fulfill({response});
  });
  const page=await context.newPage();if(clock)await page.clock.install({time:new Date()});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/tests/repaidians-preview.html');await shell(page).waitFor();await shell(page).locator('.rp-loading').waitFor({state:'hidden'});await settle(page);return page;
}
async function nav(page,name){await shell(page).locator('.rp-bottom-nav').getByRole('button',{name,exact:true}).click();await settle(page);}
async function switchAccount(page,account){
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/repaidians/state'&&response.request().headers().authorization==='Bearer '+account.token);
  await page.evaluate(({token,id})=>{localStorage.setItem('repaido.token',token);window.dispatchEvent(new CustomEvent('repaidians-preview-account',{detail:id}));},{token:account.token,id:account.user.id});
  assert.equal((await(await response).json()).member.id,account.user.id);await shell(page).locator('.rp-loading').waitFor({state:'hidden'});
}
async function holdMedia(page,url){
  let release,captured,finished,calls=0;const barrier=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{captured=resolve;}),done=new Promise(resolve=>{finished=resolve;});releases.push(release);
  const pattern='**'+url,handler=async route=>{calls++;const response=await route.fetch({url:apiOrigin+url});assert.equal(response.status(),200);captured((await response.body()).length);await barrier;await route.fulfill({response});finished();};
  await page.context().route(pattern,handler);return {reached,done,release,count:()=>calls,remove:()=>page.context().unroute(pattern,handler)};
}
async function service(page,method,...args){return page.evaluate(async({method,args})=>{const services=await import('/src/services/repaidiansService.ts');const value=await services[method](...args);return value instanceof Blob?{bytes:value.size,type:value.type}:value;},{method,args});}
async function filterLayout(page){
  const variants=[];await page.addScriptTag({path:require.resolve('axe-core')});
  for(const width of [320,509])for(const theme of ['light','dark'])for(const text of [100,200]){
    await page.setViewportSize({width,height:850});await page.evaluate(({theme,text})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=text+'%';},{theme,text});
    const geometry=await shell(page).evaluate(root=>({overflow:root.scrollWidth>root.clientWidth+1||root.querySelector('.rp-content').scrollWidth>root.querySelector('.rp-content').clientWidth+1,buttons:[...root.querySelectorAll('.rp-genres button')].map(button=>{const r=button.getBoundingClientRect();return {name:button.getAttribute('aria-label')||button.textContent,width:r.width,height:r.height};})}));
    assert.equal(geometry.overflow,false);assert.equal(geometry.buttons.length,10);for(const button of geometry.buttons)assert.ok(button.width>=44&&button.height>=44,'Publication filter remains touchable: '+JSON.stringify({width,theme,text,...button}));
    const violations=await page.evaluate(async()=>(await window.axe.run(document.querySelector('.rp-shell'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(row=>({id:row.id,nodes:row.nodes.map(node=>node.target)})));assert.deepEqual(violations,[]);variants.push({width,theme,text});
  }
  await page.setViewportSize({width:390,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});return variants;
}

try{
  server=spawn(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port',String(port)],{cwd:backend,env:{...process.env,REPAIDO_STORAGE:'sqlite',REPAIDO_DB:db,REPAIDO_COMMUNITY_MEDIA_DIR:resolve(artifacts,'media'),REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>serverLog+=chunk.toString());
  for(let attempt=0;attempt<100;attempt++){if(server.exitCode!==null)throw new Error('Isolated backend stopped: '+serverLog);try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}if(attempt===99)throw new Error('Backend did not become ready');await pause(200);}
  const alice=await register('Alice Performance'),bob=await register('Bob Performance'),carol=await register('Carol Performance');
  nativeFixtures([alice,bob,carol].map(account=>['workers',account.user.id,{id:account.user.id,name:account.user.name,status:'approved',role:'technician',categories:['electrician'],city:'Balasore',skills:['Wiring'],experience_years:5}]));
  for(const account of [alice,bob,carol]){await api('/repaidians/state',account);await api('/repaidians/profile',account,'PATCH',{name:account.user.name,trade:account===carol?'cleaning':'electrician',bio:'Real disposable performance fixture.'});}
  const photo=await upload(bob,resolve(web,'public/images/electrical.jpg'),'image/jpeg');await api('/repaidians/profile',bob,'PATCH',{avatarUrl:photo.url});
  const clip=resolve(artifacts,'work.webm'),ffmpeg=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=4','-an','-c:v','libvpx','-b:v','1M','-y',clip],{encoding:'utf8'});assert.equal(ffmpeg.status,0,ffmpeg.stderr);
  const video=await upload(bob,clip,'video/webm'),hiddenVideo=await upload(bob,clip,'video/webm');
  for(let index=0;index<11;index++)await publication(bob,'post',photo,'Shared photo '+String(index).padStart(2,'0')+' with the same protected avatar.');
  await publication(bob,'story',photo,'The same protected photo in a genuine story.');
  await publication(bob,'reel',hiddenVideo,'A work video below the visible reel.');await publication(bob,'reel',video,'A genuine visible work video.');
  const privatePhoto=await upload(alice,resolve(web,'public/images/bathroom.jpg'),'image/jpeg');
  const privatePost=await publication(alice,'post',privatePhoto,'Electrical trade private portfolio.', 'trade');
  metrics.fixture={posts:12,stories:1,reels:2,videoBytes:(await rawMedia(video.url,alice)).body.length,coldMediaDeliveryHoldMs:400};
  const full=await api('/repaidians/state',alice),compact=await api('/repaidians/state?content=compact',alice);
  metrics.state={fullBytes:Buffer.byteLength(JSON.stringify(full)),compactBytes:Buffer.byteLength(JSON.stringify(compact)),compactPosts:compact.data.posts.length,compactStories:compact.data.stories.length,compactReels:compact.data.reels.length};
  if(!baseline){for(const lane of ['posts','stories','reels','tenders'])assert.deepEqual(compact.data[lane],[]);assert.equal(compact.member.id,full.member.id);assert.deepEqual(compact.capabilities,full.capabilities);checks.push('Compact metadata has no feed lanes and retains canonical identity, capabilities and trial metadata');}
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  stage='cold';const page=await newPage(alice);assert.equal(await shell(page).locator('.rp-post').count(),12);
  metrics.cold={apiRequests:counts(stage).length,feedRequests:counts(stage,feedPath).length,stateRequests:counts(stage,row=>row.path==='/api/repaidians/state').length,avatarDownloads:counts(stage,row=>row.path===photo.url).length,videoDownloads:counts(stage,row=>row.path===video.url).length,bytes:counts(stage).reduce((sum,row)=>sum+row.bytes,0)};
  assert.equal(metrics.cold.videoDownloads,0,'An offscreen feed video does not fetch its bytes.');
  if(!baseline){assert.equal(metrics.cold.avatarDownloads,1,'Concurrent author/story/media uses coalesce the protected asset request.');assert.ok(counts('cold',row=>row.path==='/api/repaidians/state').every(row=>new URLSearchParams(row.search).get('content')==='compact'));checks.push('Cold real feed retains twelve publications, coalesces duplicate protected assets and leaves offscreen video unfetched');}
  stage='first-works';await nav(page,'Works');await shell(page).getByLabel('Work videos',{exact:true}).waitFor();
  metrics.hiddenVideoDownloads=counts(stage,row=>row.path===hiddenVideo.url).length;assert.equal(metrics.hiddenVideoDownloads,0,'An offscreen mounted reel never fetches its video bytes.');await nav(page,'Home');
  stage='warm-tabs';for(let index=0;index<3;index++){await nav(page,'Works');await nav(page,'Home');}
  metrics.warmTabs={cycles:3,feedRequests:counts(stage,feedPath).length,mediaDownloads:counts(stage,mediaPath).length,bytes:counts(stage).reduce((sum,row)=>sum+row.bytes,0)};
  if(!baseline){assert.equal(metrics.warmTabs.feedRequests,0);assert.equal(metrics.warmTabs.mediaDownloads,0);checks.push('Three actual warm Home/Works round trips request no repeated feed or protected media bytes');}
  stage='story-reopen';for(let index=0;index<2;index++){await shell(page).getByRole('button',{name:'View '+bob.user.name+' stories',exact:true}).click();const story=page.getByRole('dialog',{name:'Story by '+bob.user.name,exact:true});await story.locator('img.rp-media').waitFor();await story.getByRole('button',{name:'Close story',exact:true}).click();await settle(page);}
  metrics.storyReopen={opens:2,mediaDownloads:counts(stage,mediaPath).length};if(!baseline)assert.equal(metrics.storyReopen.mediaDownloads,0);
  stage='idle';await page.waitForTimeout(31000);await settle(page);
  metrics.idle={seconds:31,apiRequests:counts(stage).length,stateRequests:counts(stage,row=>row.path==='/api/repaidians/state').length,usageRequests:counts(stage,row=>row.path==='/api/repaidians/usage').length,feedRequests:counts(stage,feedPath).length,mediaDownloads:counts(stage,mediaPath).length,bytes:counts(stage).reduce((sum,row)=>sum+row.bytes,0)};
  if(!baseline){assert.equal(metrics.idle.feedRequests,0,'Metadata polling never rehydrates the loaded feed.');assert.equal(metrics.idle.mediaDownloads,0);assert.ok(metrics.idle.stateRequests<=2&&metrics.idle.usageRequests<=4);checks.push('Thirty-one visible idle seconds refresh only bounded live metadata/usage without feed or media reloads');}
  stage='pre-like-warm';await service(page,'feed','post','all','all','',undefined,12);
  stage='like-invalidation';const post=shell(page).locator('.rp-post').filter({hasText:'Shared photo 09'});await post.getByRole('button',{name:'Like post',exact:true}).click();await post.getByRole('button',{name:'Unlike post',exact:true}).waitFor();await settle(page);
  const automaticFeedRequests=counts(stage,feedPath).length;if(!baseline)assert.equal(automaticFeedRequests,0,'A canonical like updates the visible row without hydrating the feed.');
  const loaded=await service(page,'feed','post','all','all','',undefined,12);assert.equal(loaded.items.find(item=>item.caption.startsWith('Shared photo 09')).likeCount,1);
  metrics.likeMutation={automaticFeedRequests,feedRequests:counts(stage,feedPath).length,mediaDownloads:counts(stage,mediaPath).length};
  if(!baseline){assert.ok(metrics.likeMutation.feedRequests>=1,'Mutation invalidates an already warm feed.');assert.equal(metrics.likeMutation.mediaDownloads,0,'A like does not discard protected image bytes.');checks.push('A real like invalidates cached feed counts while retaining authorized media bytes');}
  if(!baseline){
    stage='server-media';const fresh=await rawMedia(privatePhoto.url,alice);assert.equal(fresh.status,200);assert.ok(fresh.headers.etag);assert.match(fresh.headers['cache-control'],/private/);assert.match(fresh.headers['cache-control'],/must-revalidate/);assert.match(fresh.headers.vary,/Authorization/i);assert.equal((await rawMedia(privatePhoto.url,alice,{'If-None-Match':fresh.headers.etag})).status,304);assert.equal((await rawMedia(privatePhoto.url,carol,{'If-None-Match':fresh.headers.etag})).status,404);
    const range=await rawMedia(video.url,alice,{Range:'bytes=2-130'});assert.equal(range.status,206);assert.equal(range.body.length,129);assert.equal(range.headers['content-range'],'bytes 2-130/'+metrics.fixture.videoBytes);assert.deepEqual(range.body,(await rawMedia(video.url,alice)).body.subarray(2,131));assert.equal((await rawMedia(video.url,alice,{Range:'bytes=2-130','If-Range':'"wrong-generation"'})).status,200);assert.equal((await rawMedia(video.url,alice,{Range:'bytes=999999999-'})).status,416);
    await api('/repaidians/publications/'+privatePost.id,alice,'DELETE');assert.equal((await rawMedia(privatePhoto.url,alice,{'If-None-Match':fresh.headers.etag})).status,304,'The owner can revalidate her retained upload.');assert.equal((await rawMedia(privatePhoto.url,bob,{'If-None-Match':fresh.headers.etag})).status,404,'Deleting the only visible publication revokes another professional viewer.');
    const revokePhoto=await upload(bob,resolve(web,'public/images/cleaning.jpg'),'image/jpeg'),revokePost=await publication(bob,'post',revokePhoto,'A live protected asset will be revoked.');
    const authorized=await rawMedia(revokePhoto.url,alice);assert.equal(authorized.status,200);assert.equal((await rawMedia(revokePhoto.url,alice,{'If-None-Match':authorized.headers.etag})).status,304);
    assert.ok((await service(page,'loadMedia',revokePhoto.url)).bytes>0);
    await service(page,'blockMember',bob.user.id,true);assert.equal((await rawMedia(revokePhoto.url,alice,{'If-None-Match':authorized.headers.etag})).status,404);await assert.rejects(()=>service(page,'loadMedia',revokePhoto.url),/Media is unavailable/);
    await service(page,'blockMember',bob.user.id,false);assert.ok((await service(page,'loadMedia',revokePhoto.url)).bytes>0);await api('/repaidians/publications/'+revokePost.id,bob,'DELETE');assert.equal((await rawMedia(revokePhoto.url,alice,{'If-None-Match':authorized.headers.etag})).status,404);
    checks.push('Real media responses deliver exact bounded ranges/ETag revalidation; blocking invalidates warm browser media, and hidden/blocked/deleted content never returns unauthorized 304');
    stage='observer-cancellation';const observerPhoto=await upload(alice,resolve(web,'public/images/cleaning.jpg'),'image/jpeg'),shared=await holdMedia(page,observerPhoto.url);
    await page.evaluate(url=>{window.performanceObserverController=new AbortController();window.performanceObserverOutcome='pending';void import('/src/services/repaidiansService.ts').then(service=>Promise.allSettled([service.loadMedia(url,window.performanceObserverController.signal),service.loadMedia(url)])).then(rows=>{window.performanceObserverOutcome=rows.map(row=>row.status==='fulfilled'?{status:row.status,bytes:row.value.size}:{status:row.status,error:row.reason.name});});},observerPhoto.url);
    assert.ok(await shared.reached>0);await page.evaluate(()=>window.performanceObserverController.abort());shared.release();await shared.done;await shared.remove();await page.waitForFunction(()=>window.performanceObserverOutcome!=='pending');
    const observerOutcome=await page.evaluate(()=>window.performanceObserverOutcome);assert.deepEqual(observerOutcome[0],{status:'rejected',error:'AbortError'});assert.equal(observerOutcome[1].status,'fulfilled');assert.ok(observerOutcome[1].bytes>0);assert.equal(shared.count(),1);
    stage='failed-media';const unavailableUrl='/api/repaidians/media/'+randomUUID();
    const failures=await page.evaluate(async url=>{const service=await import('/src/services/repaidiansService.ts');return (await Promise.allSettled([service.loadMedia(url),service.loadMedia(url)])).map(row=>row.status);},unavailableUrl);assert.deepEqual(failures,['rejected','rejected']);assert.equal(counts(stage,row=>row.path===unavailableUrl).length,1);await assert.rejects(()=>service(page,'loadMedia',unavailableUrl),/Media is unavailable/);assert.equal(counts(stage,row=>row.path===unavailableUrl).length,2);
    checks.push('One media observer can abort without canceling its shared peer; failed coalesced media reads never become a cached success and a later read retries');
    stage='mutation-generation';const settingsPhoto=await upload(alice,resolve(web,'public/images/washer.jpg'),'image/jpeg'),settingsHeld=await holdMedia(page,settingsPhoto.url);
    await page.evaluate(url=>{window.performanceSettingsOutcome='pending';void import('/src/services/repaidiansService.ts').then(service=>service.loadMedia(url)).then(()=>{window.performanceSettingsOutcome='resolved';}).catch(error=>{window.performanceSettingsOutcome=error.code||error.name;});},settingsPhoto.url);
    assert.ok(await settingsHeld.reached>0);await service(page,'updateSettings',{likeNotifications:false});settingsHeld.release();await settingsHeld.done;await settingsHeld.remove();await page.waitForFunction(()=>window.performanceSettingsOutcome!=='pending');assert.equal(await page.evaluate(()=>window.performanceSettingsOutcome),'MEDIA_CHANGED');assert.ok((await service(page,'loadMedia',settingsPhoto.url)).bytes>0);assert.equal(counts(stage,row=>row.path===settingsPhoto.url).length,1,'A fresh post-mutation read actually goes back to the authorized server.');
    checks.push('A privacy-settings mutation rejects late pre-mutation protected bytes and the following authorized read performs a fresh fetch');
    stage='identity-cache';const racePhoto=await upload(alice,resolve(web,'public/images/bathroom.jpg'),'image/jpeg');await publication(alice,'post',racePhoto,'Electrical-only delayed protected bytes.','trade');
    const held=await holdMedia(page,racePhoto.url);await page.evaluate(url=>{window.performanceMediaOutcome='pending';void import('/src/services/repaidiansService.ts').then(service=>service.loadMedia(url)).then(()=>{window.performanceMediaOutcome='resolved';}).catch(error=>{window.performanceMediaOutcome=error.code||error.name;});},racePhoto.url);assert.ok(await held.reached>0);await switchAccount(page,carol);held.release();await held.done;await held.remove();await page.waitForFunction(()=>window.performanceMediaOutcome!=='pending');assert.equal(await page.evaluate(()=>window.performanceMediaOutcome),'ACCOUNT_CHANGED');
    await assert.rejects(()=>service(page,'loadMedia',racePhoto.url),/Media is unavailable/);assert.equal(await shell(page).getByText('Electrical-only delayed protected bytes.',{exact:true}).count(),0);
    checks.push('Account switching rejects already-authorized delayed media and the new account cannot use the previous account content/media cache');
    stage='mounted-expiry-setup';const expiryPhoto=await upload(bob,resolve(web,'public/images/electrical.jpg'),'image/jpeg'),expiryCaption='A mounted photo must revalidate after external access revocation.';await publication(bob,'post',expiryPhoto,expiryCaption);
    const expiryPage=await newPage(alice,{clock:true}),expiryPost=shell(expiryPage).locator('.rp-post').filter({hasText:expiryCaption});await expiryPost.locator('img.rp-media').waitFor();assert.match(await expiryPost.locator('img.rp-media').getAttribute('src'),/^blob:/);
    metrics.filterVariants=await filterLayout(expiryPage);
    const refreshing=expiryPage.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/repaidians/feed'&&url.searchParams.get('kind')==='post';});await shell(expiryPage).getByRole('button',{name:'Refresh feed',exact:true}).click();await refreshing;await settle(expiryPage);await expiryPost.locator('img.rp-media').waitFor();checks.push('Eight filter/refresh row viewport, theme and enlarged-text variants retain 44-pixel controls, no horizontal overflow and WCAG AA; Refresh performs a live feed read');
    const hiddenPage=await newPage(alice,{clock:true});await shell(hiddenPage).locator('.rp-post').filter({hasText:expiryCaption}).locator('img.rp-media').waitFor();await nav(hiddenPage,'Work & market');stage='hidden-expiry';await hiddenPage.clock.fastForward(61000);await settle(hiddenPage);assert.equal(counts(stage,row=>row.path===expiryPhoto.url).length,0,'Leaving the protected media view never polls its expired bytes.');
    // Revoke in another genuine server session, without emitting a local
    // mutation event. The mounted consumer has to re-authorize at its own TTL.
    await api('/repaidians/blocks/'+bob.user.id,alice,'PUT',{active:true});
    let releaseDenied,capturedDenied,finishedDenied,deniedRequests=0;const deniedBarrier=new Promise(resolve=>{releaseDenied=resolve;}),deniedReached=new Promise(resolve=>{capturedDenied=resolve;}),deniedDone=new Promise(resolve=>{finishedDenied=resolve;});releases.push(releaseDenied);
    const deniedPattern='**'+expiryPhoto.url,deniedHandler=async route=>{deniedRequests++;const response=await route.fetch({url:apiOrigin+expiryPhoto.url});capturedDenied(response.status());await deniedBarrier;await route.fulfill({response});finishedDenied();};await expiryPage.context().route(deniedPattern,deniedHandler);
    stage='visible-expiry';await expiryPage.clock.fastForward(61000);assert.equal(await deniedReached,404);assert.equal(await expiryPost.locator('img.rp-media').count(),0,'The old protected blob is hidden while live permission is checked.');releaseDenied();await deniedDone;await expiryPage.context().unroute(deniedPattern,deniedHandler);await expiryPost.getByText('This media could not be loaded.',{exact:true}).waitFor();assert.equal(await expiryPost.locator('img.rp-media').count(),0);assert.equal(deniedRequests,1);
    metrics.mediaExpiry={frontendClockAdvanceMs:61000,hiddenAssetRefreshes:0,visibleAssetRefreshes:deniedRequests,liveDeniedStatus:404,oldBlobHiddenDuringCheck:true,oldBlobHiddenAfterDenial:true};checks.push('Original media TTL rechecks a genuinely mounted photo after external revocation, hides its old blob while checking and after denial, and never refreshes hidden consumers');
  }
  assert.deepEqual(errors,[]);success=true;
  let comparison;
  if(process.env.PERFORMANCE_BASELINE_RESULTS){const previous=JSON.parse(await readFile(process.env.PERFORMANCE_BASELINE_RESULTS,'utf8')).metrics;comparison={coldAvatarDownloads:[previous.cold.avatarDownloads,metrics.cold.avatarDownloads],warmFeedRequests:[previous.warmTabs.feedRequests,metrics.warmTabs.feedRequests],idleFeedRequests:[previous.idle.feedRequests,metrics.idle.feedRequests],idleBytes:[previous.idle.bytes,metrics.idle.bytes],compactStateBytes:[previous.state.compactBytes,metrics.state.compactBytes]};}
  await page.screenshot({path:resolve(artifacts,'real-content-state.png')});
  const result={passed:true,baseline,checks,metrics,comparison,pageErrors:errors,artifacts};await writeFile(resolve(artifacts,'results.json'),JSON.stringify(result,null,2));await writeFile(resolve(artifacts,'requests.json'),JSON.stringify(requests,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){
  for(const [contextIndex,context] of (browser?.contexts()||[]).entries())for(const [pageIndex,page] of context.pages().entries()){await page.screenshot({path:resolve(artifacts,'failure-'+contextIndex+'-'+pageIndex+'.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure-'+contextIndex+'-'+pageIndex+'.html'),await page.content().catch(()=>''));}
  await writeFile(resolve(artifacts,'partial-results.json'),JSON.stringify({passed:false,baseline,checks,metrics,pageErrors:errors},null,2));await writeFile(resolve(artifacts,'requests.json'),JSON.stringify(requests,null,2));console.error('Content performance artifacts: '+artifacts);throw error;
}finally{
  releases.forEach(release=>release());await browser?.close();server?.kill('SIGTERM');if(server)await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(3000)]);await writeFile(resolve(artifacts,'backend.log'),serverLog);if(!success)console.error('Backend log: '+resolve(artifacts,'backend.log'));
}
