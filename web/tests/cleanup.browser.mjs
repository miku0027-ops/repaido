import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'repaido-cleanup-')),api='http://127.0.0.1:8060',origin='http://127.0.0.1:5187';
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/cleanup_api.py',work+'/test.db','8060'],{stdio:['ignore','pipe','pipe']});
let log='',browser,page;const errors=[],checks=[],pause=ms=>new Promise(r=>setTimeout(r,ms));for(const s of [server.stdout,server.stderr])s.on('data',chunk=>log+=chunk);
async function variants(page,selector,name){
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,390,584,1440])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} overflow ${width} ${scale}`);
  const violations=await page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),selector);
  assert.deepEqual(violations,[],`${name} accessibility ${width} ${theme} ${scale}`);
 }
 await page.setViewportSize({width:390,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await page.screenshot({path:work+'/'+name+'.png',fullPage:true});checks.push(name+' responsive / AAA text contrast');
}
try{
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce',permissions:['geolocation'],geolocation:{latitude:21.4934,longitude:86.9135,accuracy:5}});
 await context.route('**/api/**',async route=>{const url=new URL(route.request().url()),headers={...route.request().headers()};if(headers.authorization==='Bearer admin')headers['x-admin-key']='test-operator-key';const response=await route.fetch({url:api+url.pathname+url.search,headers});await route.fulfill({response});});
 // Map images are fixture-only; coordinates and confirmation use the production picker.
 await context.route('https://*.tile.openstreetmap.org/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1kAAAAASUVORK5CYII=','base64')}));
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tests/cleanup-preview.html');await page.getByRole('button',{name:'Report litter',exact:true}).click();await page.getByText('Cleanliness contributor',{exact:true}).waitFor();
 await variants(page,'.cleanup-hub','customer-cleanup');
 await page.getByRole('button',{name:'Report a public spot',exact:true}).click();await page.getByRole('textbox',{name:'Describe the issue'}).fill('Dry paper and discarded cardboard on the public footpath');
 // Generate an original evidence fixture, then exercise real upload/sanitisation/storage.
 const image=await page.screenshot();await page.locator('input[type=file]').setInputFiles({name:'before.png',mimeType:'image/png',buffer:image});await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Choose the public spot',exact:true}).click();
 await page.getByRole('textbox',{name:'Street and public landmark'}).fill('Public park footpath beside gate 123');await page.getByRole('textbox',{name:'City',exact:true}).fill('Balasore');await page.getByRole('checkbox',{name:'I have checked that this pin marks the reported spot.'}).check();await page.getByRole('button',{name:'Confirm this location',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Submit report',exact:true}).click();await page.getByText('Under review',{exact:true}).waitFor();checks.push('customer uploads private evidence, confirms map pin and submits a real report');
 const admin=await context.newPage();admin.on('pageerror',e=>errors.push(e.message));await admin.goto(origin+'/tests/cleanup-preview.html?mode=admin');await admin.getByRole('button',{name:'Approve collection & reward',exact:true}).click();await admin.getByRole('spinbutton',{name:'Approved cash reward (₹)'}).fill('50');await admin.getByRole('textbox',{name:'Repaido funding approval reference'}).fill('fixture-approved-budget-123');await admin.getByRole('textbox',{name:'Collection permission / authority reference'}).fill('fixture-collection-authority-123');await admin.getByRole('textbox',{name:'Review / explanation'}).fill('Permission verified for this non-hazardous public collection');await admin.getByRole('dialog').getByRole('button',{name:'Approve collection & reward',exact:true}).click();await admin.getByText('Ready for collection',{exact:true}).waitFor();
 const collector=await context.newPage();collector.on('pageerror',e=>errors.push(e.message));await collector.goto(origin+'/tests/cleanup-preview.html?mode=collector');await collector.getByRole('button',{name:'Accept cleanup',exact:true}).click();await collector.getByRole('dialog').getByRole('button',{name:'Accept cleanup',exact:true}).click();await collector.getByRole('button',{name:'Submit cleanup evidence',exact:true}).waitFor();
 await variants(collector,'.cleanup-workspace','collector-cleanup');
 await collector.getByRole('button',{name:'Submit cleanup evidence',exact:true}).click();await collector.locator('input[type=file]').setInputFiles({name:'after.png',mimeType:'image/png',buffer:image});await collector.getByRole('textbox',{name:'Cleanup details & authorised recycling / disposal destination'}).fill('Collected cardboard; delivered to authorised recycling centre ABC');await collector.getByRole('dialog').getByRole('button',{name:'Submit cleanup evidence',exact:true}).click();await collector.getByText('Checking cleanup',{exact:true}).waitFor();checks.push('approved collector accepts exclusively and submits after evidence with GPS');
 await admin.getByRole('button',{name:'Refresh cleanup reports'}).click();await admin.getByRole('button',{name:'Verify cleanup & award points',exact:true}).click();await admin.getByRole('textbox',{name:'Review / explanation'}).fill('Before and after photos checked with authorised disposal record');await admin.getByRole('dialog').getByRole('button',{name:'Verify cleanup',exact:true}).click();await admin.getByRole('button',{name:'Record actual cash payment',exact:true}).waitFor();
 await variants(admin,'.cleanup-workspace','admin-cleanup');
 await admin.getByRole('button',{name:'Record actual cash payment',exact:true}).click();await admin.getByRole('textbox',{name:'Case / receipt reference'}).fill('fixture-cash-receipt-123');await admin.getByRole('textbox',{name:'Review / explanation'}).fill('Fixture cash handed to the reporting customer');await admin.getByRole('dialog').getByRole('button',{name:'Record cash payment',exact:true}).click();await admin.getByText('Cash payment recorded; receipt pending',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Refresh cleanup reports'}).click();await page.getByRole('button',{name:'I received ₹50.00 in cash',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm cash received'}).click();await page.getByRole('button',{name:'History',exact:true}).click();await page.locator('.cleanup-reward').getByText('Cash receipt confirmed',{exact:false}).waitFor();assert(await page.getByText('10 points · 1 verified cleanup',{exact:true}).count());
 await variants(page,'.cleanup-hub','verified-impact');
 checks.push('independent admin verifies points and records Repaido cash; only the reporter confirms receipt');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);console.error(log.slice(-1600));if(page)await page.screenshot({path:work+'/failure.png',fullPage:true});process.exitCode=1;}finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));await browser?.close();server.kill('SIGTERM');console.log('Evidence: '+work);}
