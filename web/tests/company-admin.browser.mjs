import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-admin-')),api='http://127.0.0.1:8056',origin='http://127.0.0.1:5187';
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/company_admin_api.py',work+'/test.db','8056'],{cwd:resolve(web,'../backend'),stdio:['ignore','pipe','pipe']});let log='',browser;for(const stream of [server.stdout,server.stderr])stream.on('data',data=>log+=data);
const checks=[],errors=[],requests=[],writes=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let failWorkers=true,failJobs=true,slowJobs=false;
async function tab(page,name){await page.getByRole('navigation',{name:'Company workspace'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();}
async function records(path,token='admin-a'){const response=await fetch(api+'/operations'+path,{headers:{Authorization:'Bearer '+token}});assert(response.ok);return response.json();}
try{
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:465,height:850},reducedMotion:'reduce'});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();const body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+body});});
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());const entry={path:url.pathname,token:request.headers().authorization,status:null};requests.push(entry);if(!['GET','HEAD'].includes(request.method()))writes.push(url.pathname);
  if(url.pathname==='/api/operations/admin/workers'&&failWorkers||url.pathname==='/api/operations/admin/jobs'&&failJobs)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'Fixture data service temporarily unavailable.'}})});
  if(url.pathname==='/api/operations/admin/jobs'&&slowJobs)await pause(2000);
  const response=await route.fetch({url:api+url.pathname+url.search});entry.status=response.status();await route.fulfill({response});
 });
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/company-admin-preview.html');await page.getByRole('button',{name:'Retry bookings',exact:true}).waitFor();await page.getByRole('button',{name:'Retry workers',exact:true}).waitFor();
 assert.equal(await page.locator('.portal-metrics strong').filter({hasText:'Unavailable'}).count(),2);assert.equal(await page.getByText('No bookings yet. Customer booking requests appear here.',{exact:true}).count(),0);checks.push('failed overview sources show unavailable and retry, never fabricated zero counts or empty queues');
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,465,800,1440])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'overview overflow '+width+' '+theme+' '+scale);
  const issues=await page.evaluate(async()=>(await window.axe.run('#portal-content',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}})).violations.map(issue=>({id:issue.id,nodes:issue.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));
  assert.deepEqual(issues,[],'overview accessibility '+width+' '+theme+' '+scale);
 }
 await page.setViewportSize({width:465,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});checks.push('overview loading and failure panels have accessible feedback, AAA contrast and responsive layouts');
 const initial=requests.length;await tab(page,'Transport & scrap');await page.getByText('Fixture cab_owner',{exact:true}).waitFor();assert(requests.slice(initial).some(request=>request.path.endsWith('/local-business/admin/reviews')));assert(!requests.slice(initial).some(request=>/\/admin\/(jobs|workers)$/.test(request.path)));checks.push('transport applications fetch real records despite failed booking and worker endpoints');
 await tab(page,'Workers');await page.getByRole('heading',{name:'Agent onboarding',exact:true}).waitFor();await page.locator('.review-row').filter({hasText:'Test professional'}).waitFor();
 await tab(page,'Shops');await page.getByRole('heading',{name:'Shop applications',exact:true}).waitFor();await page.getByText('No shops match this status.',{exact:false}).waitFor();
 await tab(page,'Activity');await page.getByRole('heading',{name:'Team activity',exact:true}).waitFor();await page.locator('tbody tr').first().waitFor();
 await tab(page,'Global Control');await page.getByRole('heading',{name:'Delivery & budget safeguards',exact:true}).waitFor();
 checks.push('worker approvals, shop reviews, activity and global controls load independently');
 for(const [name,endpoint] of [['Home plans','/admin/home'],['Service terms',''],['Community','/admin/market'],['Partner programme','/admin/partner-program'],['Finance','/admin/finance'],['Support','/admin/support'],['Moderation','/admin/reports'],['Rentals','/admin/rentals'],['Procurement','/admin/procurement'],['Rankings','']]){
  const before=requests.length;await tab(page,name);await page.locator('#portal-content h2,#portal-content h3').first().waitFor();
  if(endpoint){for(let i=0;i<100&&!requests.slice(before).some(request=>request.path.endsWith(endpoint)&&request.status===200);i++)await pause(100);assert(requests.slice(before).some(request=>request.path.endsWith(endpoint)&&request.status===200),name+' reads its authorized real API');}
  assert(!requests.slice(before).some(request=>/\/admin\/(jobs|workers)$/.test(request.path)),name+' must not depend on overview reads');
  if(name==='Finance'){await page.getByText(/collection records ·.*settlements ·.*payouts/).waitFor();await page.getByText('No refund records yet.',{exact:true}).waitFor();}
  if(name==='Moderation')await page.getByText('No evidence corrections or review reports yet.',{exact:true}).waitFor();

 }
 checks.push('all remaining company tabs render and fetch their own authorized API during an overview outage');

 failWorkers=false;await tab(page,'Overview');await page.getByRole('button',{name:'Refresh overview',exact:true}).click();await page.locator('.portal-metrics strong').filter({hasText:/^2$/}).waitFor();await page.getByRole('button',{name:'Retry bookings',exact:true}).waitFor();checks.push('partial recovery displays actual worker count while bookings failure remains isolated');
 failJobs=false;await page.getByRole('button',{name:'Retry bookings',exact:true}).click();await page.locator('.portal-metrics strong').filter({hasText:/^1$/}).waitFor();
 const jobs=(await records('/admin/jobs')).jobs;await tab(page,'Bookings');await page.getByRole('heading',{name:jobs[0].service_name,exact:true}).waitFor();
 const beforeWarm=requests.filter(request=>request.path.endsWith('/admin/jobs')).length;await tab(page,'Transport & scrap');await page.getByText('Fixture cab_owner',{exact:true}).waitFor();await tab(page,'Bookings');await page.getByRole('heading',{name:jobs[0].service_name,exact:true}).waitFor();assert.equal(requests.filter(request=>request.path.endsWith('/admin/jobs')).length,beforeWarm);checks.push('warm booking tabs display immediately without duplicate reads');
 failJobs=true;await page.getByRole('button',{name:'Refresh bookings',exact:true}).click();await page.getByText('Showing the last loaded records.',{exact:true}).waitFor();await page.getByRole('heading',{name:jobs[0].service_name,exact:true}).waitFor();failJobs=false;await page.getByRole('button',{name:'Retry bookings',exact:true}).click();await page.getByText('Showing the last loaded records.',{exact:true}).waitFor({state:'hidden'});checks.push('temporary refresh failure retains real bookings and explicit retry recovers');
 slowJobs=true;await page.getByRole('button',{name:'Refresh bookings',exact:true}).click();await tab(page,'Shops');await page.getByRole('heading',{name:'Shop applications',exact:true}).waitFor();await pause(2200);assert.equal(await page.getByRole('heading',{name:'Shop applications',exact:true}).count(),1);slowJobs=false;checks.push('leaving a slow request keeps the selected tab responsive');
 await page.evaluate(()=>window.__adminFixture.emit('worker'));await page.getByRole('heading',{name:'Company Administrator Sign-in',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:jobs[0].service_name,exact:true}).count(),0);
 const denial=await fetch(api+'/operations/admin/jobs',{headers:{Authorization:'Bearer worker'}});assert.equal(denial.status,403);checks.push('ordinary accounts are denied in both the UI and the real API');
 await page.evaluate(()=>window.__adminFixture.emit('admin-b'));await page.getByRole('heading',{name:'Overview',exact:true,level:1}).waitFor();await page.locator('.portal-metrics strong').filter({hasText:/^2$/}).waitFor();assert(requests.some(request=>request.path.endsWith('/admin/jobs')&&request.token==='Bearer admin-b'));checks.push('switching administrators clears prior private snapshots and fetches with the new identity');
 const beforeIdle=requests.length;await pause(1500);assert.equal(writes.length,0);assert.equal(await page.evaluate(()=>window.__adminFixture.forcedTokens),0);assert.equal(await page.getByText('Changes are saved',{exact:true}).count(),0);checks.push('reads, navigation and idle state cause no saves, writes or unnecessary forced token refreshes');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);console.error(log.slice(-2200));process.exitCode=1;}finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors,requests,writes},null,2));await browser?.close();server.kill('SIGTERM');console.log('Evidence: '+work);}
