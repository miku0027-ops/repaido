import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.ICON_PREVIEW_ORIGIN||'http://127.0.0.1:5198',work=await mkdtemp('/tmp/repaido-icon-system-');
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Local-only browser checks');
const api='http://127.0.0.1:8068',errors=[],checks=[],variants=[],externalFonts=[],issues=[];let log='',browser;
 const server=spawn(resolve(web,'../backend/.venv/bin/python'),['-m','uvicorn','main:app','--host','127.0.0.1','--port','8068'],{cwd:resolve(web,'../backend'),env:{...process.env,NO_GCE_CHECK:'true',REPAIDO_STORAGE:'sqlite',REPAIDO_DB:work+'/test.db'},stdio:['ignore','pipe','pipe']});
for(const stream of [server.stdout,server.stderr])stream.on('data',data=>log+=data);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function iconAudit(page,selector='body'){
 return page.locator(selector).evaluate(root=>{
  const failures=[];for(const svg of root.querySelectorAll('svg')){
   if(!svg.getClientRects().length)continue;
   const symbol=svg.getAttribute('data-icon');if(!symbol&&!svg.matches('.lucide'))continue; // Illustration/map/brand artwork has its own aspect ratio.
   const rect=svg.getBoundingClientRect(),style=getComputedStyle(svg),label=svg.closest('[data-export-name]')?.getAttribute('data-export-name')||symbol||svg.getAttribute('class')||'svg';
   if(rect.width<1||rect.height<1||Math.abs(rect.width-rect.height)>.75)failures.push({label,reason:'Non-square or collapsed icon',width:rect.width,height:rect.height});
   if(!symbol)continue;
   const view=svg.viewBox.baseVal,paths=[...svg.querySelectorAll('path')];
   if(!paths.length)failures.push({label,reason:'No symbol path'});
   if(style.stroke!=='none')failures.push({label,reason:'Global CSS adds a stroke to filled Material geometry',stroke:style.stroke});
   for(const path of paths){const ps=getComputedStyle(path),box=path.getBBox();if(ps.stroke!=='none')failures.push({label,reason:'Path stroke corrupts Material geometry',stroke:ps.stroke});if(ps.fill!==style.color)failures.push({label,reason:'Symbol does not inherit surrounding text colour',fill:ps.fill,color:style.color});if(ps.fill==='none'||box.width<=0||box.height<=0)failures.push({label,reason:'Empty/invisible symbol'});if(box.x<view.x-2||box.y<view.y-2||box.x+box.width>view.x+view.width+2||box.y+box.height>view.y+view.height+2)failures.push({label,reason:'Symbol clipped by its viewport',box:{x:box.x,y:box.y,width:box.width,height:box.height},view:{x:view.x,y:view.y,width:view.width,height:view.height}});}
   if(svg.getAttribute('aria-hidden')!=='true'&&!svg.getAttribute('aria-label')&&!svg.querySelector('title'))failures.push({label,reason:'Unlabelled non-decorative icon'});
  }return failures;
 });
}
async function touchAudit(page,selector){
 return page.locator(selector).evaluateAll(roots=>[...new Set(roots.flatMap(root=>[...root.querySelectorAll('button')]))].filter(el=>el.getClientRects().length).map(el=>({label:el.getAttribute('aria-label')||el.textContent.trim(),rect:el.getBoundingClientRect()})).filter(({rect})=>rect.width<43||rect.height<43).map(({label,rect})=>({label,width:rect.width,height:rect.height})));
}
async function theme(page,{width=390,scale=100,theme='light',gold=false,appMotion=false}={}){
 await page.setViewportSize({width,height:900});await page.evaluate(({scale,theme,gold,appMotion})=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('reduce-motion',appMotion);document.querySelectorAll('.android-bottom-nav').forEach(nav=>nav.dataset.captainGold=String(gold));},{scale,theme,gold,appMotion});
}
try{
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin){if(url.pathname.startsWith('/api/')){try{const response=await route.fetch({url:api+url.pathname+url.search});return route.fulfill({response});}catch{return route.abort();}}return route.continue();}if(route.request().resourceType()==='font'||/fonts\.googleapis|fonts\.gstatic/.test(url.hostname))externalFonts.push(url.origin+url.pathname);return route.abort();});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
 await page.goto(origin+'/tests/icon-system-preview.html');await page.locator('#all-application-icons .icon-lab-cell').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 const count=await page.locator('#all-application-icons .icon-lab-cell').count();assert(count>=211,'All legacy and semantic icon exports render');
 for(const [name,symbol] of [['ShoppingCart','shopping_cart'],['Bell','notifications'],['User','person']]){const svg=page.locator('[data-export-name="'+name+'"] svg'),source=await readFile(resolve(web,'src/icons/material-symbols-rounded/'+symbol+'.svg'),'utf8');assert.equal(await svg.getAttribute('data-icon-fill'),'0','Header symbols preserve their outlined default');assert.deepEqual(await svg.locator('path').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d'))),[...source.matchAll(/\bd="([^"]+)"/g)].map(match=>match[1]));}
 issues.push(...await iconAudit(page));
 const sizes=await page.locator('[data-expected-size]').evaluateAll(nodes=>nodes.map(svg=>({expected:Number(svg.getAttribute('data-expected-size')),actual:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height})));
 assert.deepEqual(sizes.filter(s=>Math.abs(s.expected-s.actual)>.5||Math.abs(s.expected-s.height)>.5),[],'Explicit and utility-inferred icon sizes');
 assert.equal(await page.locator('[data-lab=decorative] svg').getAttribute('aria-hidden'),'true');
 await page.getByRole('img',{name:'Seller messages',exact:true}).waitFor();await page.getByRole('img',{name:'Your public profile',exact:true}).waitFor();
 const titleIDs=await page.locator('[data-lab=title] svg title').evaluateAll(titles=>titles.map(title=>title.id));assert.equal(new Set(titleIDs).size,2,'Each titled icon has an independent accessible-name ID');assert.equal(await page.locator('[data-lab=decorative] svg').getAttribute('focusable'),'false');
 assert.equal(await page.locator('[data-lab=legacy] path').evaluate(path=>getComputedStyle(path).stroke),'none','Legacy stroke props cannot thicken Material path');
 checks.push(`Every icon export (${count}) renders valid unclipped geometry; 14–32px sizes, utility inference and accessible title/aria naming work`);
 for(const label of ['Like item','Save item','Rate item']){const button=page.getByRole('button',{name:label,exact:true}),before=await button.locator('path').evaluateAll(paths=>paths.map(path=>path.getAttribute('d')));assert.equal(await button.getAttribute('aria-pressed'),'false');await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');const after=await button.locator('path').evaluateAll(paths=>paths.map(path=>path.getAttribute('d')));assert.notDeepEqual(after,before,label+' uses distinct official filled geometry');assert.deepEqual(await iconAudit(page,'#icon-state-controls'),[]);await button.click();assert.deepEqual(await button.locator('path').evaluateAll(paths=>paths.map(path=>path.getAttribute('d'))),before,label+' restores outline state');}
 const legacyStates=await page.locator('[data-lab=legacy-selected] svg').evaluateAll(nodes=>nodes.map(svg=>[...svg.querySelectorAll('path')].map(path=>path.getAttribute('d')).join('|')));for(let i=0;i<legacyStates.length;i+=2)assert.notEqual(legacyStates[i],legacyStates[i+1],'Legacy fill prop retains its visible selected state');
 checks.push('Heart, bookmark and rating controls change official outline/filled geometry with aria-pressed; legacy fill props retain visible saved states');
 for(const themeName of ['light','dark'])for(const width of [320,390,480,1440])for(const scale of [100,200]){
  await theme(page,{width,scale,theme:themeName});const geometry=await iconAudit(page);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);const targets=await touchAudit(page,'.icon-lab-section');
  variants.push({scope:'gallery',theme:themeName,width,scale,icons:count,overflow,targets});issues.push(...geometry.map(item=>({...item,theme:themeName,width,scale})));assert.equal(overflow,false,`Gallery reflow ${themeName}/${width}/${scale}`);assert.deepEqual(targets,[],`Touch target regression ${themeName}/${width}/${scale}`);
 }
 await theme(page,{gold:true});assert.deepEqual(await iconAudit(page,'.icon-lab-nav'),[]);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/controls-gold-390.png'});
 await theme(page,{theme:'dark',width:320,scale:200});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/controls-dark-320-200.png'});
 await theme(page);await page.getByRole('button',{name:'Message seller',exact:true}).click();await page.getByRole('dialog',{name:'Contact seller'}).waitFor();assert.deepEqual(await iconAudit(page,'dialog[open]'),[]);assert.deepEqual(await touchAudit(page,'dialog[open]'),[]);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});const a11y=await page.evaluate(async()=>(await window.axe.run('#icon-lab',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(issue=>({id:issue.id,nodes:issue.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));assert.deepEqual(a11y,[],'Icon controls and gallery WCAG check');
 checks.push('Production search, tabs, filters, header, modal and dock retain aligned square icons, 44px targets and accessible labels across 16 viewport/theme/text variants plus Gold');
 await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('navigation',{name:'Bottom Navigation'}).waitFor({timeout:45000});
 const actualNav=page.getByRole('navigation',{name:'Bottom Navigation'});
 for(const name of ['Explore','Services','Bookings','Market','Hire']){
  await theme(page);await actualNav.getByRole('button',{name,exact:true}).click();await pause(250);
  const problems=await iconAudit(page);issues.push(...problems.map(issue=>({...issue,scope:'App '+name})));assert.deepEqual(await touchAudit(page,'.android-bottom-nav'),[],name+' actual dock targets');
  const icons=await page.locator('svg[data-icon]').count();assert(icons>5,name+' renders adapter icons');variants.push({scope:'App '+name,icons});
 }
 await actualNav.getByRole('button',{name:'Market',exact:true}).click();
 for(const name of ['Marketplace','B2B Wholesale','Contracts','Rides','Sell scrap']){
  await page.getByRole('tablist',{name:'Marketplace destination'}).getByRole('tab',{name,exact:true}).click();await pause(200);issues.push(...(await iconAudit(page)).map(issue=>({...issue,scope:'Market '+name})));variants.push({scope:'Market '+name});
 }
 for(const settings of [{width:320,scale:200,theme:'dark'},{width:480,gold:true},{width:1440,theme:'light'}]){await theme(page,settings);issues.push(...await iconAudit(page));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Actual App icon reflow');}
 await theme(page,{width:390,gold:true});await page.screenshot({path:work+'/actual-app-gold-390.png'});
 checks.push('Actual customer App navigation and all five Market destinations render local Material icons without dimensional or stroke regressions');
 await page.emulateMedia({reducedMotion:'no-preference'});await theme(page,{appMotion:true});
 const motionDurations=()=>page.locator('.android-bottom-nav svg[data-icon]').evaluateAll(nodes=>nodes.map(node=>({duration:getComputedStyle(node).transitionDuration,animation:getComputedStyle(node).animationDuration})));
 const staticMotion=values=>values.length>0&&values.every(value=>value.duration.split(',').every(duration=>parseFloat(duration)<=.01)&&value.animation.split(',').every(duration=>parseFloat(duration)<=.01));
 assert(staticMotion(await motionDurations()),'App reduced-motion stops icon transitions independently of OS settings');
 await theme(page,{appMotion:false});await page.emulateMedia({reducedMotion:'reduce'});assert(staticMotion(await motionDurations()),'OS reduced-motion stops icon transitions independently of app settings');
 checks.push('OS and application reduced-motion preferences preserve static navigation glyphs');
 assert.deepEqual(issues,[],'Icon geometry/style regressions');assert.deepEqual(externalFonts,[],'Icons must not introduce external font/CDN requests');assert.deepEqual(errors,[],'Browser exceptions');
 console.log(JSON.stringify({passed:true,count,checks,variants:variants.length,work}));
}catch(error){console.error(error);console.error(log.slice(-1000));process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,variants,issues,errors,externalFonts},null,2));console.log('Evidence: '+work);}
