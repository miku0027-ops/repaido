import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend'),origin=process.env.SHELL_PREVIEW_ORIGIN||'http://127.0.0.1:5187',port=Number(process.env.SHELL_TEST_PORT||8064),api='http://127.0.0.1:'+port;
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Local isolated app checks only');
const work=await mkdtemp('/tmp/repaido-customer-shell-'),checks=[],variants=[],errors=[];
let browser,log='';
const server=spawn(resolve(backend,'.venv/bin/python'),[web+'/tests/business_suites_api.py',work+'/test.db',String(port)],{cwd:backend,env:{...process.env,NO_GCE_CHECK:'true'},stdio:['ignore','pipe','pipe']});for(const stream of [server.stdout,server.stderr])stream.on('data',value=>log+=value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const filled={};for(const name of ['shopping_cart','notifications','person']){const svg=await readFile(resolve(web,'src/icons/material-symbols-rounded/'+name+'_fill1.svg'),'utf8');filled[name]=[...svg.matchAll(/\bd="([^"]+)"/g)].map(match=>match[1]);}
async function layout(page,variant){
 await page.setViewportSize({width:variant.width,height:850});
 await page.evaluate(variant=>{document.documentElement.style.fontSize=variant.scale+'%';document.documentElement.dataset.theme=variant.theme;const nav=document.querySelector('.android-bottom-nav');nav.dataset.captainGold=String(variant.gold);nav.style.paddingBottom=variant.safeArea+'px';},{...variant});
 await pause(30);
 const result=await page.evaluate(()=>{
  const nav=document.querySelector('.android-bottom-nav'),help=document.querySelector('.repaido-header-actions>.customer-support-fab'),links=nav.querySelector('.android-nav-links'),helpBox=help.getBoundingClientRect(),navBox=nav.getBoundingClientRect(),issues=[];
  const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+.5&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+.5;
  const names=[];
  for(const button of links.querySelectorAll('button')){
   button.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
   const b=button.getBoundingClientRect();names.push(button.textContent.trim());
   if(overlap(b,helpBox))issues.push('Help overlaps navigation tap area: '+button.textContent.trim());
   if(b.width<43||b.height<43)issues.push('Navigation touch target too small');
   for(const target of [button,button.querySelector('svg'),button.querySelector('span')].filter(Boolean)){
    const r=target.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    if(hit?.closest('button')!==button)issues.push('Intercepted navigation '+target.tagName+': '+button.textContent.trim());
   }
  }
  const row=document.querySelector('.customer-booking-quick-actions'),actions=[...row.querySelectorAll('button')],boxes=actions.map(el=>el.getBoundingClientRect());
  if(Math.abs(boxes[0].y-boxes[1].y)>1||Math.abs(boxes[0].height-boxes[1].height)>1||Math.abs(boxes[0].width-boxes[1].width)>1)issues.push('Booking shortcuts do not align');
  for(const action of actions){
   const walker=document.createTreeWalker(action,NodeFilter.SHOW_TEXT);let node;
   while(node=walker.nextNode())for(const word of node.textContent.matchAll(/[\p{L}\p{N}]+/gu)){const range=document.createRange();range.setStart(node,word.index);range.setEnd(node,word.index+word[0].length);if([...range.getClientRects()].filter(r=>r.width>0).length>1)issues.push('Split shortcut word: '+word[0]);}
  }
  const serviceRail=document.querySelector('.customer-booking-navigation'),serviceButtons=[...serviceRail.querySelectorAll('button')];
  if(new Set(serviceButtons.map(button=>Math.round(button.getBoundingClientRect().y))).size!==1)issues.push('Booking service picker expands into multiple rows');
  if(serviceRail.getBoundingClientRect().height>110)issues.push('Booking service picker is unnecessarily tall');
  for(const button of serviceButtons){const b=button.getBoundingClientRect();if(b.width<43||b.height<43)issues.push('Small booking service target');const label=button.querySelector('.booking-navigation-label');if(!label)issues.push('Missing service label');else for(const node of label.childNodes)for(const word of node.textContent.matchAll(/[\p{L}\p{N}]+/gu)){const range=document.createRange();range.setStart(node,word.index);range.setEnd(node,word.index+word[0].length);if([...range.getClientRects()].filter(r=>r.width>0).length>1)issues.push('Split booking service word: '+word[0]);}}
  const header=[...document.querySelectorAll('.repaido-header-actions>button:not(.customer-support-fab)')].map(button=>{const svg=button.querySelector('svg'),b=button.getBoundingClientRect(),r=svg.getBoundingClientRect();return{symbol:svg.dataset.icon,filled:svg.dataset.iconFill,color:getComputedStyle(svg).color,paths:[...svg.querySelectorAll('path')].map(p=>p.getAttribute('d')),button:{x:b.x,right:b.right,width:b.width,height:b.height},size:{width:r.width,height:r.height}};});
  return {issues,header,names,overlap:helpBox.bottom-navBox.top,navHeight:navBox.height,helpSize:{width:helpBox.width,height:helpBox.height},helpColor:getComputedStyle(help.querySelector('.support-brand-mark')).color,overflow:document.documentElement.scrollWidth>innerWidth+1};
 });
 assert.deepEqual(result.issues,[],JSON.stringify({variant,...result}));assert.equal(result.overflow,false,JSON.stringify(variant));assert(result.overlap<0,'Header Help must stay clear of bottom navigation: '+JSON.stringify({variant,overlap:result.overlap,navHeight:result.navHeight}));assert(result.helpSize.width>=43&&result.helpSize.height>=43);assert(result.navHeight<=(variant.scale===100?105:120),'The dock stays compact, including its safe-area reserve');assert.equal(result.helpColor,result.header[0].color,'Support follows the accessible header color in each theme');
 assert.deepEqual(result.names,['Explore','Services','Go','Bookings','Market']);assert.equal(result.header.length,3);
 for(const icon of result.header){assert.equal(icon.filled,'1',icon.symbol+' uses official filled geometry');assert.deepEqual(icon.paths,filled[icon.symbol]);assert.equal(icon.size.width,24);assert.equal(icon.size.height,24);assert(icon.button.width>=43&&icon.button.height>=43&&icon.button.x>=0&&icon.button.right<=variant.width);const rgb=icon.color.match(/\d+/g).map(Number);assert(rgb[2]>rgb[0]&&rgb[2]>rgb[1],'Header actions retain their blue theme');}
 variants.push({...variant,navHeight:result.navHeight});
}
try{
 let ready=false;for(let attempt=0;attempt<250;attempt++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}assert(ready,'Isolated backend starts');
 // This fixture represents a returning customer whose welcome offer was seen.
 // Keep the unrelated timed campaign dialog from covering the controls under test.
 const reminder=await fetch(api+'/operations/coupons/launch',{method:'POST',headers:{Authorization:'Bearer customer'}});assert(reminder.ok,'Prepare the isolated returning customer');
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:485,height:850},reducedMotion:'reduce',timezoneId:'Asia/Kolkata'});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch(),body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+body});});
 await context.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());try{const response=await route.fetch({url:api+url.pathname+url.search});
  // This suite audits the idle shell. Pending rides intentionally lock the
  // whole screen and are covered by repaido-go/ride-workspace browser checks.
  if(request.method()==='GET'&&url.pathname.endsWith('/local-business/rides')){const data=await response.json();return route.fulfill({response,json:{...data,rides:[]}});}
  await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/customer-rides-app-preview.html?uid=customer&tab=bookings&view=rides');await page.getByRole('group',{name:'Booking shortcuts',exact:true}).waitFor();
 for(const width of [320,390,485,522])for(const scale of [100,200])for(const theme of ['light','dark'])for(const gold of [false,true])for(const safeArea of [8,24])await layout(page,{width,scale,theme,gold,safeArea});
 checks.push('64 actual app width/text/theme/Gold/safe-area variants: header Help clear of page content and navigation, no tap/icon/label interception, aligned booking shortcuts, official filled header glyphs');
 const services=page.getByRole('group',{name:'Booking service type',exact:true});
 for(const motion of ['reduce','no-preference'])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.emulateMedia({reducedMotion:motion});await layout(page,{width:320,scale,theme,gold:false,safeArea:8});
  for(const [name,target] of [['Visits','.reference-bookings'],['Home plans','.home-plans'],['Hiring','.hire-requests'],['Contracts','.cc-hub'],['Rides','.transport-bookings'],['Contribute','.contribution-bookings']]){
   const button=services.getByRole('button',{name,exact:true});await button.focus();await page.keyboard.press('Enter');await page.locator('.customer-bookings-page '+target).first().waitFor();assert.equal(await button.getAttribute('aria-pressed'),'true');assert.equal(await services.locator('[aria-pressed=true]').count(),1);await page.waitForFunction(()=>{const rail=document.querySelector('.customer-booking-navigation'),item=rail.querySelector('[aria-pressed=true]'),r=rail.getBoundingClientRect(),b=item.getBoundingClientRect();return b.x>=r.x-.5&&b.right<=r.right+.5;});
  }
 }
 checks.push('All six service selectors open their native sections and reveal the selected whole label at 320px, 100/200% text, both themes and motion settings');
 await services.getByRole('button',{name:'Rides',exact:true}).click();await page.locator('.transport-bookings').waitFor();await page.emulateMedia({reducedMotion:'reduce'});
 await layout(page,{width:485,scale:100,theme:'light',gold:false,safeArea:8});
 const dock=page.getByRole('navigation',{name:'Bottom Navigation',exact:true}),bookings=dock.getByRole('button',{name:'Bookings',exact:true}),help=page.getByRole('button',{name:'Chat with Repaido support',exact:true});
 await bookings.focus();await page.keyboard.press('Enter');assert.equal(await bookings.getAttribute('aria-current'),'page');assert.equal(await bookings.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 await help.click();const support=page.getByRole('dialog',{name:'Repaido support',exact:true});await support.getByRole('heading',{name:'Repaido support',exact:true}).waitFor();await page.keyboard.press('Escape');await support.waitFor({state:'detached'});assert(await help.evaluate(el=>el===document.activeElement));await bookings.click();checks.push('Help opens real support, Escape restores focus, and Bookings remains usable by pointer and keyboard');
 const activity=page.getByRole('button',{name:'Your activity & saved items',exact:true});await activity.click();const saved=page.getByRole('dialog',{name:'Your activity & saved items',exact:true});await saved.getByRole('button',{name:'Saved & following',exact:true}).click();await page.keyboard.press('Escape');await saved.waitFor({state:'detached'});assert(await activity.evaluate(el=>el===document.activeElement));
 const business=page.getByRole('button',{name:'Business accounts',exact:true});await business.click();const accounts=page.getByRole('dialog',{name:'Business & apartment accounts',exact:true});await accounts.waitFor();await page.keyboard.press('Escape');await accounts.waitFor({state:'detached'});assert(await business.evaluate(el=>el===document.activeElement));checks.push('Both aligned shortcuts preserve their native dialogs, saved tab and focus return');
 const cart=page.locator('.repaido-header-actions .repaido-cart-btn');await cart.click();await page.getByRole('dialog',{name:'Your cart & orders',exact:true}).waitFor();await page.keyboard.press('Escape');assert(await cart.evaluate(el=>el===document.activeElement));const bell=page.locator('.repaido-header-actions .repaido-bell-btn');await bell.click();await page.getByRole('dialog',{name:'Notifications',exact:true}).waitFor();await page.keyboard.press('Escape');assert(await bell.evaluate(el=>el===document.activeElement));checks.push('Filled cart and bell retain their real drawers and focus behavior');
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});const violations=await page.evaluate(async()=>(await window.axe.run(document.body,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/bookings-shell-485.png',fullPage:true,animations:'disabled'});await page.locator('.repaido-home-header').screenshot({path:work+'/header-485.png'});await page.getByRole('group',{name:'Booking shortcuts',exact:true}).screenshot({path:work+'/shortcuts-485.png'});await services.screenshot({path:work+'/service-picker-485.png'});let helpBox=await help.boundingBox();await page.screenshot({path:work+'/dock-485.png',clip:{x:0,y:helpBox.y,width:485,height:850-helpBox.y}});await layout(page,{width:320,scale:200,theme:'dark',gold:true,safeArea:24});await page.screenshot({path:work+'/bookings-shell-320-200-dark-gold.png',fullPage:true,animations:'disabled'});await page.getByRole('group',{name:'Booking shortcuts',exact:true}).screenshot({path:work+'/shortcuts-320-200.png'});await services.screenshot({path:work+'/service-picker-320-200.png'});helpBox=await help.boundingBox();await page.screenshot({path:work+'/dock-320-200-gold.png',clip:{x:0,y:helpBox.y,width:320,height:850-helpBox.y}});assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,variants:64,work}));
}catch(error){console.error(error);console.error(log.slice(-1600));process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,variants,errors},null,2));console.log('Evidence: '+work);}
