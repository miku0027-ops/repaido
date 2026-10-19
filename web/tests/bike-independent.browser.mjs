import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187';
const work=await mkdtemp(resolve(tmpdir(),'repaido-independent-qa-'));
const writes=[],errors=[],checks=[];
let policy={version:0,terms_version:0,enabled:false,reviewed:false,paid_payout_bps:0,promo_payout_paise:0,terms:'',reference:''};
let enrollment={id:'independent-qa',name:'Local Test Rider',status:'pending',version:1,terms_version:1};
let account={earned_paise:1200,awaiting_remittance_paise:0,payable_paise:1200,transfer_reported_paise:0,received_paise:0};
let credits=[{id:'qa-credit',ride_id:'qa-completed-ride',version:1,amount_paise:1200,status:'payable',free:true,created_at:Date.now()/1000}];
let transfers=[];
let fund={funded_paise:0,reserved_paise:0,committed_paise:0},reads=0;
const own=()=>({policy,enrollment,approved:policy.enabled&&enrollment.status==='approved'&&enrollment.terms_version===policy.terms_version,account,credits,next_cursor:null,transfers,transfers_next_cursor:null});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:465,height:950},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.replace(/^\/api\/operations/,'');
  const body=request.postDataJSON();let response;
  if(request.method()==='GET'){
   reads++;
   if(path==='/bike-rides/earnings/admin')response={items:[{...enrollment,profile_approved:true,account}],next_cursor:null,policy,fund,available_promo_fund_paise:fund.funded_paise-fund.reserved_paise-fund.committed_paise};
   else if(path==='/bike-rides/earnings/riders/independent-qa'||path==='/bike-rides/driver/earnings')response=own();
  }else if(path==='/bike-rides/earnings/policy'){
   writes.push({model:'Policy',body});policy={...body,version:policy.version+1,terms_version:policy.terms_version+1};response=policy;
  }else if(path==='/bike-rides/earnings/funding'){
   writes.push({model:'Funding',body});fund.funded_paise+=body.amount_paise;response={id:'qa-funding',...body};
  }else if(path==='/bike-rides/earnings/riders/independent-qa/review'){
   writes.push({model:'Review',body});enrollment={...enrollment,status:body.status,version:enrollment.version+1};response=enrollment;
  }else if(path==='/bike-rides/earnings/transfers'){
   writes.push({model:'Transfer',body});assert.equal(body.amount_paise,1200);assert.deepEqual(body.credit_ids,['qa-credit']);
   credits=credits.map(row=>({...row,status:'transfer_reported',version:row.version+1}));transfers=[{id:'qa-transfer',version:1,amount_paise:1200,status:'transfer_reported',reference:body.reference}];account={...account,payable_paise:0,transfer_reported_paise:1200};response=transfers[0];
  }else if(path==='/bike-rides/driver/earnings/transfers/qa-transfer/receipt'){
   writes.push({model:'Receipt',body});transfers=[{...transfers[0],status:'rider_received',version:2}];account={...account,transfer_reported_paise:0,received_paise:1200};response=transfers[0];
  }else if(path==='/bike-rides/driver/earnings/enrollment'){
   writes.push({model:'Enrollment',body});enrollment={...enrollment,terms_version:body.terms_version,version:enrollment.version+1};response=own();
  }
  if(response===undefined){errors.push('Unexpected local fixture request '+request.method()+' '+path);return route.fulfill({status:500,json:{detail:'Unknown local fixture endpoint'}});}
  return route.fulfill({status:200,json:response});
 });
 await page.goto(base+'/tests/bike-independent-preview.html',{waitUntil:'networkidle'});
 assert.equal(reads,0,'closed admin workspace performs no financial reads');
 await page.locator('.bike-independent-admin>summary').click();
 await page.getByRole('heading',{name:'Independent earning plan',exact:true}).waitFor();
 const editor=page.locator('.bike-earning-subpanel').filter({has:page.getByText('Earning policy',{exact:false})}).first();
 await editor.locator(':scope>summary').click();
 assert.equal(await editor.getByLabel('Paid-fare share · %',{exact:true}).inputValue(),'0');
 assert.equal(await editor.getByLabel('Free-ride earning · ₹',{exact:true}).inputValue(),'0');
 await editor.getByLabel('Paid-fare share · %',{exact:true}).fill('80');
 await editor.getByLabel('Free-ride earning · ₹',{exact:true}).fill('12');
 await editor.getByLabel('Rider agreement',{exact:true}).fill('LOCAL QA ONLY: approved earning agreement; promotional work funded separately.');
 await editor.getByLabel('Review reference',{exact:true}).fill('LOCAL-QA-REVIEW-01');
 await editor.getByLabel('I reviewed these amounts and earning terms.',{exact:true}).check();
 await editor.getByLabel('Enable independent riders with approved profiles and current consent.',{exact:true}).check();
 await editor.getByRole('button',{name:'Save earning policy',exact:true}).click();
 await page.getByText('Earning policy saved.',{exact:true}).waitFor();
 assert.equal(writes.at(-1).body.paid_payout_bps,8000);assert.equal(writes.at(-1).body.promo_payout_paise,1200);
 checks.push('disabled zero defaults; company-reviewed versioned percentage and launch earning policy');
 const funding=page.locator('.bike-earning-subpanel').filter({has:page.getByText('Record company launch funding',{exact:true})});
 await funding.locator(':scope>summary').click();
 await funding.getByLabel('Received funding · ₹',{exact:true}).fill('120');
 await funding.getByLabel('External reference',{exact:true}).fill('LOCAL-QA-FUNDING-01');
 await funding.getByLabel('Verification evidence',{exact:true}).fill('LOCAL QA ONLY: verified external funding receipt.');
 assert(await funding.getByRole('button',{name:'Record received funding',exact:true}).isDisabled());
 await funding.getByRole('checkbox').check();await funding.getByRole('button',{name:'Record received funding',exact:true}).click();
 await page.getByText('Funding recorded. The launch balance has been refreshed.',{exact:true}).waitFor();
 assert.equal(writes.at(-1).body.amount_paise,12000);
 await page.getByRole('button',{name:'Open independent rider Local Test Rider',exact:true}).click();
 const review=page.locator('.bike-independent-admin form').filter({has:page.getByRole('heading',{name:'Review Local Test Rider',exact:true})});
 await review.getByLabel('Decision',{exact:true}).selectOption('approved');
 await review.getByLabel('External reference',{exact:true}).fill('LOCAL-QA-RIDER-01');
 await review.getByLabel('Verification evidence',{exact:true}).fill('LOCAL QA ONLY: verified rider profile and original documents.');
 await review.getByRole('button',{name:'Record rider decision',exact:true}).click();
 await page.getByText('approved',{exact:true}).waitFor();
 const transfer=page.locator('.bike-earning-subpanel').filter({has:page.getByText('Record external earning transfer',{exact:true})});
 await transfer.locator(':scope>summary').click();
 await transfer.getByRole('checkbox',{name:'#D-RIDE ₹12.00',exact:false}).check();
 await transfer.getByLabel('External reference',{exact:true}).fill('LOCAL-QA-TRANSFER-01');
 await transfer.getByLabel('Verification evidence',{exact:true}).fill('LOCAL QA ONLY: exact transfer verified with external provider.');
 await transfer.getByLabel('I verified this exact transfer with the provider.',{exact:true}).check();
 await transfer.getByRole('button',{name:'Record verified transfer',exact:true}).click();
 await page.getByText('Transfer recorded. Rider receipt confirmation is pending.',{exact:true}).waitFor();
 assert.equal(writes.at(-1).body.amount_paise,1200);
 checks.push('evidence-backed funding and profile approval; exact selected earning transfers never initiate bank payments');
 await page.addScriptTag({path:resolve('web/node_modules/axe-core/axe.min.js')});
 for(const width of [320,465,900,1440])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:950});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow ${width} ${theme} ${scale}`);
  const violations=await page.evaluate(async()=>(await window.axe.run('.bike-admin',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[],`admin accessibility ${width} ${theme} ${scale}`);
 }
 await page.setViewportSize({width:390,height:900});await page.goto(base+'/tests/bike-independent-preview.html?rider',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Your ride earnings',exact:true}).waitFor();
 await page.getByRole('button',{name:'Confirm receipt',exact:true}).click();
 await page.getByRole('button',{name:'I received this transfer',exact:true}).click();
 await page.getByText('Receipt confirmed · LOCAL-QA-TRANSFER-01',{exact:true}).waitFor();
 assert.equal(writes.at(-1).model,'Receipt');
 // Revised terms are accepted explicitly; policy changes never imply consent.
 policy={...policy,version:policy.version+1,terms_version:policy.terms_version+1,terms:'LOCAL QA ONLY: amended reviewed agreement requiring fresh consent.'};
 await page.getByRole('button',{name:'Refresh earnings',exact:true}).click();
 await page.locator('.bike-earning-agreement>summary').click();
 assert(await page.getByRole('button',{name:'Accept earning terms',exact:true}).isDisabled());
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Accept earning terms',exact:true}).click();
 await page.getByText('Accepted',{exact:true}).waitFor();
 assert.equal(writes.at(-1).body.terms_version,2);
 await page.addScriptTag({path:resolve('web/node_modules/axe-core/axe.min.js')});
 for(const width of [320,390,768])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize='200%';},theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const violations=await page.evaluate(async()=>(await window.axe.run('main',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[],'rider earnings accessibility');
 }
 checks.push('rider receipt acknowledgement and explicit revised-term consent; compact tables/forms at 320–1440px and 200% text, light/dark WCAG A/AA checks');
 const contract=spawnSync(resolve('backend/.venv/bin/python'),['-c','import json,sys,bike_earnings\nfor item in json.load(sys.stdin): getattr(bike_earnings,item["model"]).model_validate(item["body"])'],{env:{...process.env,PYTHONPATH:resolve('backend')},input:JSON.stringify(writes),encoding:'utf8'});
 assert.equal(contract.status,0,contract.stderr);assert.deepEqual(errors,[]);
 await page.screenshot({path:work+'/rider-earnings.png',fullPage:true});
 console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);for(const context of browser.contexts())for(const page of context.pages()){await page.screenshot({path:work+'/failure.png',fullPage:true});await writeFile(work+'/failure.html',await page.content());}process.exitCode=1;}finally{await writeFile(work+'/report.json',JSON.stringify({checks,writes,errors},null,2));await browser.close();console.log('Evidence: '+work);}
