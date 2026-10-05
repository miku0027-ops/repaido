import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--disable-dev-shm-usage']});
const base='http://127.0.0.1:5186';
const services=[
 {id:'clean',category:'cleaning',name:'Home cleaning',description:'Clean agreed rooms and surfaces.',price_paise:49900,duration_minutes:60,included:['Agreed surfaces'],excluded:['Materials']},
 {id:'electric',category:'electrician',name:'Electrical inspection',description:'Inspect wiring and electrical faults.',price_paise:29900,duration_minutes:30,included:['Inspection'],excluded:['Replacement parts']},
 {id:'plumber',category:'plumber',name:'Tap repair',description:'Inspect a leaking tap.',price_paise:19900,duration_minutes:30,included:['Inspection'],excluded:['Replacement parts']},
 {id:'ac',category:'ac',name:'Air conditioner inspection',description:'Inspect the air conditioner.',price_paise:39900,duration_minutes:45,included:['Inspection'],excluded:['Replacement parts']}
];
const profile=(id,name,category,reviewed=false)=>({id,name,role:'technician',categories:[category],experience_years:5,skills:['Inspection'],tools:['Reviewed tool list'],languages:['Odia'],bio:'Registered professional profile.',completed_tasks:reviewed?3:0,rating:reviewed?4.5:null,review_count:reviewed?2:0,rank:reviewed?1:null,distribution:{'1':0,'2':0,'3':0,'4':1,'5':1},reviews:[],category_records:reviewed?[{category,completed:3,rating:4.5,review_count:2}]:[],service_packages:[],offers:[]});
const profiles=[profile('e1','First electrical professional','electrician',true),profile('e2','Second electrical professional','electrician'),profile('c1','Cleaning professional','cleaning',true)];
const requests=[],errors=[];let slowElectrical=false,failCleaning=false;
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/catalog')return route.fulfill({json:{services,categories:[{id:'cleaning',name:'Home Cleaning'},{id:'electrician',name:'Electrical'},{id:'plumber',name:'Plumbing'},{id:'ac',name:'AC & Appliances'}]}});
  if(url.pathname==='/api/operations/hiring/leaderboard'){
   const b=route.request().postDataJSON();requests.push(b);
   if(b.category==='electrician'&&slowElectrical)await new Promise(r=>setTimeout(r,500));
   if(b.category==='cleaning'&&failCleaning)return route.fulfill({status:503,json:{detail:'Unavailable'}});
   const rows=profiles.filter(p=>p.categories.includes(b.category)&&(b.role==='all'||p.role===b.role));
   return route.fulfill({json:{professionals:rows,total:rows.length,categories:[]}});
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
  assert.equal(await page.locator('.catalog-professionals,.uc-candidate-engine-card,.service-leaders-accordion').count(),0);
  const first=await page.locator('.uc-service-card').first().boundingBox();assert(first.y<430,'First service row should remain visible without a recommendation wall');
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
  await cat('All services');assert.equal(await page.locator('.catalog-professionals').count(),0);
  await page.getByRole('button',{name:'Choose Electrical inspection for ₹299',exact:true}).click();assert.equal(await page.getByLabel('Chosen service').textContent(),'electric');
  console.log('Catalogue, category filtering, compact layout and real service action passed:',width);
 }
 slowElectrical=true;const delayedRequest=page.waitForRequest(r=>r.url().includes('leaderboard')&&r.postDataJSON().category==='electrician');await cat('Electrical');await delayedRequest;
 await cat('Home Cleaning');await settled();await page.locator('.catalog-professionals-toggle').click();await page.waitForTimeout(650);assert.equal(await page.locator('.catalog-professional h3').textContent(),'Cleaning professional');slowElectrical=false;
 await cat('All services');failCleaning=true;await cat('Home Cleaning');await page.locator('.catalog-professionals-copy > span').filter({hasText:'temporarily unavailable'}).waitFor();
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
 assert(requests.every(r=>r.category&&r.category!=='all'));
 assert.deepEqual(errors,[]);console.log('Race cancellation, error recovery, empty results, 200% text, reduced motion and AAA contrast passed');
}finally{await browser.close();}
