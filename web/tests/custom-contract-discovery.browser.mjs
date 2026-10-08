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
const work=await mkdtemp(resolve(tmpdir(),'custom-contract-discovery-e2e-')),db=resolve(work,'contracts.db');
const python=resolve(backend,'.venv/bin/python'),port=Number(process.env.CONTRACTS_TEST_PORT||8036),apiOrigin='http://127.0.0.1:'+port;
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
 const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'});
 await context.addInitScript(token=>{if(token)localStorage.setItem('repaido.token',token);},account?.token||'');
 await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tests/contracts-preview.html?mode='+mode);return page;
}
async function layout(page){
 const result=await page.evaluate(()=>{
  const bad=[];if(document.documentElement.scrollWidth>innerWidth+1)bad.push('Document overflow');
  for(const el of document.querySelectorAll('.tender-market,.tender-opportunity,.contract-desk,.contract-card,.contract-dialog,.contract-form,.contract-hiring-dialog')){
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
try{
 const code='import main,uvicorn\nfrom fastapi import Header\noriginal=main.current_user\ndef verified(authorization: str=Header(default="")):\n user=original(authorization)\n claim=main.operations_store.run(lambda u:u.get("e2e_verified_phone",user["id"]))\n return {**user,**({"phone":claim["phone"],"phone_verified":True,"phone_authenticated":True} if claim else {})}\nmain.app.dependency_overrides[original]=verified\nuvicorn.run(main.app,host="127.0.0.1",port='+port+')';
 server=spawn(python,['-c',code],{cwd:backend,env:{...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 for(let n=0;n<100;n++){try{if((await fetch(apiOrigin+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const owner=await register('Project Owner'),contractor=await register('Approved Lead');
 const professional=account=>({id:account.user.id,name:account.user.name,status:'approved',contractor_verified:account===contractor,role:'technician',city:'Balasore',skills:['Electrical inspection'],categories:['electrician'],experience_years:4,completed_tasks:0,rating_count:0,rating_sum:0});
 fixture('workers',contractor.user.id,professional(contractor));
 // A genuine customer custom query reaches all three discovery surfaces without
 // entering legacy tender endpoints or exposing its exact site.
 const publishedAt=Date.now()/1000;
 const custom=(await api('/operations/custom-contracts/queries',owner,'POST',{request_id:randomUUID(),title:'Campus lighting replacement request',sector:'Education',work_trade:'electrician',city:'Balasore',area:'Campus neighbourhood',site:'PRIVATE exact gate and room 401',scope:'Replace agreed campus lights and inspect the electrical safety of the installation.',skills:['Electrical inspection'],minimum_experience:2,starts_at:publishedAt+86400,ends_at:publishedAt+172800,deadline:publishedAt+3600,budget_paise:900000,terms:'Complete the agreed electrical scope with inspected work and documented safety.'},201)).query;
 const tenderDesk=await newPage(contractor,'workspace&tab=Tenders');
 const matched=tenderDesk.getByRole('region',{name:'Matched customer contracts'});
 await matched.getByRole('heading',{name:custom.title,exact:true}).waitFor();
 assert(!(await matched.innerText()).includes('PRIVATE exact gate'));
 await matched.getByRole('button',{name:'Open contract',exact:true}).click();
 const customDetail=tenderDesk.getByRole('dialog',{name:'Customer contract requirement'});
 await customDetail.getByRole('heading',{name:'Submit a private proposal',exact:true}).waitFor();
 assert(!(await customDetail.innerText()).includes('PRIVATE exact gate'));
 await layout(tenderDesk);await audit(tenderDesk);
 await customDetail.getByLabel('Proposed total contract price (₹)').fill('8500');
 await customDetail.getByLabel('Scope, work plan and proposed terms').fill('Replace the agreed lights and perform the required safety inspections.');
 await customDetail.getByRole('checkbox').check();
 await customDetail.getByRole('button',{name:'Submit private proposal',exact:true}).click();
 await customDetail.getByRole('heading',{name:'Your submitted proposals',exact:true}).waitFor();
 const ownerView=await api('/operations/custom-contracts/queries/'+custom.id,owner);
 assert.equal(ownerView.query.bids.length,1);assert.equal(ownerView.query.bids[0].amount_paise,850000);
 const market=await newPage(contractor);
 await market.getByRole('region',{name:'Matched customer contracts'}).getByRole('heading',{name:custom.title,exact:true}).waitFor();
 await market.getByRole('region',{name:'Matched customer contracts'}).getByRole('button',{name:'Open contract',exact:true}).click();
 await market.getByRole('dialog',{name:'Customer contract requirement'}).getByRole('heading',{name:custom.title,exact:true}).waitFor();
 const community=await newPage(contractor,'community');
 await community.getByRole('group',{name:'Opportunity category'}).getByRole('button',{name:'Tenders',exact:true}).click();
 const communityCard=community.locator('.rp-opportunity-card').filter({has:community.getByRole('heading',{name:custom.title,exact:true})});
 await communityCard.waitFor();await communityCard.getByText('Customer contract',{exact:true}).waitFor();
 assert(!(await communityCard.innerText()).includes('PRIVATE exact gate'));
 await communityCard.getByRole('button',{name:'Open contract',exact:true}).click();
 await community.getByRole('heading',{name:'Your submitted proposals',exact:true}).waitFor();
 assert.equal(await community.getByText('PRIVATE exact gate and room 401',{exact:true}).count(),0);
 await layout(community);await audit(community);
 // The owner can find their request in Repaidians too, without creating a
 // public feed post or needing professional contractor approval.
 const ownerCommunity=await newPage(owner,'community');
 await ownerCommunity.getByRole('button',{name:'My listings',exact:true}).click();
 await ownerCommunity.locator('.rp-opportunity-card').filter({has:ownerCommunity.getByRole('heading',{name:custom.title,exact:true})}).getByRole('button',{name:'Open contract',exact:true}).click();
 await ownerCommunity.getByRole('heading',{name:'Private contractor proposals',exact:true}).waitFor();
 await ownerCommunity.getByRole('button',{name:'Review & accept proposal',exact:true}).waitFor();
 // A customer who also has an agent profile follows the same owned query.
 fixture('workers',owner.user.id,professional(owner));
 const agentOwner=await newPage(owner,'community');
 await agentOwner.getByRole('button',{name:'My listings',exact:true}).click();
 await agentOwner.locator('.rp-opportunity-card').filter({has:agentOwner.getByRole('heading',{name:custom.title,exact:true})}).getByRole('button',{name:'Open contract',exact:true}).click();
 await agentOwner.getByRole('heading',{name:'Private contractor proposals',exact:true}).waitFor();
 await agentOwner.getByRole('button',{name:'Review & accept proposal',exact:true}).waitFor();
 const refreshing=await newPage(contractor,'community');
 const visible=refreshing.locator('.rp-opportunity-card').filter({has:refreshing.getByRole('heading',{name:custom.title,exact:true})});
 await visible.waitFor();
 await api('/operations/custom-contracts/queries/'+custom.id+'/commands',owner,'POST',{request_id:randomUUID(),expected_version:ownerView.query.version,action:'close'});
 await refreshing.getByRole('button',{name:'Refresh opportunities',exact:true}).click();await visible.waitFor({state:'hidden'});
 for(const width of [320,465,1280]){await market.setViewportSize({width,height:850});await layout(market);}
 await mkdir(resolve(web,'test-results'),{recursive:true});await market.screenshot({path:resolve(web,'test-results/custom-contract-discovery-phone.png')});
 for(const page of [tenderDesk,market,community,ownerCommunity,agentOwner,refreshing])await page.context().close();
 console.log('PASS: customer query → contractor Tenders, customer Market and Repaidians → private proposal → customer review.');
 assert.deepEqual(errors,[]);succeeded=true;
}finally{await browser?.close();server?.kill('SIGTERM');if(succeeded)await rm(work,{recursive:true,force:true});else console.error('Isolated fixture retained at '+work+'\n'+log.slice(-4000));}
