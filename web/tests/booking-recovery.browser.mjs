import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-booking-recovery-'));
const reserved=createServer();await new Promise(done=>reserved.listen(0,'127.0.0.1',done));const port=reserved.address().port;await new Promise(done=>reserved.close(done));
const api='http://127.0.0.1:'+port,origin=process.env.REPAIDO_PREVIEW_ORIGIN||'http://127.0.0.1:5199';
const server=spawn(process.env.REPAIDO_TEST_PYTHON||resolve(web,'../backend/.venv/bin/python'),[web+'/tests/booking-recovery-api.py',work+'/isolated.db',String(port)],{cwd:resolve(web,'../backend'),stdio:['ignore','pipe','pipe']});
let log='',browser;const errors=[],checks=[];
for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{log+=data;});
try{
  for(let attempt=0;attempt<300;attempt++){
    if(server.exitCode!==null)throw Error(log);
    try{if((await fetch(api+'/health')).ok)break;}catch{}
    if(attempt===299)throw Error('Isolated API did not start');
    await new Promise(done=>setTimeout(done,100));
  }
  const seeded=await fetch(api+'/__test/seed',{method:'POST'});assert(seeded.ok,await seeded.clone().text());const {payments}=await seeded.json();
  browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();return route.continue();});
  await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});await route.fulfill({response});});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/tests/booking-recovery-preview.html');
  await page.locator('.booking-payment-recovery>summary').click();
  const payment=id=>page.locator('.booking-payment-card').filter({has:page.getByText(id,{exact:true})});
  const first=payment(payments[0]);await first.getByRole('button',{name:'Check status',exact:true}).click();
  await first.getByLabel('New appointment',{exact:true}).waitFor();const choices=await first.locator('select option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
  await first.getByLabel('New appointment',{exact:true}).selectOption(choices[4]);
  await first.getByRole('button',{name:'Use saved payment',exact:true}).click();await first.getByText('Booking confirmed',{exact:true}).waitFor();
  assert.equal((await (await fetch(api+'/__test/stats')).json()).orders,2);checks.push('real customer controls reuse a captured payment for a new appointment without a new provider order');
  const second=payment(payments[1]);await second.getByRole('button',{name:'Refund options',exact:true}).click();
  await second.getByRole('button',{name:'Request full refund',exact:true}).click();await second.getByText('Refund completed',{exact:true}).waitFor();
  assert.deepEqual(await (await fetch(api+'/__test/stats')).json(),{orders:2,refunds:1});checks.push('explicit full refund reaches verified settlement through real HTTP and the provider fixture once');
  await page.setViewportSize({width:320,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.style.fontSize='200%';});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Recovery controls fit at320px and200% text');
  await page.screenshot({path:work+'/recovery-dark-320.png',fullPage:true});
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const audit=await page.evaluate(()=>window.axe.run('main',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  assert.deepEqual(audit.violations.map(value=>({id:value.id,targets:value.nodes.map(node=>node.target)})),[]);checks.push('compact recovery cards pass320px/200% dark reflow and automated accessibility checks');
  const strangerResponse=page.waitForResponse(response=>response.url().includes('/booking-checkout')&&response.request().method()==='GET');
  await page.goto(origin+'/tests/booking-recovery-preview.html?account=stranger');
  assert.deepEqual((await (await strangerResponse).json()).cases,[]);
  assert.equal(await page.locator('.booking-payment-card').count(),0);assert.deepEqual(errors,[]);checks.push('an unrelated signed-in account cannot see private checkout records');
  console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);console.error(log.slice(-4000));process.exitCode=1;}
finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors,log},null,2));await browser?.close();server.kill('SIGTERM');console.log('Evidence:',work);}
