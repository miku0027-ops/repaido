import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-refinement-')),port=8047,origin='http://127.0.0.1:5187',api='http://127.0.0.1:'+port;
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/refinement_api.py',work+'/test.db',String(port)],{cwd:resolve(web,'../backend'),stdio:['ignore','pipe','pipe']});let log='',browser;for(const s of [server.stdout,server.stderr])s.on('data',d=>log+=d);
const errors=[],checks=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const trackingMeasurements=[];
function measureTracking({section,index}){
 const issues=[],sheet=document.querySelector('.repaido-tracking-sheet'),tolerance=1.5;
 const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const describe=node=>node.getAttribute('aria-label')||node.className||node.tagName;
 const required=selector=>{const node=sheet.querySelector(selector);if(!node)throw Error('Missing tracking element: '+selector);return node;};
 const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>tolerance&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>tolerance;
 const contained=(a,b)=>a.left>=b.left-tolerance&&a.right<=b.right+tolerance&&a.top>=b.top-tolerance&&a.bottom<=b.bottom+tolerance;
 function visibleBounds(node){
  const bounds={left:0,right:innerWidth,top:0,bottom:innerHeight};
  for(let parent=node.parentElement;parent;parent=parent.parentElement){
   const style=getComputedStyle(parent),r=rect(parent);
   if(/auto|scroll|hidden|clip/.test(style.overflowX)){bounds.left=Math.max(bounds.left,r.left+parent.clientLeft);bounds.right=Math.min(bounds.right,r.left+parent.clientLeft+parent.clientWidth);}
   if(/auto|scroll|hidden|clip/.test(style.overflowY)){bounds.top=Math.max(bounds.top,r.top+parent.clientTop);bounds.bottom=Math.min(bounds.bottom,r.top+parent.clientTop+parent.clientHeight);}
  }
  return bounds;
 }
 function inspect(node,label=describe(node)){
  const box=rect(node),bounds=visibleBounds(node),fragments=[];
  if(!box.width||!box.height||!contained(box,bounds))issues.push({label,problem:'element clipped or outside the visible scrollport',box,bounds});
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text;
  while(text=walker.nextNode())for(const match of text.textContent.matchAll(/[^\s-]+/g)){
   const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);
   const parts=[...range.getClientRects()].filter(r=>r.width&&r.height).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}));
   if(parts.some(r=>Math.abs(r.top-parts[0].top)>tolerance))issues.push({label,word:match[0],problem:'word split across lines',parts});
   for(const part of parts){if(!contained(part,box)||!contained(part,bounds))issues.push({label,word:match[0],problem:'text clipped or outside its element',part,box,bounds});fragments.push(part);}
  }
  return {label,box,fragments};
 }
 function separate(entries){for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
  const a=entries[i],b=entries[j];
  if((a.fragments.length?a.fragments:[a.box]).some(ar=>(b.fragments.length?b.fragments:[b.box]).some(br=>overlaps(ar,br))))issues.push({problem:'text or controls overlap',first:a.label,second:b.label,firstBox:a.box,secondBox:b.box});
 }}
 function control(node){const measured=inspect(node),r=measured.box,hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);if(!hit||!node.contains(hit))issues.push({label:measured.label,problem:'control obscured at its centre',hit:hit&&describe(hit)});return measured;}
 let measured;
 if(section==='header'){
  const header=required('.rt-header');
  measured=[...header.querySelectorAll('.rt-service-title,.rt-live-badge,.rt-job-id,.rt-pulse-dot,.rt-dot-separator')].map(node=>inspect(node));
  measured.push(control(required('[aria-label="Back to bookings"]')),control(required('[aria-label="Refresh status"]')));separate(measured);
 }else if(section==='toolbar'){
  const toolbar=required('.rt-map-toolbar'),chip=required('.rt-map-chip'),actions=[...toolbar.querySelectorAll('button')];
  measured=[inspect(chip),...actions.map(control)];separate(measured);
  const status=[...chip.querySelectorAll('.rt-map-chip-icon,strong,small')].map(node=>inspect(node));separate(status);measured.push(...status);
  if(overlaps(rect(toolbar),rect(required('.rt-map-area'))))issues.push({problem:'map status toolbar overlaps the map viewport'});
 }else if(section==='map'){
  const map=required('.rt-map-area'),bounds=rect(map);measured=[...map.querySelectorAll('.leaflet-control-zoom a,.leaflet-control-attribution,.rt-location-status')].map(node=>node.matches('a')?control(node):inspect(node));separate(measured);
  for(const item of measured)if(!contained(item.box,bounds))issues.push({label:item.label,problem:'map chrome outside map viewport',box:item.box,bounds});
 }else{
  const rail=required('.rt-milestone-bar'),item=rail.querySelectorAll('.rt-step-item')[index],label=item.querySelector('.rt-step-label'),indicator=item.querySelector('.rt-step-indicator');
  measured=[inspect(label),inspect(indicator)];separate(measured);
  const labels=[...rail.querySelectorAll('.rt-step-label')].map(node=>({label:node.textContent,box:rect(node),fragments:[]}));separate(labels);
  const railBounds=rect(rail);for(const entry of measured)if(!contained(entry.box,railBounds))issues.push({label:entry.label,problem:'milestone remains clipped after scrolling into view',box:entry.box,railBounds});
 }
 return {section,index,issues,measured};
}
async function trackingGeometry(page,name){
 const measurements=[],evidence={variant:name,rail:null,measurements};trackingMeasurements.push(evidence);
 for(const [section,selector] of [['header','.rt-header'],['toolbar','.rt-map-toolbar'],['map','.rt-map-area']]){
  await page.locator(selector).scrollIntoViewIfNeeded();const measured=await page.evaluate(measureTracking,{section});measurements.push(measured);if(measured.issues.length)await page.screenshot({path:work+'/'+name+'-'+section+'-geometry-failure.png'});assert.deepEqual(measured.issues,[],name+' '+JSON.stringify(measured.issues));
 }
 const rail=page.locator('.rt-milestone-bar');await rail.scrollIntoViewIfNeeded();
 const initial=await rail.evaluate(node=>{node.scrollLeft=0;return {clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,overflowX:getComputedStyle(node).overflowX,tabIndex:node.tabIndex};});evidence.rail=initial;
 if(initial.scrollWidth>initial.clientWidth+1){
  assert.match(initial.overflowX,/^(auto|scroll)$/,name+' milestone overflow must allow user scrolling');assert.ok(initial.tabIndex>=0,name+' scrollable milestones must be keyboard reachable');
  await rail.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.rt-milestone-bar').scrollLeft>0,{},{timeout:2000});
 }
 const items=rail.locator('.rt-step-item');assert.equal(await items.count(),5,name+' retains every progress milestone');
 for(let index=0;index<await items.count();index++){
  await items.nth(index).scrollIntoViewIfNeeded();const measured=await page.evaluate(measureTracking,{section:'milestone',index});measurements.push(measured);if(measured.issues.length||name.includes('-320-')&&name.endsWith('-200'))await page.screenshot({path:work+'/'+name+'-milestone-'+(index+1)+'.png'});assert.deepEqual(measured.issues,[],name+' '+JSON.stringify(measured.issues));
 }
 await rail.evaluate(node=>node.scrollLeft=0);await page.locator('.repaido-tracking-sheet').evaluate(node=>node.scrollTop=0);await page.locator('.rt-header').scrollIntoViewIfNeeded();
}
async function layout(page,name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' overflow');await page.screenshot({path:work+'/'+name+'.png',fullPage:true});}
async function variants(page,name){for(const width of [320,520,1440])for(const theme of ['light','dark'])for(const scale of [100,200]){await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});const variant=name+'-'+width+'-'+theme+'-'+scale;if(name==='tracking')await trackingGeometry(page,variant);await layout(page,variant);await axe(page,await page.locator('dialog[open]').count()?'dialog[open]':'main');}await page.setViewportSize({width:520,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});checks.push(name+' responsive');if(name==='tracking')checks.push('tracking header and map controls do not collide; all whole-word milestones are visible or keyboard-scrollable at every text/theme/width variant');}
async function axe(page,selector='main'){if(!await page.evaluate(()=>Boolean(window.axe)))await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});const result=await page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),selector);assert.deepEqual(result,[],JSON.stringify(result));}
try{
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:520,height:850},reducedMotion:'reduce',hasTouch:true});await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:api+url.pathname+url.search});await route.fulfill({response});});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();const body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+body});});const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tests/refinement-preview.html?mode=contracts');await page.getByRole('button',{name:'New requirement',exact:true}).click();await page.getByLabel('What work do you need?').fill('Fixture electrical work');await page.getByLabel('Scope and expected outcome').fill('Inspect and repair the recorded office circuits.');await page.getByLabel('Project sector').fill('Office');await page.getByRole('combobox',{name:'Work category'}).selectOption('electrician');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('City',{exact:true}).fill('Balasore');await page.getByLabel('Area or neighbourhood').fill('Fixture area');await page.getByLabel('Private work site address').fill('Private fixture site 123');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Required skills').fill('Electrical inspection');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Planned total budget (₹)').fill('20000');
 const localTime=seconds=>new Date(Date.now()+seconds*1000).toISOString().slice(0,16);await page.getByLabel('Work starts').fill(localTime(86400*3));await page.getByLabel('Work ends').fill(localTime(86400*5));await page.getByLabel('Proposal deadline').fill(localTime(86400));await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Work, completion and agreement terms').fill('Fixture agreed work and customer completion approval required.');await variants(page,'contract-review');await axe(page);await page.getByLabel('I am authorized to request this work').check();await page.getByRole('button',{name:'Post requirement',exact:true}).click();await page.getByRole('heading',{name:'Fixture electrical work',exact:true}).waitFor();checks.push('contract staged real submission');
 await page.goto(origin+'/tests/refinement-preview.html?mode=desk&uid=worker2');await page.getByRole('button',{name:'Fleet',exact:true}).click();await page.getByRole('button',{name:'Edit vehicle & rates',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Cab / extra rental km (₹)').fill('17.25');await page.getByLabel('Rental daily rate (₹)').fill('2400');await page.getByRole('button',{name:'Continue',exact:true}).click();await variants(page,'vehicle-editor');await axe(page,'dialog');await page.getByRole('button',{name:'Save vehicle & rates',exact:true}).click();await page.getByText('₹2,400.00/day',{exact:true}).waitFor();checks.push('owner tariff update persisted');await page.getByRole('button',{name:'Schedule',exact:true}).click();await variants(page,'owner-calendar');
 await page.goto(origin+'/tests/refinement-preview.html?mode=mobility');await page.getByRole('button',{name:'Find a cab',exact:true}).click();await page.getByLabel('Pickup date & time').fill(localTime(7200));await page.getByLabel('Expected trip end').fill(localTime(18000));await page.getByRole('button',{name:'Continue',exact:true}).click();await variants(page,'cab-route');await axe(page);checks.push('cab dates and route stages');
 await page.getByRole('button',{name:/Destination.*Choose on the map/i}).click();await page.getByLabel('House, street and landmark').fill('Fixture destination entrance 456');await page.getByLabel('City',{exact:true}).fill('Balasore');await page.getByLabel('I have checked that this pin marks my service entrance.').check();await page.getByRole('button',{name:'Confirm this location',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Calculate full price'}).first().click();await page.getByRole('button',{name:'Continue',exact:true}).click();await variants(page,'cab-quote-review');await page.locator('input[type=checkbox]').check();await page.getByRole('button',{name:'Send booking request',exact:true}).click();await page.getByText('Request sent. Follow it in Bookings → Rides.',{exact:true}).waitFor();await page.getByText('Your bookings',{exact:true}).click();await page.locator('.business-record').first().waitFor();await page.getByText('Trip & record details',{exact:true}).first().click();await page.getByText('Fixture pickup entrance 123 → Fixture destination entrance 456',{exact:true}).waitFor();checks.push('cab request and road-distance quote persisted');
 await page.goto(origin+'/tests/refinement-preview.html?mode=scrap');await page.getByRole('button',{name:'Sell scrap',exact:true}).click();await page.getByLabel('Scrap details').fill('Fixture clean steel household scrap');await page.getByRole('button',{name:'Continue',exact:true}).click();await variants(page,'scrap-pickup');await axe(page);checks.push('scrap staged entry');
 await page.goto(origin+'/tests/refinement-preview.html?mode=hiring');await page.getByRole('button',{name:/All categories/}).click();await page.getByRole('button',{name:'View profile',exact:true}).first().click();await page.locator('.hire-full-profile').waitFor();await variants(page,'hire-profile');const cta=page.locator('.hire-profile-scroll .professional-profile-actions');assert.equal(await cta.count(),1);await page.locator('.hire-profile-scroll').evaluate(n=>n.scrollTop=n.scrollHeight);await cta.scrollIntoViewIfNeeded();await axe(page,'dialog[open]');const availability=page.waitForResponse(response=>response.url().endsWith('/hiring/search')&&response.request().method()==='POST');await cta.getByRole('button',{name:/for a day$/}).click();const availabilityResponse=await availability;assert.equal(availabilityResponse.status(),200);assert.equal((await availabilityResponse.json()).professionals.some(person=>person.id==='worker'),false,'tracking fixture professional is already busy');await cta.getByRole('alert').filter({hasText:'This professional is not available for day hiring at this location right now.'}).waitFor();assert.equal(await page.locator('.hire-booking-wizard').count(),0);checks.push('profile records and day-hire CTA reject the busy tracking professional after a real availability check');
 await page.goto(origin+'/tests/refinement-preview.html?mode=tracking');await page.locator('.rt-map-area').waitFor();await page.locator('.rt-agent-marker').waitFor();const map=page.locator('.rt-map-area');const mapId=await page.locator('.rt-leaflet-container').evaluate(n=>n._leaflet_id);const zoom=()=>page.locator('img.leaflet-tile').evaluateAll(ns=>Math.max(...ns.map(n=>Number(n.src.match(/\.openstreetmap\.org\/(\d+)\//)?.[1]||0))));const beforeZoom=await zoom();await page.locator('.leaflet-control-zoom-in').click();await pause(500);const afterZoom=await zoom();assert(afterZoom>beforeZoom,'zoom control');await fetch(api+'/test-only/position',{method:'POST'});await pause(16000);assert.equal(await zoom(),afterZoom,'tracking update preserves manual zoom');assert.equal(await page.locator('.rt-leaflet-container').evaluate(n=>n._leaflet_id),mapId,'map instance preserved');await page.locator('.rt-agent-marker').click();await page.locator('dialog[open] .hire-full-profile').waitFor();await page.keyboard.press('Escape');checks.push('actual marker profile and preserved map zoom');const box=await map.boundingBox();assert(Math.abs(box.width-box.height)<2,'square map');await page.getByRole('button',{name:/Full.?screen map/i}).click();assert((await map.boundingBox()).height>=840);const beforePinch=await zoom();const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:170,y:300,id:1},{x:330,y:300,id:2}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:170-i*10,y:300,id:1},{x:330+i*10,y:300,id:2}]});await pause(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(600);assert(await zoom()>beforePinch,'finger pinch zooms the map');checks.push('two-finger pinch zoom');await page.keyboard.press('Escape');checks.push('square and fullscreen tracking');await variants(page,'tracking');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(e){console.error(e);console.error(log.slice(-3000));process.exitCode=1;}finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));await writeFile(work+'/tracking-geometry.json',JSON.stringify(trackingMeasurements,null,2));await browser?.close();server.kill('SIGTERM');console.log('Evidence: '+work);}
