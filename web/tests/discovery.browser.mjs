import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--disable-dev-shm-usage']});
const base=process.env.DISCOVERY_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const services=[
 {id:'clean',category:'cleaning',name:'Home cleaning',description:'Clean agreed rooms and surfaces.',price_paise:49900,duration_minutes:60,included:['Agreed surfaces'],excluded:['Materials']},
 {id:'electric',category:'electrician',name:'Electrical inspection',description:'Inspect wiring and electrical faults.',price_paise:29900,duration_minutes:30,included:['Inspection'],excluded:['Replacement parts']},
 {id:'plumber',category:'plumber',name:'Tap repair',description:'Inspect a leaking tap.',price_paise:19900,duration_minutes:30,included:['Inspection'],excluded:['Replacement parts']},
 {id:'ac',category:'ac',name:'Air conditioner inspection',description:'Inspect the air conditioner.',price_paise:39900,duration_minutes:45,included:['Inspection'],excluded:['Replacement parts']}
];
const profile=(id,name,category,reviewed=false)=>({id,name,role:'technician',categories:[category],experience_years:5,skills:['Inspection'],tools:['Reviewed tool list'],languages:['Odia'],bio:'Registered professional profile.',completed_tasks:reviewed?3:0,rating:reviewed?4.5:null,review_count:reviewed?2:0,rank:reviewed?1:null,distribution:{'1':0,'2':0,'3':0,'4':1,'5':1},reviews:[],category_records:reviewed?[{category,completed:3,rating:4.5,review_count:2}]:[],service_packages:[],offers:[]});
const profiles=[profile('e1','First electrical professional','electrician',true),profile('e2','Second electrical professional','electrician'),profile('c1','Cleaning professional','cleaning',true)];
const requests=[],errors=[];let slowElectrical=false,failCleaning=false,failOverview=false,electricalLeader='e1';
try{
 const page=await browser.newPage();await page.clock.install();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/catalog')return route.fulfill({json:{services,categories:[{id:'cleaning',name:'Home Cleaning'},{id:'electrician',name:'Electrical'},{id:'plumber',name:'Plumbing'},{id:'ac',name:'AC & Appliances'}]}});
  if(url.pathname==='/api/operations/hiring/leaderboard'){
   const b=route.request().postDataJSON();requests.push(b);
   if(b.category==='electrician'&&slowElectrical)await new Promise(r=>setTimeout(r,500));
   if((b.category==='cleaning'&&failCleaning)||(!b.category&&failOverview))return route.fulfill({status:503,json:{detail:'Unavailable'}});
   const eligible=b.city==='Balasore'?profiles.filter(p=>b.role==='all'||p.role===b.role):[];
   const rows=eligible.filter(p=>!b.category||p.categories.includes(b.category));
   const names={cleaning:'Home Cleaning',electrician:'Electrical',plumber:'Plumbing',ac:'AC & Appliances'};
   const categories=Object.entries(names).map(([id,name])=>{const candidates=eligible.filter(p=>p.categories.includes(id));const leader=candidates.find(p=>id==='electrician'?p.id===electricalLeader:p.review_count>0);return {id,name,count:candidates.length,leader:leader?{id:leader.id,name:leader.name,role:leader.role}:null};});
   return route.fulfill({json:{professionals:rows,total:rows.length,categories}});
  }
  if(url.pathname.startsWith('/api/operations/service-terms/'))return route.fulfill({json:{id:'terms',version:1,text:'Review the scope before confirming.'}});
  if(url.pathname.startsWith('/api/'))throw Error('Unexpected API request: '+url.pathname);
  return route.continue();
 });
 const cat=name=>page.getByRole('group',{name:'Service categories',exact:true}).getByRole('button',{name,exact:true}).click();
 const settled=async()=>{await page.locator('.catalog-professionals-copy > span').filter({hasText:/reviewed profiles?/}).waitFor();};
 const layout=async()=>{
  const issues=await page.locator('.catalog-discovery').evaluate(root=>{
   const bad=[];if(document.documentElement.scrollWidth>innerWidth+1)bad.push('page overflow');
   for(const e of root.querySelectorAll('.story-label,.catalog-professionals-copy,.catalog-professional-info'))if(e.scrollWidth>e.clientWidth+1)bad.push('clipped '+e.className);
   for(const e of root.querySelectorAll('.catalog-professionals button'))if(e.getBoundingClientRect().height<44)bad.push('small touch target');
   return bad;
  });assert.deepEqual(issues,[]);
 };
 await mkdir('test-results',{recursive:true});
 for(const width of [320,390,430,524]){
  await page.setViewportSize({width,height:850});await page.goto(base+'/tests/discovery-preview.html');await page.locator('.uc-service-card').nth(3).waitFor();
  await page.getByRole('navigation',{name:'Category leaderboards',exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Category leaders',exact:true}).count(),1);
  assert.equal(await page.locator('.uc-candidate-engine-card,.service-leaders-accordion').count(),0);
  assert.equal(await page.locator('.catalog-leader-preview').count(),2);
  assert.match(await page.getByRole('button',{name:'View Electrical leaderboard',exact:true}).textContent(),/First electrical professional/);
  const first=await page.locator('.uc-service-card').first().boundingBox();if(first.y>=580){await page.screenshot({path:'test-results/leader-layout-failure.png'});console.log(await page.locator('.catalog-leaders-overview').evaluate(e=>({first:e.getBoundingClientRect().toJSON(),children:[...e.children].map(c=>({tag:c.tagName,class:c.className,bounds:c.getBoundingClientRect().toJSON()}))})));}assert(first.y<580,'The compact leader rail must keep the first service row visible on a phone');
  await layout();await cat('Electrical');await settled();
  const summary=page.locator('.catalog-professionals-toggle');assert.equal(await summary.getAttribute('aria-expanded'),'false');assert((await summary.boundingBox()).height<100);
  assert.equal(await page.locator('.uc-service-card').count(),1);
  assert.equal(await page.locator('.uc-service-title').textContent(),'Electrical inspection');
  await summary.click();assert.equal(await page.locator('.catalog-professional').count(),2);
  assert.equal(await page.getByText('Category rank #1',{exact:true}).count(),1);
  assert.equal(await page.getByText('No category reviews yet',{exact:true}).count(),1);
  await layout();
  await page.getByRole('button',{name:'View Second electrical professional’s profile'}).click();
  await page.getByRole('dialog',{name:'Second electrical professional',exact:true}).waitFor();await page.keyboard.press('Escape');
  await cat('Home Cleaning');await settled();assert.equal(await page.locator('.catalog-professionals-toggle').getAttribute('aria-expanded'),'false');
  await page.locator('.catalog-professionals-toggle').click();assert.equal(await page.locator('.catalog-professional h3').textContent(),'Cleaning professional');
  await cat('All services');assert.equal(await page.getByRole('region',{name:'Category leaders',exact:true}).count(),1);
  const previousElectrical=requests.filter(r=>r.category==='electrician').length;
  await cat('Electrical');await settled();assert.equal(requests.filter(r=>r.category==='electrician').length,previousElectrical,'reopening a fresh category should use the cached public profiles');
  await cat('All services');
  await page.getByRole('button',{name:'Choose Electrical inspection for ₹299',exact:true}).click();assert.equal(await page.getByLabel('Chosen service').textContent(),'electric');
  console.log('Catalogue, category filtering, compact layout and real service action passed:',width);
 }
 await page.reload();await page.locator('.uc-service-card').nth(3).waitFor();
 slowElectrical=true;const delayedRequest=page.waitForRequest(r=>r.url().includes('leaderboard')&&r.postDataJSON().category==='electrician');await cat('Electrical');await delayedRequest;
 await cat('Home Cleaning');await settled();await page.locator('.catalog-professionals-toggle').click();await page.waitForTimeout(650);assert.equal(await page.locator('.catalog-professional h3').textContent(),'Cleaning professional');slowElectrical=false;
 await page.reload();await page.locator('.uc-service-card').nth(3).waitFor();
 failCleaning=true;await cat('Home Cleaning');await page.locator('.catalog-professionals-copy > span').filter({hasText:'temporarily unavailable'}).waitFor();
 assert.equal(await page.locator('.uc-service-card').count(),1);await page.locator('.catalog-professionals-toggle').click();await page.getByRole('alert').waitFor();failCleaning=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await settled();assert.equal(await page.locator('.catalog-professional h3').textContent(),'Cleaning professional');
 await cat('Plumbing');await settled();await page.locator('.catalog-professionals-toggle').click();await page.getByText('No matching professionals are listed here yet.',{exact:false}).waitFor();
 await cat('Electrical');await settled();await page.locator('.catalog-professionals-toggle').click();
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.catalog-professionals-panel').evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  const result=await page.evaluate(async()=>window.axe.run(document.querySelector('.catalog-professionals'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}}));
  assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],theme+' accessibility');
 }
 await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
 await page.setViewportSize({width:320,height:850});await page.addStyleTag({content:'html{font-size:32px}'});await layout();
 await page.addStyleTag({content:'html{font-size:16px}'});await page.setViewportSize({width:390,height:850});await cat('All services');await page.screenshot({path:'test-results/catalogue-phone.png'});
 await cat('Electrical');await settled();await page.locator('.catalog-professionals-toggle').click();await page.screenshot({path:'test-results/category-professionals-phone.png'});
 assert(requests.every(r=>r.category!=='all'),'All services sends the server an unfiltered category, not an invalid category ID');
 assert(requests.some(r=>r.category===''),'Default Services loads the live category leader overview');
 await cat('All services');await page.getByRole('navigation',{name:'Category leaderboards'}).waitFor();
 await page.getByRole('button',{name:'View Electrical leaderboard',exact:true}).click();await settled();
 assert.equal(await page.locator('.catalog-professionals-toggle').getAttribute('aria-expanded'),'true','Selecting an overview category opens its actual leaderboard');
 assert.equal(await page.locator('.catalog-professional').count(),2);assert.equal(await page.locator('.uc-service-card').count(),1);
 await cat('All services');
 const firstLeader=page.getByRole('button',{name:'View Electrical leaderboard',exact:true});
 const refresh=page.getByRole('button',{name:'Refresh category leaders',exact:true});
 electricalLeader='e2';profiles[1].review_count=3;profiles[1].rank=1;profiles[1].category_records=[{category:'electrician',completed:3,rating:5,review_count:3}];await refresh.click();await firstLeader.getByText('Second electrical professional',{exact:true}).waitFor();
 failOverview=true;await refresh.click();await page.getByRole('alert').filter({hasText:'Leaders could not refresh'}).waitFor();
 assert.match(await firstLeader.textContent(),/Second electrical professional/,'Failed background refresh retains genuine last received leaders');
 assert.equal(await page.locator('.repaido-launch,.repaido-loading-notice').count(),0);
 failOverview=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});
 const focusRequest=page.waitForRequest(r=>r.url().includes('leaderboard')&&r.postDataJSON().category==='');
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await focusRequest;
 await page.waitForFunction(()=>!document.querySelector('.catalog-leaders-refresh')?.disabled);
 const periodicRequest=page.waitForRequest(r=>r.url().includes('leaderboard')&&r.postDataJSON().category==='');
 await page.clock.fastForward(31000);await periodicRequest;await page.waitForFunction(()=>!document.querySelector('.catalog-leaders-refresh')?.disabled);
 const beforeHidden=requests.length;await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
 await page.clock.fastForward(31000);assert.equal(requests.length,beforeHidden,'Hidden tabs do not keep refreshing leaderboards');
 const resumedRequest=page.waitForRequest(r=>r.url().includes('leaderboard')&&r.postDataJSON().category==='');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await resumedRequest;await page.waitForFunction(()=>!document.querySelector('.catalog-leaders-refresh')?.disabled);
 electricalLeader=null;profiles[2].review_count=0;await refresh.click();await page.getByText('No ranked leader yet',{exact:true}).first().waitFor();
 assert.equal(await page.getByText('No ranked leader yet',{exact:true}).count(),2,'No category rank is fabricated when the server has no reviewed leaders');
 await layout();
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  const result=await page.evaluate(async()=>window.axe.run(document.querySelector('.catalog-leaders-overview'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}}));
  assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],theme+' overview accessibility');
 }
 await page.setViewportSize({width:320,height:850});await page.addStyleTag({content:'html{font-size:32px}'});await layout();
 await page.addStyleTag({content:'html{font-size:16px}'});
 await page.getByRole('button',{name:'Filters and sort',exact:true}).click();await page.getByLabel('Professional role',{exact:true}).selectOption('specialist');await page.keyboard.press('Escape');
 await page.getByText('No matching professionals are listed here yet.',{exact:true}).waitFor();assert.equal(await page.locator('.uc-service-card').count(),4);
 await page.getByRole('button',{name:'Filters and sort',exact:true}).click();await page.getByRole('button',{name:'Reset Filters',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('navigation',{name:'Category leaderboards'}).waitFor();
 await page.getByRole('button',{name:'Choose service city: Balasore',exact:true}).click();await page.getByRole('combobox',{name:'Choose service city',exact:true}).selectOption('Bhadrak');await page.getByRole('button',{name:'Use this city',exact:true}).click();await page.getByText('No matching professionals are listed here yet.',{exact:true}).waitFor();
 assert.equal(await page.locator('.catalog-leader-preview').count(),0,'Changing city must never display the previous city’s leaders');
 assert.deepEqual(errors,[]);console.log('Default live leader overview, category navigation, polling/focus refresh, retained results on failure, race cancellation, error recovery, empty results, 200% text, reduced motion and AAA contrast passed');
}finally{await browser.close();}
