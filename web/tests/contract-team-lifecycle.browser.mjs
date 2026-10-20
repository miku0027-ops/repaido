import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

// Uses real React components and native REST transitions against a fresh local
// SQLite database. Nothing in this fixture reaches a production API or account.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend');
const origin=process.env.CONTRACT_TEAM_PREVIEW_ORIGIN||'http://127.0.0.1:5199';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Use a local preview only');
const work=await mkdtemp(resolve(tmpdir(),'repaido-contract-team-')),db=resolve(work,'test.db');
const python=resolve(backend,'.venv/bin/python');
const available=createServer();await new Promise(r=>available.listen(0,'127.0.0.1',r));const port=available.address().port;await new Promise(r=>available.close(r));
const apiOrigin='http://127.0.0.1:'+port,report={checks:[],variants:[],errors:[],screenshots:[]};
let server,browser,log='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function fixtures(rows){
 const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nrows=json.loads(sys.argv[2])\nmain.operations_store.run(lambda u:[u.put(kind,key,value) for kind,key,value in rows])';
 const result=spawnSync(python,['-c',code,db,JSON.stringify(rows)],{cwd:backend,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,status=200){
 const response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();assert.equal(response.status,status,method+' '+path+': '+JSON.stringify(value));return value;
}
async function register(name){return api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','-')+'@example.test',password:'isolated-contract-team-test'},201);}
const workspace=account=>api('/operations/contractor/workspace',account);
async function projectFor(account,id){return (await workspace(account)).projects.find(p=>p.id===id);}
async function command(account,id,action,extra={},status=200){const p=await projectFor(account,id);return api('/operations/contractor/projects/'+id+'/commands',account,'POST',{expected_version:p.version,action,request_id:randomUUID(),...extra},status);}
async function pageFor(account,mode){
 const context=await browser.newContext({viewport:{width:537,height:850},reducedMotion:'reduce',timezoneId:'Asia/Kolkata'});
 await context.addInitScript(token=>localStorage.setItem('repaido.token',token),account.token);
 await context.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/tests/contracts-preview.html?mode='+mode);return page;
}
const projectDialog=(page,title)=>page.getByRole('dialog',{name:title,exact:true});
async function section(dialog,label){const summary=dialog.locator('summary').filter({hasText:label});await summary.waitFor();if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();return summary.locator('..');}
async function refresh(page){const top=page.locator('dialog[open]').last();const control=top.getByRole('button',{name:'Refresh workspace',exact:true});await (await control.count()?control:page.getByRole('button',{name:'Refresh workspace',exact:true})).click();}
async function confirmForm(page,title){const form=page.getByRole('dialog',{name:title,exact:true});await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Save & continue',exact:true}).click();await form.waitFor({state:'hidden'});}
async function screenshot(page,name){const path=resolve(work,name+'.png');await page.screenshot({path,fullPage:true});report.screenshots.push(path);}
async function noPrematureWork(page,peerName){
 const dialog=page.locator('dialog[open]').last();
 assert.equal(await dialog.locator('summary').filter({hasText:'Attendance & time records'}).count(),0);
 assert.equal(await dialog.locator('summary').filter({hasText:'Leave & availability'}).count(),0);
 assert.equal(await dialog.getByRole('button',{name:'Check in',exact:true}).count(),0);
 assert.equal(await dialog.getByRole('button',{name:'Request leave',exact:true}).count(),0);
 if(peerName)assert.equal(await dialog.getByText(peerName,{exact:true}).count(),0);
}
async function variants(page,label){
 for(const width of [320,537])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  const bad=await page.evaluate(()=>{
   const issues=[];if(document.documentElement.scrollWidth>innerWidth+1)issues.push('Document overflow');
   for(const el of document.querySelectorAll('dialog[open],.contract-project-workspace'))if(el.getClientRects().length&&el.scrollWidth>el.clientWidth+1){const edge=el.getBoundingClientRect().right;issues.push('Overflow '+el.className+' '+JSON.stringify([...el.querySelectorAll('*')].filter(child=>child.getClientRects().length&&child.getBoundingClientRect().right>edge+1).map(child=>({tag:child.tagName,class:child.className,width:child.getBoundingClientRect().width,right:child.getBoundingClientRect().right})).slice(0,8)));}
   const dialog=document.querySelector('dialog[open]');
   for(const el of dialog?.querySelectorAll('button,summary,input:not([type=checkbox]),select')||[]){if(el.getClientRects().length&&el.getBoundingClientRect().height<43.9)issues.push('Touch target below44px '+(el.getAttribute('aria-label')||el.textContent));}
   if(document.documentElement.style.fontSize==='100%'){
    const blocks=[...document.querySelector('.contract-project-workspace')?.children||[]].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().height>0);
    for(let index=1;index<blocks.length;index++)if(blocks[index].getBoundingClientRect().top-blocks[index-1].getBoundingClientRect().bottom>32)issues.push('Unused vertical gap above '+blocks[index].className);
   }
   return issues;
  });assert.deepEqual(bad,[],label+' '+JSON.stringify({width,theme,scale})+': '+JSON.stringify(bad));
  await page.addScriptTag({path:require.resolve('axe-core')});
  const violations=await page.evaluate(async()=>(await window.axe.run('dialog[open]',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
  assert.deepEqual(violations,[],label+' '+JSON.stringify({width,theme,scale}));
  report.variants.push({label,width,theme,scale});
 }
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await page.setViewportSize({width:537,height:850});
}

try{
 const code='import main,uvicorn,contract_work,repaidians_work,time\nfrom fastapi import Header,Body\nfrom types import SimpleNamespace\noriginal=main.current_user\ndef verified(authorization: str=Header(default="")):\n user=original(authorization)\n return {**user,"phone_verified":True,"phone_authenticated":True,"phone":"+919876543210"}\nmain.app.dependency_overrides[original]=verified\noffset=0\n@main.app.post("/e2e-clock")\ndef adjust(body:dict=Body(...)):\n global offset\n offset=body["seconds"]\n return {"offset":offset}\n@main.app.post("/e2e-work-tick")\ndef work_tick():\n return repaidians_work.process_updates(main,limit=20)\ncontract_work.time=SimpleNamespace(time=lambda:time.time()+offset)\nuvicorn.run(main.app,host="127.0.0.1",port='+port+')';
 server=spawn(python,['-c',code],{cwd:backend,env:{...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite',REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:''},stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',d=>log+=d);
 let ready=false;for(let i=0;i<300;i++){if(server.exitCode!==null)throw Error(log);try{if(log.includes('Uvicorn running on '+apiOrigin)&&(await fetch(apiOrigin+'/health')).ok){ready=true;break;}}catch{}await pause(100);}assert(ready,'Isolated backend startup: '+log);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const customer=await register('Project Customer'),contractor=await register('Contractor Lead'),agent=await register('Invited Electrician'),peer=await register('Future Teammate');
 const worker=(account,approved=false)=>['workers',account.user.id,{id:account.user.id,name:account.user.name,status:'approved',contractor_verified:approved,role:'technician',city:'Balasore',skills:['Electrical inspection'],categories:['electrician'],experience_years:4,completed_tasks:0,rating_count:0,rating_sum:0,phone:'PRIVATE_WORKER_PHONE',email:'PRIVATE_WORKER_EMAIL'}];
 fixtures([worker(contractor,true),worker(agent),worker(peer)]);
 const now=Date.now()/1000;
 fixtures([['contract_projects','private-recorded-history',{id:'private-recorded-history',owner_id:contractor.user.id,owner_name:contractor.user.name,title:'PRIVATE COMPLETED CLIENT TITLE',client_name:'PRIVATE COMPLETED CLIENT',site:'PRIVATE COMPLETED SITE',scope:'PRIVATE COMPLETED SCOPE',budget_paise:987654321,status:'completed',source_kind:'commercial_project',tender_id:null,starts_at:now-7200,ends_at:now-3600,team:[],attendance:[],leave:[],events:[],goals:[{id:'recorded-approved-milestone',title:'PRIVATE APPROVED OUTCOME',status:'approved',due_at:now-5000},{id:'recorded-reopened-milestone',title:'PRIVATE REOPENED OUTCOME',status:'reopened',due_at:now-4000}],version:1,created_at:now-8000}]]);
 const tender=await api('/operations/contractor/tenders',customer,'POST',{request_id:randomUUID(),title:'4BHK electrical project team',scope:'Inspect and install the agreed electrical work for a four bedroom home.',site:'PRIVATE PROJECT SITE',starts_at:now+3600,ends_at:now+18000,budget_paise:5000000,sector:'Electrical',city:'Balasore',opens_at:now-100,deadline:now+1800,manpower_needed:2,terms:'Recorded evaluation criteria and safe site delivery terms.'});
 const p=await api('/operations/contractor/projects',contractor,'POST',{request_id:randomUUID(),title:tender.title,scope:'Private scoped delivery approach for the invited project workers.',site:tender.site,starts_at:tender.starts_at,ends_at:tender.ends_at,budget_paise:tender.budget_paise,tender_id:tender.id});
 for(const account of [agent,peer]){const current=await projectFor(contractor,p.id);await api('/operations/contractor/projects/'+p.id+'/invitations',contractor,'POST',{expected_version:current.version,worker_id:account.user.id,role:'member',daily_rate_paise:100000,terms:'Eight agreed hours with safe equipment and the recorded compensation.'});}
 const agentPage=await pageFor(agent,'agent-projects');await agentPage.getByRole('button',{name:/Project teams & invitations/}).click();
 await agentPage.getByRole('button',{name:'Review joining terms',exact:true}).click();
 const detail=projectDialog(agentPage,p.title);await detail.waitFor();
 assert.equal(await agentPage.locator('dialog[open]').count(),1,'Project details reuse the single agent dialog');
 const credibility=detail.locator('.contract-contractor-record');await credibility.locator('summary').click();
 await credibility.getByText('Completed projects',{exact:true}).waitFor();
 assert.deepEqual(await credibility.locator('.contract-credibility-stats>span>strong').allTextContents(),['1','1','2'],'Credibility reflects recorded project and milestone aggregates');
 assert(!String(await detail.textContent()).includes('PRIVATE COMPLETED'),'Private historical project/client/site/outcome fields stay out of the agent modal');
 await noPrematureWork(agentPage,peer.user.name);await detail.getByRole('button',{name:'Accept invitation',exact:true}).click();await confirmForm(agentPage,'Accept team invitation');
 await detail.getByRole('heading',{name:'Your place is reserved',exact:true}).waitFor();await noPrematureWork(agentPage,peer.user.name);assert.equal(await detail.locator('.contract-team-celebration').count(),0);
 await detail.getByRole('button',{name:'Back to teams',exact:true}).focus();for(let index=0;index<8;index++){await agentPage.keyboard.press('Tab');assert(await detail.evaluate(dialog=>dialog.contains(document.activeElement)),'Keyboard focus remains inside the single agent dialog');}
 let own=await projectFor(agent,p.id);assert.equal(own.membership.joining_status,'accepted');assert.equal(own.capabilities.can_view_team,false);assert.equal(own.capabilities.can_view_attendance,false);assert.equal(own.capabilities.can_view_leave,false);assert.equal(own.team.length,1);
 assert(!JSON.stringify(own).includes('PRIVATE_WORKER_'),'Private worker contact fields never enter agent project payload');
 await command(agent,p.id,'leave_request',{starts_at:now+8000,ends_at:now+9000,note:'A genuine personal appointment.'},409);
 await screenshot(agentPage,'accepted-awaiting-joining-537');await variants(agentPage,'Accepted invitation');
 report.checks.push('Accepted invitation has one agent dialog, own offer only, no attendance/leave/peer names, and server rejects premature leave');console.log('PASS: '+report.checks.at(-1));
 const peerInvitation=(await projectFor(peer,p.id)).team[0];await command(peer,p.id,'accept',{target_id:peerInvitation.id});
 const ownerPage=await pageFor(contractor,'workspace');await ownerPage.getByRole('tab',{name:'Projects',exact:true}).click();await ownerPage.locator('.contract-card').filter({has:ownerPage.getByRole('heading',{name:p.title,exact:true})}).getByRole('button',{name:'Open project workspace',exact:true}).click();const ownerDetail=projectDialog(ownerPage,p.title);await section(ownerDetail,'Team & reporting lines');
 for(const account of [agent,peer]){const member=ownerDetail.locator('.contract-member').filter({hasText:account.user.name});await member.getByRole('button',{name:'Confirm joining',exact:true}).click();await confirmForm(ownerPage,'Confirm joining');}
 await refresh(agentPage);await detail.getByRole('heading',{name:'Joining confirmed',exact:true}).waitFor();await noPrematureWork(agentPage,peer.user.name);own=await projectFor(agent,p.id);assert.equal(own.membership.joining_status,'confirmed');assert.equal(own.capabilities.can_view_team,false);
 const confirmationRequest=ownerPage.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith('/commands')&&request.postDataJSON()?.action==='confirm_team');
 await ownerDetail.getByRole('button',{name:'Confirm team',exact:true}).click();await confirmForm(ownerPage,'Confirm team');await api('/e2e-work-tick',null,'POST',{});const confirmationBody=(await confirmationRequest).postDataJSON();
 await refresh(agentPage);await detail.getByRole('heading',{name:'Your team is ready',exact:true}).waitFor();await detail.locator('.contract-team-celebration').waitFor();
 assert.equal(await detail.locator('.contract-team-celebration').evaluate(el=>[el,...el.querySelectorAll('*')].some(node=>getComputedStyle(node).animationName!=='none'&&getComputedStyle(node).animationDuration.split(',').some(value=>Number.parseFloat(value)>.05))),false,'Reduced motion disables celebration motion');
 await screenshot(agentPage,'team-confirmed-award-pending-537');
 await detail.getByRole('button',{name:'Back to teams',exact:true}).click();await agentPage.getByRole('button',{name:'Open project workspace',exact:true}).click();await detail.waitFor();assert.equal(await detail.locator('.contract-team-celebration').count(),0,'Reopening a known confirmation does not replay celebration');
 await section(detail,'Team & reporting lines');await detail.getByText(peer.user.name,{exact:true}).waitFor();
 await noPrematureWork(agentPage);own=await projectFor(agent,p.id);assert.equal(own.team_confirmation.confirmed,true);assert.equal(own.capabilities.can_view_team,true);assert.equal(own.capabilities.can_view_attendance,false);assert.equal(own.capabilities.can_view_leave,false);
 assert(!JSON.stringify(own).includes('PRIVATE_WORKER_'));const notices=(await api('/operations/notifications',agent)).notifications.filter(n=>n.event==='team_confirmed'&&n.project_id===p.id);assert.equal(notices.length,1);assert.equal(notices[0].team_confirmation_id,own.team_confirmation.confirmation_id);assert.match(notices[0].title,/team is confirmed/i);assert(!/won|awarded|congratulations/i.test(notices[0].title),'A prepared tender team is not announced as a contract win');
 const noticeCount=notices.length;await api('/operations/contractor/projects/'+p.id+'/commands',contractor,'POST',confirmationBody);await api('/e2e-work-tick',null,'POST',{});assert.equal((await api('/operations/notifications',agent)).notifications.filter(n=>n.event==='team_confirmed'&&n.project_id===p.id).length,noticeCount,'Replaying the actual team-confirmation intent does not duplicate notifications');
 await agentPage.keyboard.press('Escape');assert.equal(await agentPage.locator('dialog[open]').count(),0);assert(await agentPage.getByRole('button',{name:/Project teams & invitations/}).evaluate(el=>el===document.activeElement),'Closing project restores focus to its launcher');
 const updatesTrigger=agentPage.getByRole('button',{name:/^Project updates/});await updatesTrigger.focus();await agentPage.keyboard.press('Enter');const updates=agentPage.getByRole('dialog',{name:'Project updates',exact:true});await updates.waitFor();
 await updates.getByRole('button',{name:new RegExp(notices[0].title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();await detail.waitFor();assert.equal(await agentPage.locator('dialog[open]').count(),1,'Notice opens the exact project in one dialog');
 assert((await api('/operations/notifications',agent)).notifications.find(n=>n.id===notices[0].id).read_at,'Opening an actual project update commits its read receipt');
 assert.equal(await detail.locator('.contract-team-celebration').count(),0,'Opening a known confirmation notice does not repeat the celebration');
 await variants(agentPage,'Confirmed team awaiting award');report.checks.push('Explicit joining and team confirmations reveal peer names/designations only, create one truthful durable notice, and celebration respects reduced motion and does not replay');console.log('PASS: '+report.checks.at(-1));
 let currentTender=(await workspace(contractor)).tenders.find(t=>t.id===tender.id);await api('/operations/contractor/tenders/'+tender.id+'/bid',contractor,'POST',{request_id:randomUUID(),expected_version:currentTender.version,project_id:p.id,amount_paise:4500000,proposal:'Detailed safe delivery plan with the two explicitly confirmed project workers.',accepted_terms:true});
 await api('/e2e-clock',null,'POST',{seconds:3700});currentTender=(await workspace(customer)).tenders.find(t=>t.id===tender.id);await api('/operations/contractor/tenders/'+tender.id+'/commands',customer,'POST',{expected_version:currentTender.version,action:'award',bid_id:currentTender.bids[0].id});
 await refresh(ownerPage);await section(ownerDetail,'Project controls');await ownerDetail.getByRole('button',{name:'Start work',exact:true}).click();await confirmForm(ownerPage,'Start project');
 await refresh(agentPage);await section(detail,'Attendance & time records');await detail.getByRole('button',{name:'Check in',exact:true}).click();await detail.getByRole('button',{name:'Check out',exact:true}).click();
 await section(detail,'Leave & availability');await detail.getByRole('button',{name:'Request leave',exact:true}).waitFor();
 own=await projectFor(agent,p.id);assert.equal(own.status,'active');assert.equal(own.attendance.length,1);assert(own.attendance[0].out_at>=own.attendance[0].in_at);assert.equal(own.capabilities.can_view_attendance,true);assert.equal(own.capabilities.can_view_leave,true);assert.equal(own.capabilities.can_request_leave,true);
 await screenshot(agentPage,'awarded-active-work-537');await variants(agentPage,'Awarded active work');await variants(ownerPage,'Contractor confirmed active team');
 await detail.evaluate(dialog=>{dialog.scrollTop=0;});await screenshot(agentPage,'awarded-active-work-top-537');await ownerDetail.evaluate(dialog=>{dialog.scrollTop=0;});await screenshot(ownerPage,'contractor-active-team-537');
 // Escape returns focus to the launching entry, with a single active dialog.
 await agentPage.keyboard.press('Escape');assert.equal(await agentPage.locator('dialog[open]').count(),0);assert(await updatesTrigger.evaluate(el=>el===document.activeElement),'Closing a project opened through the inbox restores focus to Project updates');
 report.checks.push('Real tender bid and customer award precede active HR; agent records own check-in/out and receives leave tools only after all gates');
 const linked=await pageFor(peer,'agent-projects&project='+p.id);await projectDialog(linked,p.title).waitFor();assert.equal(await linked.locator('dialog[open]').count(),1,'A real invited-worker deep link opens its exact authorized project');await linked.context().close();
 const unavailable=await pageFor(customer,'agent-projects&project='+p.id);await unavailable.getByRole('alert').filter({hasText:'This project is unavailable in your authorized workspace.'}).waitFor();assert.equal(await unavailable.getByRole('dialog',{name:p.title,exact:true}).count(),0,'Another account cannot open this project through a copied link');await unavailable.context().close();
 const responseProject=await api('/operations/contractor/projects',contractor,'POST',{request_id:randomUUID(),title:'Invitation response workflow',scope:'A separately scheduled project for the real decline and withdrawal regression.',site:'Private invitation test site',starts_at:now+90000,ends_at:now+93600,budget_paise:100000});
 async function inviteAgain(){const latest=await projectFor(contractor,responseProject.id);await api('/operations/contractor/projects/'+responseProject.id+'/invitations',contractor,'POST',{expected_version:latest.version,worker_id:agent.user.id,role:'member',daily_rate_paise:100000,terms:'Explicit recorded invitation terms and safe work requirements.'});}
 await inviteAgain();const responses=await pageFor(agent,'agent-projects&project='+responseProject.id);const responseDetail=projectDialog(responses,responseProject.title);await responseDetail.waitFor();await responseDetail.getByRole('button',{name:'Decline',exact:true}).click();await responses.getByRole('dialog',{name:'Project teams',exact:true}).waitFor();assert.equal(await responses.getByRole('alert').count(),0,'Declining returns to the team list without a false access error');assert.equal((await workspace(agent)).projects.some(row=>row.id===responseProject.id),false);
 await inviteAgain();await responses.goto(origin+'/tests/contracts-preview.html?mode=agent-projects&project='+responseProject.id);await responseDetail.waitFor();await responseDetail.getByRole('button',{name:'Accept invitation',exact:true}).click();await confirmForm(responses,'Accept team invitation');await noPrematureWork(responses);assert.equal(await responseDetail.getByRole('button',{name:'Leave team',exact:true}).count(),0);await section(responseDetail,'Invitation options');await responseDetail.getByRole('button',{name:'Withdraw invitation',exact:true}).click();await confirmForm(responses,'Withdraw accepted invitation');await responses.getByRole('dialog',{name:'Project teams',exact:true}).waitFor();assert.equal(await responses.getByRole('alert').count(),0,'Withdrawing an accepted invitation returns to the team list without a false access error');assert.equal((await workspace(agent)).projects.some(row=>row.id===responseProject.id),false);await responses.context().close();
 report.checks.push('Authorized project links open exactly one project; unauthorized links stay private; decline and pre-joining withdrawal return cleanly to the team list');
 assert.deepEqual(report.errors,[]);report.status='passed';console.log('PASS: '+report.checks.join('\nPASS: '));
}catch(error){report.status='failed';report.failure=String(error.stack||error);for(const page of browser?.contexts().flatMap(c=>c.pages())||[])await page.screenshot({path:resolve(work,'failure-'+randomUUID()+'.png')}).catch(()=>{});throw error;}
finally{await writeFile(resolve(work,'report.json'),JSON.stringify(report,null,2));for(const context of browser?.contexts()||[])await context.unrouteAll({behavior:'ignoreErrors'});await browser?.close();server?.kill('SIGTERM');console.log('Evidence: '+work);if(report.status!=='passed')console.error(log.slice(-6000));}
