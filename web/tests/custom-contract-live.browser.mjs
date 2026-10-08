import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend');
const work=await mkdtemp(resolve(tmpdir(),'custom-contract-live-e2e-')),db=resolve(work,'contracts.db');
const python=resolve(backend,'.venv/bin/python'),port=Number(process.env.CONTRACT_LIVE_TEST_PORT||8050),apiOrigin='http://127.0.0.1:'+port;
const origin=process.env.CONTRACTS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
let server,browser,log='',succeeded=false;const errors=[];
function fixture(kind,id,body){
 const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nmain.operations_store.run(lambda u:u.put(sys.argv[2],sys.argv[3],json.loads(sys.argv[4])))';
 const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(body)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,status=200){
 const r=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();assert.equal(r.status,status,method+' '+path+': '+JSON.stringify(data));return data;
}
async function register(name){const account=await api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','.')+'@contracts.test',password:'isolated-contracts-test'},201);fixture('e2e_verified_phone',account.user.id,{phone:'+919876543210'});return account;}
async function newPage(account,mode='discovery',width=390){
 const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce',permissions:['geolocation'],geolocation:{latitude:21.4934,longitude:86.9135,accuracy:5}});
 await context.addInitScript(token=>{if(token)localStorage.setItem('repaido.token',token);},account?.token||'');
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();await route.fulfill({response,body:'class PreviewSocket{readyState=0;addEventListener(){};removeEventListener(){};send(){};close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});});
 await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tests/contracts-preview.html?mode='+mode);return page;
}
async function layout(page){
 const result=await page.evaluate(()=>{
  const bad=[];if(document.documentElement.scrollWidth>innerWidth+1)bad.push('Document overflow');
  for(const el of document.querySelectorAll('.tender-market,.tender-opportunity,.contract-desk,.contract-card,.contract-dialog,.contract-form,.contract-hiring-dialog,.cc-workspace,.cc-management-panel,.cc-panel-content')){
   if(el.getClientRects().length&&el.scrollWidth>el.clientWidth+1)bad.push('Overflow '+el.className);
  }
  for(const el of document.querySelectorAll('button,input:not([type=checkbox]),select,textarea')){
   if(el.getClientRects().length&&el.getBoundingClientRect().height<31)bad.push('Compact target below32px: '+(el.getAttribute('aria-label')||el.textContent||el.name));
  }return bad;
 });if(result.length){await mkdir(resolve(web,'test-results'),{recursive:true});await page.screenshot({path:resolve(web,'test-results/contracts-layout-failure.png')});console.log(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.map(node=>({width:node.clientWidth,scroll:node.scrollWidth,children:[...node.querySelectorAll('*')].filter(child=>child.getBoundingClientRect().right>node.getBoundingClientRect().right+1).map(child=>({tag:child.tagName,class:child.className,width:child.getBoundingClientRect().width,scroll:child.scrollWidth})).slice(0,12)}))));}assert.deepEqual(result,[]);
}
async function audit(page){
 await page.addScriptTag({path:require.resolve('axe-core')});
 const result=await page.evaluate(()=>window.axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}}));
 assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
}
async function eventually(check,message){const deadline=Date.now()+10000;do{if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);throw Error(message);}
const panel=(page,title)=>page.locator('.cc-management-panel').filter({has:page.getByRole('heading',{name:title,exact:true})});
async function openPanel(page,title){const button=panel(page,title).getByRole('button',{name:new RegExp('^'+title)});if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
async function total(page,label){return page.locator('.cc-reaction-totals>div').filter({has:page.getByText(label,{exact:true})}).locator('dd').innerText();}
try{
 const code='import main,uvicorn\nfrom fastapi import Header\noriginal=main.current_user\ndef verified(authorization: str=Header(default="")):\n user=original(authorization)\n claim=main.operations_store.run(lambda u:u.get("e2e_verified_phone",user["id"]))\n return {**user,**({"phone":claim["phone"],"phone_verified":True,"phone_authenticated":True} if claim else {})}\nmain.app.dependency_overrides[original]=verified\nuvicorn.run(main.app,host="127.0.0.1",port='+port+')';
 server=spawn(python,['-c',code],{cwd:backend,env:{...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite'},stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 for(let n=0;n<100;n++){try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const owner=await register('Live Customer'),contractor=await register('Live Contractor'),agent=await register('Live Agent');
 for(const account of [contractor,agent])fixture('workers',account.user.id,{id:account.user.id,name:account.user.name,status:'approved',contractor_verified:account===contractor,role:'technician',city:'Balasore',skills:['Electrical inspection'],categories:['electrician'],experience_years:4,completed_tasks:0,rating_count:0,rating_sum:0});
 const now=Date.now()/1000;
 const custom=(await api('/operations/custom-contracts/queries',owner,'POST',{request_id:randomUUID(),title:'Live office electrical installation',sector:'Office',work_trade:'electrician',city:'Balasore',area:'Central market',site:'PRIVATE customer office gate 401',location:{lat:21.4934,lng:86.9135},scope:'Inspect and install the agreed lighting with electrical safety checks for the office.',skills:['Electrical inspection'],minimum_experience:2,workforce_requirements:[{worker_type:'electrician',count:2}],starts_at:now+86400,ends_at:now+172800,deadline:now+3600,budget_paise:900000,terms:'Complete the electrical installation safely and record inspection results.'},201)).query;
 const customer=await newPage(owner,'customer&contract='+custom.id,483);
 await customer.getByRole('navigation',{name:'Contract breadcrumbs'}).waitFor();
 assert.equal(await panel(customer,'Contractor matches').getByRole('button').getAttribute('aria-expanded'),'false');
 assert.equal(await customer.getByText('Contractor matches for this requirement',{exact:true}).count(),0);
 assert.equal(await panel(customer,'Post settings').getByRole('button').getAttribute('aria-expanded'),'false');
 await customer.getByRole('navigation',{name:'Contract progress'}).waitFor();
 await openPanel(customer,'Post activity');
 await customer.getByText('Updates automatically',{exact:true}).waitFor();
 const professional=await newPage(contractor,'workspace&tab=Tenders',483);
 await professional.getByRole('region',{name:'Matched customer contracts'}).getByRole('button',{name:'Open contract',exact:true}).click();
 await professional.getByRole('heading',{name:custom.title,exact:true}).waitFor();
 await openPanel(professional,'Post activity');
 await eventually(async()=>await customer.getByText('1 recorded views',{exact:true}).count()>0,'Customer must see the contractor view without refresh.');
 await professional.getByRole('button',{name:'Useful · 0',exact:true}).click();
 await eventually(async()=>await total(customer,'Useful')==='1','Contractor reaction must update customer totals.');
 await professional.getByRole('button',{name:'Useful · 1',exact:true}).click();
 await eventually(async()=>await total(customer,'Useful')==='0','Removing a reaction must update customer totals.');
 await professional.getByLabel('Your comment',{exact:true}).fill('Contractor can complete the electrical work during the requested dates.');
 await professional.getByRole('button',{name:'Post comment',exact:true}).click();
 await customer.getByText('Contractor can complete the electrical work during the requested dates.',{exact:true}).waitFor();
 const worker=await newPage(agent,'agent',483);
 await worker.getByRole('button',{name:'Find nearby using my current location',exact:true}).click();
 await worker.getByRole('heading',{name:custom.title,exact:true}).waitFor();
 await worker.getByRole('button',{name:'Open contract',exact:true}).click();
 await worker.getByLabel('Requested worker type',{exact:true}).selectOption('electrician');
 await worker.getByLabel('Your relevant experience and availability').fill('Available to install and inspect the office electrical equipment on these dates.');
 await worker.getByRole('checkbox').check();
 await worker.getByRole('button',{name:'Check location & express availability',exact:true}).click();
 await worker.getByRole('button',{name:'Open contract activity',exact:true}).click();
 await openPanel(worker,'Post activity');
 await eventually(async()=>await customer.getByText('2 recorded views',{exact:true}).count()>0,'Agent views must be counted.');
 await worker.getByRole('button',{name:'Support · 0',exact:true}).click();
 await eventually(async()=>await total(customer,'Support')==='1','Agent reactions must reach the customer.');
 await worker.getByLabel('Your comment',{exact:true}).fill('Agent is available for the requested electrical installation.');
 await worker.getByRole('button',{name:'Post comment',exact:true}).click();
 await customer.getByText('Agent is available for the requested electrical installation.',{exact:true}).waitFor();
 await professional.getByText('Agent is available for the requested electrical installation.',{exact:true}).waitFor();
 assert.equal(await worker.getByLabel('Proposed total contract price (₹)').count(),0);
 assert.equal(await worker.getByText('PRIVATE customer office gate 401',{exact:true}).count(),0);
 assert.equal(await professional.getByText('PRIVATE customer office gate 401',{exact:true}).count(),0);
 // Server-confirmed proposals appear while the customer keeps Activity open.
 await professional.getByLabel('Proposed total contract price (₹)').fill('8500');
 await professional.getByLabel('Scope, work plan and proposed terms').fill('Install the office lights and document the agreed electrical safety inspections.');
 await professional.getByRole('checkbox').check();
 await professional.getByRole('button',{name:'Submit private proposal',exact:true}).click();
 await eventually(async()=>await customer.getByText('1 private proposal',{exact:true}).count()>0,'Saved proposals must arrive without refresh.');
 await openPanel(customer,'Private contractor proposals');
 await customer.getByRole('button',{name:'Review & accept proposal',exact:true}).waitFor();
 // A transient update failure shows its status and recovery catches missed activity.
 await openPanel(customer,'Post activity');let disconnected=true;
 await customer.route('**/updates',route=>disconnected?route.abort('failed'):route.fallback());
 await customer.getByText('Connection interrupted · retrying…',{exact:true}).waitFor();
 await api('/operations/custom-contracts/queries/'+custom.id+'/comments',contractor,'POST',{request_id:randomUUID(),text:'Comment saved while customer connection was interrupted.'},201);
 disconnected=false;await customer.evaluate(()=>window.dispatchEvent(new Event('online')));
 await customer.getByText('Comment saved while customer connection was interrupted.',{exact:true}).waitFor();
 await customer.getByText('Updates automatically',{exact:true}).waitFor();
 // Retain opened older pages when fresh discussion activity arrives.
 for(let index=0;index<21;index++)await api('/operations/custom-contracts/queries/'+custom.id+'/comments',contractor,'POST',{request_id:randomUUID(),text:'History comment '+index+' for the live contract.'},201);
 await customer.getByText('History comment 20 for the live contract.',{exact:true}).waitFor();
 await customer.getByRole('button',{name:'More comments',exact:true}).click();
 await customer.getByText('Contractor can complete the electrical work during the requested dates.',{exact:true}).waitFor();
 await api('/operations/custom-contracts/queries/'+custom.id+'/comments',agent,'POST',{request_id:randomUUID(),text:'Fresh comment after the customer opened discussion history.'},201);
 await customer.getByText('Fresh comment after the customer opened discussion history.',{exact:true}).waitFor();
 await customer.getByText('Contractor can complete the electrical work during the requested dates.',{exact:true}).waitFor();
 await customer.getByText('History comment 1 for the live contract.',{exact:true}).waitFor();
 console.log('PASS: separate customer, contractor and agent browsers receive saved views, reactions, removal, comments, availability and proposals; reconnection catches up.');
 // Read-only owner totals replace disabled reaction controls. Management settings
 // close other panels and changes propagate to the two professional sessions.
 assert.equal(await customer.getByRole('button',{name:/^Interested ·/}).count(),0);
 await openPanel(customer,'Post settings');
 await customer.getByRole('button',{name:'Turn off reactions',exact:true}).click();
 await eventually(async()=>await worker.getByRole('button',{name:'Support · 1',exact:true}).isDisabled(),'Agent reaction controls must reflect owner settings.');
 await customer.getByRole('button',{name:'Turn off comments',exact:true}).click();
 await eventually(async()=>await professional.getByLabel('Your comment',{exact:true}).count()===0,'Contractor comment controls must reflect owner settings.');
 await openPanel(customer,'Contractor matches');
 await customer.getByRole('heading',{name:'Contractor matches for this requirement',exact:true}).waitFor();
 assert.equal(await panel(customer,'Post settings').getByRole('button').getAttribute('aria-expanded'),'false');
 console.log('PASS: matches start closed, owner settings propagate and panels preserve the private contract boundary.');
 // Award and messages use the same update path, with content visible only to parties.
 await openPanel(customer,'Private contractor proposals');
 await customer.getByRole('button',{name:'Review & accept proposal',exact:true}).click();
 await customer.getByRole('button',{name:'Confirm award at ₹8,500.00',exact:true}).click();
 await customer.getByRole('heading',{name:'Private contract messages',exact:true}).waitFor();
 await professional.getByRole('heading',{name:'Private contract messages',exact:true}).waitFor();
 await openPanel(customer,'Private contract messages');await openPanel(professional,'Private contract messages');
 await professional.getByLabel('Your private message',{exact:true}).fill('Private instructions for the customer and awarded contractor.');
 await professional.getByRole('button',{name:'Send private message',exact:true}).click();
 await customer.getByText('Private instructions for the customer and awarded contractor.',{exact:true}).waitFor();
 assert.equal(await worker.getByText('Private instructions for the customer and awarded contractor.',{exact:true}).count(),0);
 await worker.getByText('This contract is private to its customer and eligible professionals.',{exact:true}).waitFor();
 console.log('PASS: new activity preserves opened discussion history; awards and private messages update the two authorized parties and retire agent access.');

 for(const width of [320,483,1280])for(const theme of ['light','dark'])for(const percent of [100,200]){
  await customer.setViewportSize({width,height:950});await customer.evaluate(({theme,percent})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=percent+'%';},{theme,percent});
  for(const title of ['Private contractor proposals','The requirement','Post activity','Contractor matches','Post settings','Private contract messages']){await openPanel(customer,title);await layout(customer);await audit(customer);}
  assert(await customer.locator('h2').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).fontFamily.includes('Poppins'))));
 }
 await customer.setViewportSize({width:483,height:950});await customer.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await openPanel(customer,'Private contractor proposals');await customer.screenshot({path:resolve(work,'customer-contract-workspace.png'),fullPage:true});
 console.log('PASS: customer workspace AAA contrast and layout at 320, 483 and 1280 px, light/dark and 100%/200% text.');
 assert.deepEqual(errors,[]);succeeded=true;
}finally{await browser?.close();server?.kill('SIGTERM');if(succeeded)console.log('Browser evidence: '+work);else console.error('Isolated fixture retained at '+work+'\n'+log.slice(-4500));}
