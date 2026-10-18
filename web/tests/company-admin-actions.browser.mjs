import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const work=await mkdtemp(resolve(tmpdir(),'repaido-admin-actions-')),api='http://127.0.0.1:8066';
const server=spawn(resolve('backend/.venv/bin/python'),[resolve('web/tests/company_admin_api.py'),work+'/test.db','8066'],{stdio:['ignore','pipe','pipe']});
let log='',browser;for(const stream of [server.stdout,server.stderr])stream.on('data',d=>log+=d);const writes=[],errors=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const r=route.request(),url=new URL(r.url());if(!['GET','HEAD'].includes(r.method()))writes.push({path:url.pathname,body:r.postDataJSON()});await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});});
 await page.goto('http://127.0.0.1:5187/tests/company-admin-preview.html');await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
 await page.getByRole('navigation',{name:'Company workspace'}).getByRole('button',{name:'Workers',exact:true}).click();
 await page.getByRole('button',{name:'Open Test professional',exact:true}).click();await page.getByText('No current documents uploaded.',{exact:true}).waitFor();
 assert(await page.getByRole('button',{name:'Approve agent',exact:true}).isDisabled());
 await page.getByLabel('Decision note',{exact:true}).fill('The submitted application needs complete identity and tools evidence before independent approval.');
 await page.getByRole('button',{name:'Reject with reason',exact:true}).click();await page.getByText('No matching applications.',{exact:true}).waitFor();
 const workers=await (await fetch(api+'/operations/admin/onboarding-overview',{headers:{Authorization:'Bearer admin-a'}})).json();assert.equal(workers.workers.find(w=>w.id==='worker2').status,'rejected');
 await page.getByRole('combobox').filter({has:page.locator('option[value="all"]')}).selectOption('all');
 const approvedRow=page.getByRole('row').filter({has:page.getByText('approved',{exact:true})});await approvedRow.getByRole('button',{name:'Open Test professional',exact:true}).click();
 await page.getByText('Private identity and bank review',{exact:true}).click();await page.getByRole('button',{name:'Open verification case',exact:true}).click();await page.getByText('Identity: approved · Bank: verified',{exact:true}).waitFor();
 assert(await page.getByRole('button',{name:'Check bank result with provider',exact:true}).isDisabled());
 assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/operations/admin/workers/worker2/review');assert.equal(writes[0].body.decision,'rejected');
 const audit=await (await fetch(api+'/operations/admin/audit-history',{headers:{Authorization:'Bearer admin-a'}})).json();assert(audit.entries.some(e=>e.action==='WorkerReviewed'&&e.actor_id==='admin-a'));
 await page.addScriptTag({path:resolve('web/node_modules/axe-core/axe.min.js')});
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);const issues=await page.evaluate(async()=>(await window.axe.run('#portal-content',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(issues,[],theme);}
 await page.screenshot({path:work+'/worker-review.png',fullPage:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,work,checks:['Missing evidence blocks approval','Reasoned review updates actual API and audit','All-status filter retains approved/rejected records','Private identity and bank follow-up reachable','Opening tables never submits provider mutations','Light/dark review accessibility']}));
} catch(e){console.error(e);console.error(log.slice(-1000));process.exitCode=1;}finally{await writeFile(work+'/writes.json',JSON.stringify(writes,null,2));await browser?.close();server.kill('SIGTERM');}
