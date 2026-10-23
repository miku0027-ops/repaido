import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Real components and a disposable transactional API. No production requests.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.DISCOVERY_ORIGIN||'http://127.0.0.1:5187';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const work=await mkdtemp('/tmp/repaido-home-content-'),checks=[],errors=[],writes=[],feeds=new Map();
const reserve=createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));const port=reserve.address().port;await new Promise(done=>reserve.close(done));
const api='http://127.0.0.1:'+port,server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/home_discovery_api.py',work+'/test.db',String(port)],{stdio:['ignore','pipe','pipe']});
let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',value=>log+=value);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const pose=page=>page.locator('.home-welcome-poster .home-poster-current strong').innerText();
const dimensions=locator=>locator.evaluate(e=>({width:e.offsetWidth,height:e.offsetHeight}));
const settle=locator=>locator.evaluate(async e=>{await Promise.all(e.getAnimations({subtree:true}).filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
const mutations=()=>writes.filter(row=>/campaigns\/(select|selection)$|\/bookings$/.test(row.path));
async function audit(page,selector){
 return page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(row=>({id:row.id,nodes:row.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),selector);
}
try{
 let ready=false;for(let i=0;i<300;i++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await sleep(100);}assert(ready,'Fixture API starts');
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:496,height:850},reducedMotion:'reduce',timezoneId:'Asia/Kolkata'});
 await context.addInitScript(()=>localStorage.setItem('repaido.place',JSON.stringify({lat:21.4934,lng:86.9135,confirmed:true,city:'Balasore',address:'Local fixture entrance'})));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.hostname!=='127.0.0.1')return route.abort('blockedbyclient');
  if(request.isNavigationRequest()&&url.pathname==='/'){const response=await route.fetch({url:origin+'/tests/customer-rides-app-preview.html'+url.search});return route.fulfill({response});}
  if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(!['GET','HEAD'].includes(request.method()))writes.push({path:url.pathname,body:request.postData()});
  const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});
  if(url.pathname.endsWith('/campaigns/feed/personal')&&response.ok())feeds.set(request.headers().authorization,(await response.json()).cards);
  return route.fulfill({response});
 });
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/?tab=explore');
 const launcher=page.getByRole('button',{name:'Open quick actions',exact:true}),header=page.locator('.repaido-home-header');
 await launcher.waitFor();assert.equal(await header.locator('.customer-support-fab').count(),0);
 assert.equal(await page.getByRole('navigation',{name:'Bottom Navigation',exact:true}).locator('button').count(),5);
 await page.screenshot({path:work+'/home-496.png'});
 await launcher.click();const menu=page.getByRole('group',{name:'Quick actions',exact:true});
 assert.deepEqual(await menu.locator('button').allTextContents(),['Repaidians','Custom contract query','Quick Hire','Help & support']);
 await page.screenshot({path:work+'/quick-actions-496.png'});
 await page.keyboard.press('End');assert.equal(await page.locator(':focus').innerText(),'Help & support');await page.keyboard.press('Enter');
 await page.getByRole('heading',{name:'Repaido support',exact:true}).waitFor();
 assert.equal(await menu.count(),0);await page.getByRole('button',{name:'Close support chat',exact:true}).click();
 assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Open quick actions');
 checks.push('Full App: Help moves from the header into the + menu; keyboard activation opens support and closing restores focus. Five bottom destinations remain.');

 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,496])for(const scale of [100,200])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(({scale,theme})=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=theme;},{scale,theme});
  await launcher.click();
  assert.deepEqual(await audit(page,'.repaido-home-header,.compact-action-launcher,.home-greeting'),[],[width,scale,theme].join('/'));
  const issues=await page.locator('.home-greeting').evaluate(root=>{
   const problems=[],frame=root.getBoundingClientRect();
   // The intentionally clipped background circle extends past the banner.
   // Audit interactive content rather than that decorative pseudo-element.
   const controls=[...root.querySelectorAll('button')];
   for(const button of controls){const box=button.getBoundingClientRect();if(box.width<43.9||box.height<43.9)problems.push('Small target '+button.className);if(box.left<frame.left-1||box.right>frame.right+1||box.top<frame.top-1||box.bottom>frame.bottom+1)problems.push('Clipped control '+button.className);}
   for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();if(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1)problems.push('Overlapping targets');}
   return problems;
  });assert.deepEqual(issues,[],[width,scale,theme].join('/'));
  await page.keyboard.press('Escape');
 }
 checks.push('Header, greeting and quick actions: mobile reflow, 44px targets, no overlapping controls, and enhanced contrast at 320/496, 100/200% text, light/dark.');

 // Observe the live feed in the existing isolated discovery/booking harness.
 await page.setViewportSize({width:496,height:850});await page.goto(origin+'/tests/home-discovery-preview.html');
 await page.locator('.home-poster-current[aria-label]').waitFor();await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 const poster=page.locator('.home-welcome-poster'),base=await dimensions(poster);
 assert.deepEqual(base,{width:105,height:74},'Original decorative poster dimensions');
 const cards=feeds.get('Bearer customer');assert(cards?.length>1);
 const initialWrites=mutations().length;
 await page.clock.install();await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(0,0);await page.clock.runFor(100);
 await page.waitForFunction(()=>document.querySelector('.home-welcome-poster').dataset.moving==='true');
 const seen=new Set(),tones=new Set();
 for(let i=0;i<cards.length;i++){
  const label=await page.locator('.home-poster-current').getAttribute('aria-label');assert(cards.some(card=>label.includes(card.title)&&label.includes(card.service.name)),'Only returned eligible records are advertised');
  seen.add(label);tones.add(await poster.getAttribute('data-tone'));assert.deepEqual(await dimensions(poster),base);
  await settle(poster);
  assert.deepEqual(await audit(page,'.home-greeting'),[]);
  await page.clock.runFor(6500);
 }
 assert.equal(seen.size,cards.length);assert(tones.size>1);
 await page.getByRole('button',{name:'Pause home poster',exact:true}).click();const paused=await pose(page);await page.clock.runFor(14000);assert.equal(await pose(page),paused);
 await page.getByRole('button',{name:'Play home poster',exact:true}).click();await poster.hover();const reading=await pose(page);await page.clock.runFor(6500);assert.equal(await pose(page),reading);
 await page.mouse.move(0,0);await page.locator('.home-poster-current').focus();const focused=await pose(page);await page.clock.runFor(6500);assert.equal(await pose(page),focused);
 await page.locator('.home-poster-current').press('Tab');
 checks.push('Real eligible offers and restrained colours rotate in the original 105×74 poster; Pause, hover and keyboard focus freeze its content.');

 const heading=page.locator('.service-discovery-heading'),line=heading.locator('.service-heading-current');
 await heading.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.clock.runFor(100);
 const h=await dimensions(heading),text=await line.innerText();await page.clock.runFor(6500);assert.notEqual(await line.innerText(),text);assert.deepEqual(await dimensions(heading),h);
 await page.getByRole('button',{name:'Pause service cards',exact:true}).click();const still=await line.innerText();await page.clock.runFor(14000);assert.equal(await line.innerText(),still);
 await page.getByRole('button',{name:'Play service cards',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});const reduced=await line.innerText();await page.clock.runFor(7000);assert.equal(await line.innerText(),reduced);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>document.documentElement.classList.add('reduce-motion'));const appReduced=await line.innerText();await page.clock.runFor(7000);assert.equal(await line.innerText(),appReduced);
 await page.evaluate(()=>document.documentElement.classList.remove('reduce-motion'));
 await page.setViewportSize({width:496,height:300});await page.evaluate(()=>scrollTo(0,0));await page.clock.runFor(100);await page.waitForFunction(()=>document.querySelector('.service-discovery-heading').dataset.moving==='false');
 const offscreenHeading=await line.innerText();await page.clock.runFor(7000);assert.equal(await line.innerText(),offscreenHeading);
 assert.equal(mutations().length,initialWrites,'Motion never selects an offer or submits a booking');
 checks.push('Service heading slides useful information without layout movement; existing Pause, OS/app reduced motion and offscreen suspension stop rotation. Motion performs no booking or selection writes.');

 await page.setViewportSize({width:496,height:850});
 await page.getByRole('button',{name:'Pause home poster',exact:true}).click();await page.locator('.home-poster-current').click();await page.getByRole('heading',{name:'Offer applied',exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Switch test account',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.service-offer-tile').length===1);
 const stranger=feeds.get('Bearer stranger');assert.equal(stranger.length,1);
 const accountLabel=await page.locator('.home-poster-current').getAttribute('aria-label');assert(accountLabel.includes(stranger[0].service.name));
 const expiry=Math.max(...stranger.map(card=>card.ends_at));await page.clock.fastForward(Math.max(1,(expiry-Date.now()/1000+5)*1000));
 await page.locator('.home-poster-current[aria-label]').waitFor({state:'hidden'});assert.doesNotMatch(await page.locator('.home-poster-current').innerText(),/save|free|offer|special price/i);
 assert.deepEqual(await dimensions(poster),base);await page.screenshot({path:work+'/expired-offer-neutral.png'});
 checks.push('Poster selection opens the existing offer-aware booking; account changes replace eligible content, and expired offers disappear even while paused. Empty feeds show neutral highlights with the same dimensions.');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){await page?.screenshot({path:work+'/failure.png',fullPage:true}).catch(()=>{});console.error(error);console.error(log.slice(-1200));process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));console.log('Evidence: '+work);}
