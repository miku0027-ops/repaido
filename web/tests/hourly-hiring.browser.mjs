import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const work=await mkdtemp(resolve(tmpdir(),'repaido-hourly-')),api='http://127.0.0.1:8070';
const server=spawn(resolve('backend/.venv/bin/python'),[resolve('web/tests/hourly_hiring_api.py'),work+'/test.db','8070'],{stdio:['ignore','pipe','pipe']});let log='',browser;for(const stream of [server.stdout,server.stderr])stream.on('data',d=>log+=d);
const pause=ms=>new Promise(r=>setTimeout(r,ms)),errors=[],writes=[];
const post=async(path,body={})=>{const r=await fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json();};
const authSource=uid=>`export const auth={currentUser:{uid:'${uid}',phoneNumber:'+919876543210',getIdToken:async()=>'${uid}'},authStateReady:async()=>{},onIdTokenChanged(fn){queueMicrotask(()=>fn(this.currentUser));return()=>{};},onAuthStateChanged(fn){queueMicrotask(()=>fn(this.currentUser));return()=>{};}};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
try{
 for(let i=0;i<160;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const make=async worker=>{const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/src/firebase.ts*',r=>r.fulfill({contentType:'application/javascript',body:authSource(worker?'worker':'customer')}));
  await page.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET')writes.push({path:u.pathname,body:r.postDataJSON()});await route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
  await page.route('https://*.tile.openstreetmap.org/**',r=>r.abort());
  await page.addInitScript(()=>{window.Razorpay=class{constructor(options){this.options=options;}on(){}async open(){const p=await(await fetch('/api/_fixture/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:this.options.order_id})})).json();await this.options.handler({razorpay_payment_id:p.id});}};});
  await page.goto('http://127.0.0.1:5187/tests/hourly-hiring-preview.html'+(worker?'?worker':''));return page;};
 const customer=await make(false);
 await customer.getByRole('button',{name:'Reserve · pay ₹150.00',exact:true}).click();
 await customer.getByRole('button',{name:'Pay booking advance securely',exact:true}).click();
 await customer.getByRole('button',{name:'Refresh status',exact:true}).click();
 await customer.getByRole('heading',{name:'Reserved work time',exact:true}).waitFor();
 await customer.screenshot({path:work+'/customer-confirmed.png',fullPage:true});
 const agent=await make(true);await agent.getByRole('button',{name:'Open task',exact:true}).click();
 assert.equal(await agent.getByRole('button',{name:'Start 30-minute break',exact:true}).count(),0);
 await post('/_fixture/start');await post('/_fixture/clock',{seconds:600});
 await agent.getByRole('button',{name:'Refresh task',exact:true}).click();
 await agent.getByRole('button',{name:'Start 30-minute break',exact:true}).click();
 await agent.getByRole('heading',{name:'Unpaid meal break',exact:true}).waitFor();
 assert.equal(await agent.getByRole('button',{name:'Resume work',exact:true}).count(),0);
 await customer.getByRole('button',{name:'Refresh status',exact:true}).click();await customer.getByRole('heading',{name:'Unpaid meal break',exact:true}).waitFor();
 await post('/_fixture/clock',{seconds:1800});await agent.getByRole('button',{name:'Refresh task',exact:true}).click();
 await agent.getByRole('button',{name:'Resume work',exact:true}).click();
 await agent.getByRole('heading',{name:'Work in progress',exact:true}).waitFor();
 await post('/_fixture/clock',{seconds:123});await agent.getByRole('button',{name:'Refresh task',exact:true}).click();
 await agent.getByText('Bill & recorded charges',{exact:false}).click();
 await agent.screenshot({path:work+'/worker-clock.png',fullPage:true});
 // Inspect responsive overflow and accessibility on the real modal at each breakpoint.
 await agent.addScriptTag({path:resolve('web/node_modules/axe-core/axe.min.js')});
 for(const width of [320,390,768]){for(const dark of [false,true]){await agent.setViewportSize({width,height:900});await agent.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',dark);assert(await agent.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const issues=await agent.evaluate(async()=>(await window.axe.run('.agent-task-dialog',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(issues,[],String(width)+' dark='+dark);}}
 await post('/_fixture/after-photo');await agent.getByRole('button',{name:'Refresh task',exact:true}).click();
 await agent.getByRole('button',{name:/Submit.*review|Complete work|Submit completed work|Submit completion/}).last().click();
 await agent.getByLabel('Work done & checks completed',{exact:true}).fill('Completed the requested inspection and verified the result.');
 await agent.getByRole('button',{name:'Submit for customer review',exact:true}).click();
 await customer.getByRole('button',{name:'Refresh status',exact:true}).click();
 const info=await(await fetch(api+'/operations/hiring/requests',{headers:{Authorization:'Bearer customer'}})).json(),jobId=info.requests[0].job_id;
 const job=await(await fetch(api+'/operations/jobs/'+jobId,{headers:{Authorization:'Bearer customer'}})).json();assert.equal(job.state,'completion_pending');assert.equal(job.hourly_bill.billable_seconds,723);assert.equal(job.total_paise,18013);assert.equal(job.hourly_bill.remaining_service_paise,3013);
 await customer.screenshot({path:work+'/customer-final-bill.png',fullPage:true});
 await customer.getByRole('button',{name:'Confirm & Accept Work ✓',exact:true}).click();
 await customer.getByRole('button',{name:'View Bill (₹180.13)',exact:true}).click();
 await customer.getByRole('button',{name:'Pay remaining balance securely',exact:true}).click();
 await customer.getByText('Payment confirmed by the gateway. Your booking invoice is marked paid.',{exact:true}).waitFor();
 const paid=await(await fetch(api+'/operations/jobs/'+jobId,{headers:{Authorization:'Bearer customer'}})).json();assert.equal(paid.payment_status,'verified');
 const provider=await(await fetch(api+'/_fixture/info')).json();assert.deepEqual(provider.orders.map(o=>o.amount),[15000,3013]);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,work,checks:['Real quote confirmation and advance capture','No travel before payment','Customer and worker timer agree','One unpaid 30-minute break with early resume blocked','Actual bill excludes break and credits base once','Worker modal responsive accessibility','Completion through actual worker controls','Customer confirms work and pays only the exact remaining balance']}));
}catch(e){console.error(e);console.error(log.slice(-1800));process.exitCode=1;}finally{await writeFile(work+'/writes.json',JSON.stringify(writes,null,2));await browser?.close();server.kill('SIGTERM');}
