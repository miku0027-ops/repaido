import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const origin=process.env.REPAIDIANS_PREVIEW_ORIGIN||'http://127.0.0.1:5187',out='/tmp/repaido-work-controls';await mkdir(out,{recursive:true});
const authFixture=`const user={uid:'preview-professional',getIdToken:async()=>'preview'};export const auth={currentUser:user,authStateReady:async()=>{},onAuthStateChanged(fn){queueMicrotask(()=>fn(user));return()=>{};},onIdTokenChanged(fn){queueMicrotask(()=>fn(user));return()=>{};}};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
const pushFixture=`let status={supported:true,permission:'granted',enabled:false};const listeners=new Set();window.__pushCalls={enable:0,disable:0};window.__pushStatus=value=>{status=value;listeners.forEach(fn=>fn());};export const syncWorkPushAccount=async()=>{};export const workPushStatus=async()=>status;export const subscribeWorkPush=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};export const enableWorkPush=async()=>{window.__pushCalls.enable++;status={...status,enabled:true};return status;};export const disableWorkPush=async()=>{window.__pushCalls.disable++;status={...status,enabled:false};return status;};`;
const jobs=[['close','Closing first',85000,1,.65,'Balasore'],['paid','Highest paid',150000,5,.8,'Cuttack'],['match','Best matched',100000,3,.95,'Balasore']].map(([id,title,pay,days,score,city])=>({id,title,trade:'electrician',city,sourceKind:'commercial_project',workType:'project',ownerId:'contractor',ownerName:'Example contractor',skills:['Wiring'],minimumExperience:1,dailyRatePaise:pay,openings:2,deadline:Date.now()+days*86400000,startsAt:Date.now()+86400000,endsAt:Date.now()+20*86400000,match:{score,reasons:['Matches your listed skills']},details:{id,title,status:'planning',hiring:{},starts_at:Date.now()/1000,ends_at:Date.now()/1000+10000}}));
const errors=[],requests=[];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:495,height:850},reducedMotion:'reduce'});
 await context.routeWebSocket('**',socket=>socket.close());
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/src/firebase.ts')return route.fulfill({contentType:'text/javascript',body:authFixture});
  if(url.pathname==='/src/services/repaidiansPushService.ts')return route.fulfill({contentType:'text/javascript',body:pushFixture});
  if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push(url.pathname+url.search);let data={};
  if(url.pathname.endsWith('/work/preferences'))data={preferences:{personalizedDiscovery:true,jobDiscovery:false,contractUpdates:true,sharePlacements:false,shareSalary:false}};
  else if(url.pathname.endsWith('/work/jobs'))data={items:jobs.filter(job=>!url.searchParams.get('city')||job.city===url.searchParams.get('city')),nextCursor:null,personalized:true};
  else if(url.pathname.endsWith('/opportunities'))data={items:[],nextCursor:null};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tests/work-controls-preview.html');await page.getByRole('checkbox',{name:/Personalized work discovery/}).waitFor();
 const nav=page.getByRole('navigation',{name:'Work and market sections'}),push=page.locator('.rp-work-browser-push');
 assert.deepEqual(await nav.locator('select').evaluateAll(items=>items.map(item=>item.getAttribute('aria-label'))),['Browse','My work','Professional tools']);
 assert.equal(await nav.getByRole('combobox',{name:'Professional tools'}).inputValue(),'preferences');
 assert.equal(await nav.getByRole('group').count(),0,'No second navigation panel remains.');
 assert.ok((await nav.boundingBox()).height<=64,'The navigation occupies one compact row.');
 assert.equal(await push.getAttribute('open'),null);assert.equal(await push.getByRole('button').isVisible(),false);assert.deepEqual(await page.evaluate(()=>window.__pushCalls),{enable:0,disable:0});
 const summary=push.locator('summary');await summary.focus();await page.keyboard.press('Enter');await push.getByRole('button',{name:'Enable browser notifications',exact:true}).click();await push.getByRole('button',{name:'Disable browser notifications',exact:true}).waitFor();assert.equal(await summary.locator('small').innerText(),'On');
 await summary.click();await summary.click();assert.deepEqual(await page.evaluate(()=>window.__pushCalls),{enable:1,disable:0},'Opening the accordion never requests notification permission.');
 await push.getByRole('button',{name:'Disable browser notifications',exact:true}).click();await push.getByRole('button',{name:'Enable browser notifications',exact:true}).waitFor();
 await page.evaluate(()=>window.__pushStatus({supported:true,permission:'denied',enabled:false}));await page.waitForFunction(()=>document.querySelector('.rp-work-browser-push summary small')?.textContent==='Blocked');assert.equal(await push.getByRole('button').isDisabled(),true);
 await summary.click();
 await page.addScriptTag({path:require.resolve('axe-core')});
 for(const width of [320,495,1024])for(const text of [100,200])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(({text,theme})=>{document.documentElement.style.fontSize=text+'%';document.documentElement.dataset.theme=theme;},{text,theme});
  const layout=await nav.evaluate(rail=>{const boxes=[...rail.querySelectorAll('select')].map(el=>el.getBoundingClientRect());return {sameRow:Math.max(...boxes.map(b=>b.top))-Math.min(...boxes.map(b=>b.top))<1,targets:boxes.every(b=>b.height>=44),overflow:document.documentElement.scrollWidth>innerWidth+1};});
  assert.deepEqual(layout,{sameRow:true,targets:true,overflow:false},JSON.stringify({width,text,theme,layout}));
  const violations=await page.evaluate(async()=>(await window.axe.run(document.querySelector('.rp-work-market'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[],JSON.stringify({width,text,theme}));
 }
 await page.setViewportSize({width:495,height:850});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});await page.screenshot({path:out+'/preferences.png',fullPage:true});
 await nav.getByRole('combobox',{name:'Browse',exact:true}).selectOption('jobs');const cards=page.locator('.rp-work-cards .rp-work-card h3');await cards.first().waitFor();const sort=page.getByRole('combobox',{name:'Sort jobs',exact:true});
 assert.deepEqual(await cards.allTextContents(),['Best matched','Highest paid','Closing first']);
 const reads=requests.filter(path=>path.includes('/work/jobs')).length;
 await sort.selectOption('deadline');assert.deepEqual(await cards.allTextContents(),['Closing first','Best matched','Highest paid']);await sort.selectOption('pay');assert.deepEqual(await cards.allTextContents(),['Highest paid','Best matched','Closing first']);assert.equal(requests.filter(path=>path.includes('/work/jobs')).length,reads,'Sorting the shown results needs no network call.');
 await page.getByRole('button',{name:'Filters',exact:true}).click();const filters=page.getByRole('dialog',{name:'Filter jobs',exact:true});await filters.getByLabel('City',{exact:true}).fill('Cuttack');await filters.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.rp-work-cards .rp-work-card').length===1);assert.deepEqual(await cards.allTextContents(),['Highest paid']);assert.ok(requests.some(path=>path.includes('city=Cuttack')));
 await page.getByRole('button',{name:'Clear job filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.rp-work-cards .rp-work-card').length===3);assert.equal(await sort.inputValue(),'pay');await page.screenshot({path:out+'/jobs.png',fullPage:true});
 await page.getByRole('button',{name:'View as guest',exact:true}).click();await page.getByRole('region',{name:'Professional opportunities',exact:true}).waitFor();assert.equal(await nav.getByRole('combobox',{name:'Professional tools'}).count(),0);assert.equal(await nav.locator('option[value=jobs]').count(),0);assert.equal(await nav.locator('option[value=contracts]').count(),1);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['single-row navigation','keyboard accordion','explicit push enable/disable only','blocked permission state','12 responsive/theme/text variants with WCAG AA','three actual sort orders without refetch','city filtering and clear','guest access restrictions'],out},null,2));
}catch(error){await writeFile(out+'/error.txt',String(error));throw error;}finally{await browser.close();}
