// Browser regression checks against disposable SQLite APIs, never production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.ICON_PREVIEW_ORIGIN||'http://127.0.0.1:5198',work=await mkdtemp('/tmp/repaido-icon-workspaces-');
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const servers=[],checks=[],errors=[],problems=[],variants=[];let browser,api='';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(name,script,port){
 let log='';const process=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/'+script,work+'/'+name+'.db',String(port)],{cwd:resolve(web,'../backend'),env:{...globalThis.process.env,NO_GCE_CHECK:'true'},stdio:['ignore','pipe','pipe']});servers.push(process);for(const stream of [process.stdout,process.stderr])stream.on('data',data=>log+=data);
 const target='http://127.0.0.1:'+port;for(let i=0;i<200;i++){try{if((await fetch(target+'/health')).ok)return target;}catch{}if(process.exitCode!==null)throw Error(log);await pause(100);}throw Error('Local fixture failed: '+name+' '+log.slice(-1000));
}
async function audit(page,label,navSelector){
 for(const width of [320,480,1440])for(const theme of ['light','dark']){
  const scale=width===320?200:100;await page.setViewportSize({width,height:900});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  const result=await page.evaluate(({navSelector})=>{
   const nav=document.querySelector(navSelector),issues=[];
   for(const svg of document.querySelectorAll('svg[data-icon]')){if(!svg.getClientRects().length)continue;const rect=svg.getBoundingClientRect(),style=getComputedStyle(svg);if(Math.abs(rect.width-rect.height)>.75||rect.width<1||style.stroke!=='none')issues.push({icon:svg.dataset.icon,width:rect.width,height:rect.height,stroke:style.stroke});for(const path of svg.querySelectorAll('path'))if(getComputedStyle(path).stroke!=='none')issues.push({icon:svg.dataset.icon,reason:'Path stroke added'});}
   const controls=[...(nav?.querySelectorAll('button')||[])].filter(button=>button.getClientRects().length).map(button=>{const svg=button.querySelector('svg[data-icon]'),rect=button.getBoundingClientRect(),glyph=svg?.getBoundingClientRect();return {label:button.getAttribute('aria-label')||button.textContent.trim(),icon:svg?.getAttribute('data-icon'),width:rect.width,height:rect.height,glyph:glyph?{width:glyph.width,height:glyph.height}:null,hidden:svg?.getAttribute('aria-hidden')};});
   return {issues,controls,overflow:document.documentElement.scrollWidth>innerWidth+1};
  },{navSelector});
  problems.push(...result.issues.map(issue=>({...issue,label,width,theme,scale})));assert.equal(result.overflow,false,label+' reflow '+width+' '+theme+' '+scale);
  if(result.controls.length){assert(result.controls.every(control=>control.icon&&control.hidden==='true'),label+' navigation icons are decorative beside named controls');assert(result.controls.every(control=>control.width>=43&&control.height>=43),label+' 44px navigation target');assert(result.controls.every(control=>control.glyph?.width===24&&control.glyph?.height===24),label+' 24px navigation glyph');assert.equal(new Set(result.controls.map(control=>control.icon)).size,result.controls.length,label+' navigation options have distinct symbols');}
  variants.push({label,width,theme,scale,controls:result.controls});
 }
 await page.setViewportSize({width:390,height:900});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});
}
try{
 const [company,business]=await Promise.all([fixture('company','company_admin_api.py',8069),fixture('business','business_suites_api.py',8070)]);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();try{const response=await route.fetch({url:api+url.pathname+url.search});return route.fulfill({response});}catch{return route.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.message));
 api=company;await page.goto(origin+'/tests/company-admin-preview.html',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Overview',exact:true,level:1}).waitFor();
 const menu=page.getByRole('button',{name:'Workspace menu',exact:true});if(await menu.isVisible())await menu.click();await audit(page,'Company navigation','nav[aria-label="Company workspace"]');
 const names=await page.getByRole('navigation',{name:'Company workspace'}).getByRole('button').allTextContents();
 for(const name of names){if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')==='false')await menu.click();await page.getByRole('navigation',{name:'Company workspace'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();const issues=await page.locator('#portal-content svg[data-icon]').evaluateAll(nodes=>nodes.filter(svg=>svg.getClientRects().length).flatMap(svg=>{const b=svg.getBoundingClientRect();return Math.abs(b.width-b.height)>.75||getComputedStyle(svg).stroke!=='none'?[{icon:svg.getAttribute('data-icon'),width:b.width,height:b.height,stroke:getComputedStyle(svg).stroke}]:[];}));problems.push(...issues.map(issue=>({...issue,scope:'Company '+name})));}
 checks.push('All 17 company destinations load with distinct 24px navigation symbols; compact metadata and action icons retain square geometry');
 api=business;
 for(const [mode,title] of [['cab_owner','Cab owner suite'],['driver','Driver suite'],['scrap_owner','Scrap collection suite']]){
  await page.goto(origin+'/tests/business-suites-preview.html?mode='+mode+'&uid=worker',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:title,exact:true}).waitFor();await audit(page,title,'.suite-navigation');
  const navigation=page.getByRole('navigation',{name:title+' navigation'}),labels=await navigation.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')||button.textContent.trim()));
  for(const label of labels){await navigation.getByRole('button',{name:label,exact:true}).click();await page.locator('.suite-panel-title').waitFor();const data=await page.locator('svg[data-icon]').evaluateAll(nodes=>nodes.filter(svg=>svg.getClientRects().length).flatMap(svg=>{const b=svg.getBoundingClientRect();return Math.abs(b.width-b.height)>.75||getComputedStyle(svg).stroke!=='none'?[{icon:svg.getAttribute('data-icon'),width:b.width,height:b.height}]:[];}));problems.push(...data.map(issue=>({...issue,scope:title+' '+label})));}
  await page.screenshot({path:work+'/'+mode+'-390.png'});checks.push(title+': all five destinations retain distinct icons, 44px navigation targets and 24px glyphs across six viewport/theme/text variants');
 }
 await page.goto(origin+'/tests/business-suites-preview.html?mode=community&uid=worker',{waitUntil:'domcontentloaded'});await page.getByRole('navigation',{name:'Repaidians sections'}).waitFor();await audit(page,'Repaidians','.rp-bottom-nav');await page.screenshot({path:work+'/repaidians-390.png'});checks.push('Repaidians public community navigation uses distinct local Material symbols and accessible names in light/dark and 200% text');
 assert.deepEqual(problems,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,variants:variants.length,work}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();servers.forEach(server=>server.kill('SIGTERM'));await writeFile(work+'/report.json',JSON.stringify({checks,variants,problems,errors},null,2));console.log('Evidence: '+work);}
