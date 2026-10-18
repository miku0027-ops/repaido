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
const requests=[],errors=[];let slowElectrical=false,failCleaning=false,failOverview=false,malformedOverview=false,electricalLeader='e1';
try{
 const page=await browser.newPage();await page.clock.install();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/catalog')return route.fulfill({json:{services,categories:[{id:'cleaning',name:'Home Cleaning'},{id:'electrician',name:'Electrical'},{id:'plumber',name:'Plumbing'},{id:'ac',name:'AC & Appliances'}]}});
  if(url.pathname.startsWith('/api/operations/hiring/availability/'))return route.fulfill({json:{availability:{state:'not_confirmed',label:'Schedule needs confirmation',available_at:null,estimated:true,checked_at:Date.now()/1000}}});
  if(url.pathname==='/api/operations/hiring/leaderboard'){
   const b=route.request().postDataJSON();requests.push(b);
   if(!b.category&&malformedOverview)return route.fulfill({json:{}});
   if(b.category==='electrician'&&slowElectrical)await new Promise(r=>setTimeout(r,500));
   if((b.category==='cleaning'&&failCleaning)||(!b.category&&failOverview))return route.fulfill({status:503,json:{detail:'Unavailable'}});
   const eligible=b.city==='Balasore'?profiles.filter(p=>b.role==='all'||p.role===b.role):[];
   const rows=eligible.filter(p=>!b.category||p.categories.includes(b.category));
   const names={cleaning:'Home Cleaning',electrician:'Electrical',plumber:'Plumbing',ac:'AC & Appliances'};
   const categories=Object.entries(names).map(([id,name])=>{const candidates=eligible.filter(p=>p.categories.includes(id));const leader=candidates.find(p=>id==='electrician'?p.id===electricalLeader:p.review_count>0);return {id,name,count:candidates.length,leader:leader?{id:leader.id,name:leader.name,role:leader.role}:null};});
   return route.fulfill({json:{professionals:b.summary_only?[]:rows,total:b.summary_only?0:rows.length,categories}});
  }
  if(url.pathname.startsWith('/api/operations/service-terms/'))return route.fulfill({json:{id:'terms',version:1,text:'Review the scope before confirming.'}});
  if(url.pathname.startsWith('/api/operations/professionals/')){const profile=profiles.find(row=>row.id===decodeURIComponent(url.pathname.split('/').at(-1)));return route.fulfill({status:profile?200:404,json:profile||{detail:'Profile unavailable'}});}
  if(url.pathname.startsWith('/api/'))throw Error('Unexpected API request: '+url.pathname);
  return route.continue();
 });
 const cat=name=>page.getByRole('combobox',{name:'Service category',exact:true}).selectOption({label:name});
 const settled=async()=>{await page.locator('.catalog-professionals-copy > span').filter({hasText:/reviewed profiles?/}).waitFor();};
 const layout=async()=>{
  const issues=await page.locator('.catalog-discovery').evaluate(root=>{
   const bad=[];if(document.documentElement.scrollWidth>innerWidth+1)bad.push('page overflow');
   for(const e of root.querySelectorAll('.story-label,.catalog-professionals-copy,.catalog-professional-info'))if(e.scrollWidth>e.clientWidth+1)bad.push('clipped '+e.className);
   for(const e of root.querySelectorAll('.catalog-professionals button'))if(e.getBoundingClientRect().height<43.9)bad.push('small touch target '+(e.getAttribute('aria-label')||e.textContent)+' '+e.getBoundingClientRect().height);
   return bad;
  });assert.deepEqual(issues,[]);
 };
 const compactLayout=async(enlarged=false)=>{
  const dimensions=await page.locator('.catalogue-dropdown-strip').evaluate(root=>{
   const rect=root.getBoundingClientRect(),canvas=document.createElement('canvas'),context=canvas.getContext('2d'),controls=Array.from(root.querySelectorAll('select')).map(control=>{const r=control.getBoundingClientRect(),style=getComputedStyle(control);context.font=style.font;return {x:r.x,y:r.y,right:r.right,width:r.width,height:r.height,textWidth:context.measureText(control.selectedOptions[0].textContent).width,textSpace:control.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};});
   return {x:rect.x,right:rect.right,height:rect.height,controls,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert.equal(dimensions.controls.length,2,'Category and sort share a single compact control panel');
  assert(dimensions.pageWidth<=dimensions.viewport+1,'Compact catalogue controls must not overflow the viewport');
  assert(dimensions.controls.every(control=>control.height>=43.9&&control.x>=dimensions.x-1&&control.right<=dimensions.right+1),'Dropdowns keep fully contained 44px touch targets');
  assert(dimensions.controls.every(control=>control.textWidth<=control.textSpace+1),'The selected category and sort labels remain fully visible, including at 200% text');
  assert(dimensions.height<=(enlarged?240:190),'Catalogue controls replace the tall category carousel');
  if(!enlarged&&dimensions.viewport>=320)assert(Math.abs(dimensions.controls[0].y-dimensions.controls[1].y)<1,'Category and sort remain on one row on standard phones');
  assert.equal(await page.locator('.service-controls-compact .service-story,.service-controls-compact .stories-heading').count(),0,'No duplicate photo rail or carousel arrows');
 };
 const filterDialog=()=>page.getByRole('dialog',{name:'Filters & sort',exact:true});
 const openFilters=async()=>{await page.getByRole('button',{name:'Filters and sort',exact:true}).click();await filterDialog().waitFor();};
 const applyFilters=async(count)=>{await filterDialog().getByRole('button',{name:`Show ${count} ${count===1?'service':'services'}`,exact:true}).click();await filterDialog().waitFor({state:'hidden'});};
 const names=()=>page.locator('.uc-service-title').allTextContents();
 await mkdir('test-results',{recursive:true});
 for(const width of [320,390,480]){
  await page.setViewportSize({width,height:850});await page.goto(base+'/tests/discovery-preview.html');await page.locator('.uc-service-card').nth(3).waitFor();
  await page.getByRole('navigation',{name:'Category leaderboards',exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Category leaders',exact:true}).count(),1);
  assert.equal(await page.locator('.uc-candidate-engine-card,.service-leaders-accordion').count(),0);
  assert.equal(await page.locator('.catalog-leader-preview').count(),2);
  assert.match(await page.getByRole('button',{name:'View Electrical leaderboard',exact:true}).textContent(),/First electrical professional/);
  const first=await page.locator('.uc-service-card').first().boundingBox();assert(first.y+Math.min(first.height,44)<page.viewportSize().height,'The first service card must be reachable in the initial phone viewport');
  await layout();await compactLayout();await cat('Electrical');await settled();
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
 malformedOverview=true;await refresh.click();await page.getByRole('alert').filter({hasText:'Leaders could not refresh'}).waitFor();assert.match(await firstLeader.textContent(),/Second electrical professional/);malformedOverview=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});assert.match(await firstLeader.textContent(),/Second electrical professional/,'An invalid success response must not poison the cached leaders or crash their retry');
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
 // Draft edits never change the catalogue until the customer applies them.
 const filterButton=page.getByRole('button',{name:'Filters and sort',exact:true});
 await filterButton.focus();await page.keyboard.press('Enter');await filterDialog().waitFor();
 assert.equal(await filterDialog().getByLabel('Service category',{exact:true}).evaluate(control=>control===document.activeElement),true,'Keyboard opening focuses the first filter');
 const radius=filterDialog().getByLabel('Professional search radius',{exact:true});assert.equal(await radius.isDisabled(),true);assert.match(await radius.getAttribute('aria-describedby'),/location-note/);
 await filterDialog().getByText('Set a location on Explore to filter professionals by distance.',{exact:false}).waitFor();
 await filterDialog().getByLabel('Service category',{exact:true}).selectOption('cleaning');await filterDialog().getByLabel('Max Budget',{exact:true}).selectOption('300');await filterDialog().getByLabel('Professional role',{exact:true}).selectOption('specialist');
 await filterDialog().getByRole('button',{name:'Show 0 services',exact:true}).waitFor();assert.equal(await page.locator('.uc-service-card').count(),4,'Preview counts do not mutate applied services');
 await page.keyboard.press('Escape');assert.equal(await filterButton.evaluate(button=>button===document.activeElement),true,'Escape restores focus to the filter launcher');
 assert.equal(await page.getByRole('combobox',{name:'Service category',exact:true}).inputValue(),'all');assert.equal(await page.locator('.catalogue-active-filters button').count(),0);
 await openFilters();assert.equal(await filterDialog().getByLabel('Professional role',{exact:true}).inputValue(),'all','Closing discards draft role changes');assert.equal(await filterDialog().getByLabel('Max Budget',{exact:true}).inputValue(),'');
 await filterDialog().getByLabel('Sort services',{exact:true}).selectOption('price-low');await filterDialog().getByLabel('Max Budget',{exact:true}).selectOption('300');await applyFilters(2);
 assert.deepEqual(await names(),['Tap repair','Electrical inspection'],'Budget applies to service prices with the selected ordering');
 assert.equal(await page.getByRole('combobox',{name:'Sort catalogue services',exact:true}).inputValue(),'price-low','Sheet and compact sort stay in sync');
 await page.getByRole('button',{name:'Remove maximum budget',exact:true}).click();assert.equal(await page.locator('.uc-service-card').count(),4);assert.equal(await page.locator('.catalogue-active-filters').count(),0);
 await page.getByRole('combobox',{name:'Sort catalogue services',exact:true}).selectOption('price-high');assert.deepEqual(await names(),['Home cleaning','Air conditioner inspection','Electrical inspection','Tap repair']);
 await page.getByRole('combobox',{name:'Sort catalogue services',exact:true}).selectOption('duration');assert.deepEqual(await names(),['Tap repair','Electrical inspection','Air conditioner inspection','Home cleaning']);
 const search=page.getByRole('searchbox',{name:'Search services, repairs, specialists or technicians',exact:true});
 await search.fill('inspection');await openFilters();await filterDialog().getByRole('button',{name:'Show 3 services',exact:true}).waitFor();await filterDialog().getByRole('button',{name:'Reset Filters',exact:true}).click();await applyFilters(3);
 assert.equal(await search.inputValue(),'inspection','Reset filters preserves the current search text');assert.equal(await page.locator('.uc-service-card').count(),3);await search.fill('');
 await page.getByRole('combobox',{name:'Sort catalogue services',exact:true}).selectOption('duration');
 await openFilters();assert.equal(await filterDialog().getByLabel('Sort services',{exact:true}).inputValue(),'duration');
 await filterDialog().getByLabel('Service category',{exact:true}).selectOption('electrician');await filterDialog().getByLabel('Max Budget',{exact:true}).selectOption('300');await filterDialog().getByLabel('Sort services',{exact:true}).selectOption('price-low');await applyFilters(1);assert.deepEqual(await names(),['Electrical inspection']);
 await openFilters();await filterDialog().getByRole('button',{name:'Reset Filters',exact:true}).click();assert.equal(await page.locator('.uc-service-card').count(),1,'Reset changes only the draft until applied');assert.equal(await filterDialog().getByLabel('Service category',{exact:true}).inputValue(),'all');await applyFilters(4);await page.getByRole('navigation',{name:'Category leaderboards'}).waitFor();
 await openFilters();await filterDialog().getByLabel('Professional role',{exact:true}).selectOption('specialist');await applyFilters(4);
 await page.getByText('No matching professionals are listed here yet.',{exact:true}).waitFor();assert.equal(await page.locator('.uc-service-card').count(),4,'Professional filters never hide catalogue services');
 await page.getByRole('button',{name:'Remove professional role filter',exact:true}).click();await page.getByRole('navigation',{name:'Category leaderboards'}).waitFor();
 for(const width of [320,390,480]){
  await page.setViewportSize({width,height:850});
  for(const enlarged of [false,true]){
   await page.addStyleTag({content:`html{font-size:${enlarged?32:16}px}`});await compactLayout(enlarged);await openFilters();
   const geometry=await filterDialog().evaluate(dialog=>{const r=dialog.getBoundingClientRect(),footer=dialog.querySelector('.catalogue-filter-footer').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:dialog.scrollWidth,width:dialog.clientWidth,viewport:innerWidth,viewportHeight:innerHeight,footerBottom:footer.bottom,footerTop:footer.top};});
   assert(geometry.left>=-1&&geometry.right<=geometry.viewport+1&&geometry.top>=-1&&geometry.bottom<=geometry.viewportHeight+1,'Filter sheet fits the mobile viewport');assert(geometry.scroll<=geometry.width+1,'Filter sheet does not scroll horizontally');assert(geometry.footerBottom<=geometry.bottom+1&&geometry.footerTop>=geometry.top,'Apply actions stay visible while the form scrolls');
   for(const theme of ['light','dark']){
    await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);
    const result=await page.evaluate(async()=>window.axe.run(document.querySelector('.service-catalogue-filter-sheet'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}}));
    assert.deepEqual(result.violations.map(violation=>({id:violation.id,targets:violation.nodes.map(node=>node.target)})),[],`${theme} filter accessibility at ${width}px ${enlarged?'200%':'100%'} text`);
   }
   await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));await page.keyboard.press('Escape');
   for(const theme of ['light','dark']){
    await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);
    const result=await page.evaluate(async()=>window.axe.run(document.querySelector('.service-controls-compact'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}}));
    assert.deepEqual(result.violations.map(violation=>({id:violation.id,targets:violation.nodes.map(node=>node.target)})),[],`${theme} compact controls accessibility at ${width}px ${enlarged?'200%':'100%'} text`);
   }
   await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
  }
 }
 await page.addStyleTag({content:'html{font-size:16px}'});await page.setViewportSize({width:390,height:850});
 await openFilters();await page.screenshot({path:'test-results/catalogue-filters-phone.png'});await page.keyboard.press('Escape');
 assert(requests.filter(request=>request.category==='').every(request=>request.summary_only===true),'Leader overview requests compact public summaries');
 await page.getByRole('button',{name:'Choose service city: Balasore',exact:true}).click();await page.getByRole('combobox',{name:'Choose service city',exact:true}).selectOption('Bhadrak');await page.getByRole('button',{name:'Use this city',exact:true}).click();await page.getByText('No matching professionals are listed here yet.',{exact:true}).waitFor();
 assert.equal(await page.locator('.catalog-leader-preview').count(),0,'Changing city must never display the previous city’s leaders');
 assert.deepEqual(errors,[]);console.log('Compact dropdowns, atomic filters, preview counts, sorting, removable filters, keyboard focus, summary-only leaders, polling/races/recovery, 200% text, reduced motion and light/dark AAA accessibility passed');
}finally{await browser.close();}
