import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(resolve(tmpdir(),'scrap-ecosystem-'));
const origin=process.env.SCRAP_PREVIEW_ORIGIN||'http://127.0.0.1:5186',api='http://127.0.0.1:8058';
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/cleanup_api.py',work+'/fixture.db','8058'],{stdio:['ignore','pipe','pipe']});
let browser,page,log='';const checks=[],errors=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>log+=chunk);
async function variants(page,selector,name){
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,476,1280])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' overflow '+width+' '+theme+' '+scale);
  const violations=await page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),selector);
  assert.deepEqual(violations,[],name+' accessibility '+width+' '+theme+' '+scale);
 }
 await page.setViewportSize({width:476,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});
 await page.screenshot({path:work+'/'+name+'.png',fullPage:true});checks.push(name+' · mobile, dark, 200% text and AAA contrast');
}
try{
 const deadline=Date.now()+60000;let ready=false;
 while(Date.now()<deadline){if(server.exitCode!==null)throw Error(log);try{if((await fetch(api+'/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await pause(100);}
 assert(ready,'Local fixture did not become ready: '+log.slice(-1200));
 const seeded=await fetch(api+'/fixture/ecosystem',{method:'POST'});assert.equal(seeded.status,200);const ids=await seeded.json();
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:476,height:850},reducedMotion:'reduce',permissions:['geolocation'],geolocation:{latitude:21.4934,longitude:86.9135,accuracy:5}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const headers={...route.request().headers()};if(headers.authorization==='Bearer admin')headers['x-admin-key']='test-operator-key';
  try{const response=await route.fetch({url:api+url.pathname+url.search,headers});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}
 });
 await context.route('https://*.tile.openstreetmap.org/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1kAAAAASUVORK5CYII=','base64')}));
 const open=async view=>{const p=await context.newPage();p.setDefaultTimeout(20000);p.on('pageerror',error=>errors.push(error.message));await p.goto(origin+'/tests/scrap-ecosystem-preview.html?view='+view);return p;};
 page=await open('buyer');await page.getByText('Platinum contributor · 200 points',{exact:true}).waitFor();
 await variants(page,'.suite-scrap_owner','buyer-home');
 await page.locator('.suite-navigation').getByRole('button',{name:'Collections',exact:true}).click();
 await page.locator('.scrap-task-preview').first().click();await page.getByRole('button',{name:'Start journey & share location',exact:true}).click();
 await page.getByRole('button',{name:'Confirm arrival',exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to collections',exact:true}).click();
 const locationAfterClose=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/local-business/scrap/'+ids.active_id+'/position'&&response.request().method()==='POST',{timeout:20000});
 await page.bringToFront();assert.equal((await locationAfterClose).status(),200);
 const position=await fetch(api+'/operations/local-business/scrap/'+ids.active_id+'/tracking',{headers:{Authorization:'Bearer customer'}});assert.equal(position.status,200);assert((await position.json()).position);
 checks.push('Collector location continues after closing the task sheet; customer tracking has the fresh position');
 await page.getByRole('button',{name:'History',exact:true}).click();await page.locator('.scrap-task-preview').first().click();
 await page.getByText('+10 verified points',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Share on Repaidians',exact:true}).click();
 const share=page.getByRole('dialog',{name:'Share on Repaidians',exact:true});await share.locator('.milestone-preview').waitFor();
 assert(!/PRIVATE|PAYMENT REFERENCE|PICKUP/.test(await share.innerText()));await share.getByRole('button',{name:'Share on Repaidians',exact:true}).click();await share.getByRole('heading',{name:'Shared on Repaidians',exact:true}).waitFor();
 checks.push('A real collection milestone publishes through the signed API, without private evidence, address or payment data');
 const community=await open('feed');await community.locator('.rp-work-milestone[data-recycling=true]').waitFor();assert.equal(await community.locator('.rp-media-missing').count(),0);await community.getByText('+10 verified points',{exact:true}).waitFor();
 await variants(community,'.rp-shell-inner','recycling-feed');
 const policy=await open('policy');await policy.locator('.captain-policy>summary').click();await policy.getByLabel('Approved monthly reward budget · ₹',{exact:true}).fill('1000');await policy.getByLabel('Repaido funding approval reference',{exact:true}).fill('fixture-authorised-company-budget');
 const offer=policy.getByRole('group',{name:'Professional day hire · 20%',exact:true});await offer.getByLabel('Gold maximum · ₹',{exact:true}).fill('20');await offer.getByLabel('Approved offer maximum · ₹',{exact:true}).fill('30');await offer.getByRole('checkbox',{name:'Enable this funded offer',exact:true}).check();
 await policy.getByRole('checkbox',{name:'I approve this Repaido budget and the listed offer limits.',exact:true}).check();await policy.getByRole('button',{name:'Save approved reward policy',exact:true}).click();await policy.getByText('Reward policy saved. Only enabled offers can be redeemed, within the approved budget.',{exact:true}).waitFor();
 await variants(policy,'.captain-policy','company-reward-policy');
 const checkout=await open('checkout');await checkout.getByRole('button',{name:'Offers & earned coupons',exact:true}).click();await checkout.locator('.coupon-options>button').filter({hasText:'CAPTAINHIRE20'}).click();await checkout.getByText('CAPTAINHIRE20 applied. Your final saving is confirmed with the booking.',{exact:true}).waitFor();assert.equal(await checkout.getByTestId('saving').innerText(),'2000');
 await variants(checkout,'.coupon-field','earned-coupon');
 checks.push('Company approves funded caps; Gold coupon appears at hiring checkout and respects the ₹20 ceiling');
 await checkout.getByRole('button',{name:'Switch account',exact:true}).click();assert.equal(await checkout.getByTestId('saving').innerText(),'0');assert.equal(await checkout.getByText('CAPTAINHIRE20 applied. Your final saving is confirmed with the booking.',{exact:true}).count(),0);
 checks.push('Switching accounts clears the selected private coupon and its saving');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);console.error(log.slice(-1800));if(page)await page.screenshot({path:work+'/failure.png',fullPage:true});process.exitCode=1;}
finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));await writeFile(work+'/backend.log',log);await browser?.close();server.kill('SIGTERM');console.log('Evidence: '+work);}
