import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const origin=process.env.HIRING_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const artifacts=resolve(web,'test-results');
const categories=[{id:'electrician',name:'Electrical installation and maintenance'},{id:'cleaning',name:'Home cleaning and household help'},{id:'ac',name:'AC & appliance repairs'},{id:'plumber',name:'Plumbing'},{id:'carpenter',name:'Carpentry'},{id:'painting',name:'Painting'},{id:'salon',name:'Salon & spa'},{id:'pest',name:'Pest control'},{id:'moving',name:'Moving help'},{id:'car',name:'Car repair'},{id:'solar',name:'Solar equipment maintenance'}];
const homeCategories=[{id:'home:maid',name:'Maid & daily home help'},{id:'home:caretaker',name:'Non-medical care at home'},{id:'home:interior-design',name:'Interior design'}];
const packages=[{id:'fixture-electrical',name:'Electrical inspection scope',description:'Check switches, sockets and the distribution board.',price_paise:79900,duration_minutes:60,included:['Inspect two reported fittings','Written findings'],excluded:['Parts','Travel','Additional work']},{id:'fixture-cleaning',name:'Cleaning inspection scope',description:'Inspect the surfaces and agree the cleaning scope.',price_paise:49900,duration_minutes:45,included:['Inspect surfaces','Written scope'],excluded:['Materials','Travel']}];
const services=packages.map((p,index)=>({...p,category:index?'cleaning':'electrician'}));
const profiles=Array.from({length:5},(_,index)=>{
  const cleaning=index===4,category=cleaning?'cleaning':'electrician';
  return {id:'fixture-worker-'+index,name:cleaning?'Fixture Cleaning Professional':'Fixture Electrical Professional '+(index+1),role:index%2?'technician':'specialist',city:'Test city',categories:[category],skills:[cleaning?'Surface cleaning':'Electrical inspection'],tools:[cleaning?'Cleaning supplies':'Insulated hand tools'],bio:'Reviewed test-directory profile with published skills and scope.',languages:['Odia','Hindi'],specialties:[cleaning?'Household cleaning':'Switchboard inspection'],experience_years:3+index,completed_tasks:index===3?0:12+index,rating:index===3?null:4.7,review_count:index===3?0:3,distribution:{1:0,2:0,3:0,4:index===3?0:1,5:index===3?0:2},reviews:index===3?[]:[{service:cleaning?'Cleaning visit':'Electrical visit',rating:5,text:'Fixture completed-task review.',at:1791200000}],category_records:[{category,completed:index===3?0:12+index,rating:index===3?null:4.7,review_count:index===3?0:3}],work_history:[],service_packages:[packages[cleaning?1:0]],home_services:cleaning?['maid']:[],available_now:false};
});
const directoryCategories=[...categories,...homeCategories].map(c=>({...c,count:profiles.filter(p=>p.categories.includes(c.id)||(p.home_services||[]).includes(c.id.replace('home:',''))).length,leader:c.id==='electrician'?{id:profiles[0].id,name:profiles[0].name,role:profiles[0].role}:c.id==='cleaning'?{id:profiles[4].id,name:profiles[4].name,role:profiles[4].role}:null}));
function filtered(body){return profiles.filter(p=>(!body.category||p.categories.includes(body.category)||(p.home_services||[]).includes(body.category.replace('home:','')))&&(!body.query||(p.name+' '+p.skills.join(' ')).toLowerCase().includes(body.query.toLowerCase()))&&(body.role==='all'||p.role===body.role));}
function recommended(p,body){
  const reference=p.service_packages[0],budget=body.budget_paise;
  return {...p,comparison:{category:body.category,category_name:categories.find(c=>c.id===body.category)?.name||'All categories',verified_work:{completed:p.completed_tasks,review_count:p.review_count,rating:p.rating,confidence:0.7},attributes:[{id:'experience',label:'Experience',value:p.experience_years,source:'reviewed_profile'},{id:'tools',label:'Tools listed',value:p.tools,source:'reviewed_profile'},{id:'languages',label:'Languages',value:p.languages,source:'professional_profile'}],catalogue_references:[{...reference,basis:'category_catalogue'}],budget_status:budget==null?'unknown':reference.price_paise<=budget?'within_catalogue_reference':'above_catalogue_reference',price_note:'Catalogue scope only. Travel, materials and tax need a written quote.',offers_note:'Only current published offers are included.',hire_readiness:{enabled:false,policy_version:'fixture-policy',day_hours:null,base_paise:null,quote_required:true,routing_ready:false,payments_ready:false}},recommendation:{score:65,score_is_probability:false,components:[{id:'work',label:'Verified category work',points:40,maximum:60,source:'completed_tasks'}],reasons:['Reviewed profile with verified completed category work'],evidence_scope:{kind:'category_completed_tasks',record_limit:100,complete:p.id!=='fixture-worker-2'}}};
}

// Substitute only the local Firebase module. The actual production recommendation
// wrapper and public cache execute, including token headers and account guards.
const authFixture=`const listeners=new Set(); const makeUser=uid=>uid?{uid,getIdToken:async()=> 'test-token:'+uid}:null;
export const auth={currentUser:makeUser('fixture-hire-account'),authStateReady:async()=>{},onIdTokenChanged(next){const callback=typeof next==='function'?next:next.next.bind(next);listeners.add(callback);queueMicrotask(()=>callback(auth.currentUser));return()=>listeners.delete(callback);}};
window.__hireFixtureAuth=uid=>{auth.currentUser=makeUser(uid);for(const callback of listeners)callback(auth.currentUser);};
export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;

const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
const errors=[],requests=[];
let activePage;
const releaseBarriers=[];
const privacyOnly=process.argv.includes('--privacy-only');
const state={failDirectory:false,failRecommendations:false,delayCategory:'',release:null,captured:null,finished:null,recommendationBarrier:null,availabilityBarrier:null,dayHireReady:false};
function holdResponse(kind,predicate){
  let capture,release,finish;const reached=new Promise(resolve=>{capture=resolve;}),wait=new Promise(resolve=>{release=resolve;}),done=new Promise(resolve=>{finish=resolve;});
  state[kind]={predicate,capture,wait,finish};releaseBarriers.push(release);
  return {reached,release,done};
}
async function fixtureRoutes(context){
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')return route.abort();
    if(url.pathname==='/@vite/client'){
      // Other agents may edit this shared workspace during an audit. Disable
      // only development websocket reloads; keep Vite's real CSS/module helpers.
      const response=await route.fetch();
      const body='class HirePreviewSocket{readyState=0;addEventListener(){};removeEventListener(){};send(){};close(){}}\n'+(await response.text()).replaceAll('new WebSocket(', 'new HirePreviewSocket(');
      return route.fulfill({response,contentType:'text/javascript',body});
    }
    if(url.pathname==='/src/firebase.ts')return route.fulfill({contentType:'text/javascript',body:authFixture});
    if(!url.pathname.startsWith('/api/'))return route.continue();
    const path=url.pathname,body=route.request().postDataJSON()||{};
    requests.push({path,body,authorization:route.request().headers().authorization});
    if(path==='/api/catalog')return route.fulfill({json:{categories,services}});
    if(path==='/api/operations/home/catalog')return route.fulfill({json:{services:homeCategories.map(c=>({id:c.id.replace('home:',''),name:c.name,description:'Published fixture Home scope',category:'cleaning'}))}});
    if(path==='/api/operations/hiring/policy')return route.fulfill({json:{version:'fixture-policy',enabled:state.dayHireReady,routing_ready:state.dayHireReady,payments_ready:false,base_paise:100000,gst_bps:1800,travel_paise_per_km:500,minimum_travel_paise:10000,day_hours:8,membership_paise:null,membership_days:30,radius_buffer_bps:1500,response_seconds:300,terms:'Fixture written day-hire scope. Review the quote before confirming.'}});
    if(path==='/api/operations/hiring/leaderboard'){
      assert.equal(body.city,'Test city');
      if(state.delayCategory&&body.category===state.delayCategory){state.captured?.();await new Promise(resolve=>{state.release=resolve;});}
      const data={professionals:filtered(body),categories:directoryCategories};
      await route.fulfill(state.failDirectory?{status:503,json:{detail:{message:'Fixture directory temporarily unavailable'}}}:{json:data});state.finished?.();return;
    }
    if(path==='/api/operations/hiring/recommendations'){
      assert.match(route.request().headers().authorization||'',/^Bearer test-token:/);
      if(state.failRecommendations)return route.fulfill({status:503,json:{detail:{message:'Fixture suggestion service temporarily unavailable'}}});
      const uid=route.request().headers().authorization.replace('Bearer test-token:','');
      const barrier=state.recommendationBarrier?.predicate({uid,body})?state.recommendationBarrier:null;
      if(barrier){state.recommendationBarrier=null;barrier.capture();await barrier.wait;}
      const eligible=filtered(body).map(p=>recommended(p,body));
      await route.fulfill({json:{personalised:true,consent_required:false,cold_start:false,generated_at:Date.now()/1000,refresh_after_seconds:20,selected_category:body.category,professionals:eligible.slice(0,6),comparisons:eligible.filter(p=>(body.compare_ids||[]).includes(p.id)),missing_compare_ids:[],categories:(uid==='fixture-hire-account'?categories.slice(0,2):categories.filter(c=>c.id==='painting')).map(c=>({...c,personalised:true,reason:'Repeated category views',last_explored_at:Date.now()/1000})),comparison_fields:[],candidate_window:{limit:100,examined:eligible.length,has_more:false,note:'Suggestions use a bounded set of reviewed category profiles.'},method:'Category review confidence and published scope. Scores order profiles; they are not match probabilities.'}});barrier?.finish();return;
    }
    if(path==='/api/operations/hiring/search'){
      const barrier=state.availabilityBarrier?.predicate({body})?state.availabilityBarrier:null;
      if(barrier){state.availabilityBarrier=null;barrier.capture();await barrier.wait;}
      await route.fulfill({json:{professionals:filtered(body)}});barrier?.finish();return;
    }
    if(path==='/api/operations/discovery/events')return route.fulfill({json:{recorded:false}});
    if(path==='/api/operations/discovery/preferences')return route.fulfill({json:{enabled:true}});
    return route.fulfill({status:404,json:{detail:'Unexpected Hire browser API request: '+path}});
  });
}
async function newPage(width=390,{dark=false,text=100,signedIn=true}={}){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce',colorScheme:dark?'dark':'light'});
  await context.addInitScript(({categories,homeCategories,dark,text,signedIn})=>{
    localStorage.setItem('repaido.hire-category-catalogue.v1',JSON.stringify({regular:categories,home:homeCategories,homeAt:Date.now(),at:Date.now()}));
    document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.fontSize=text+'%';if(!signedIn)window.__hireFixtureAuth?.('');});
  },{categories,homeCategories,dark,text,signedIn});
  await fixtureRoutes(context);
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const catalogLoaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/catalog').catch(error=>{throw new Error('Hire preview catalogue did not load: '+error.message);});
  catalogLoaded.catch(()=>{});
  await page.goto(origin+'/tests/hiring-discovery-preview.html');
  await page.getByRole('heading',{name:'Quick hire by category'}).waitFor();
  await catalogLoaded;
  await page.getByRole('button',{name:/Show all \d+ categories/}).waitFor();
  return page;
}
const categoryNav=page=>page.getByRole('navigation',{name:'Professional categories'});
const result=page=>page.locator('dialog.hire-compact-results[open]');
async function choose(page,id){const name=categories.find(c=>c.id===id)?.name||homeCategories.find(c=>c.id===id)?.name||'All categories';await categoryNav(page).getByRole('button',{name:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();await result(page).waitFor();await result(page).locator('.hire-card-grid[aria-busy="false"]').waitFor();}
async function closeResult(page){await result(page).getByRole('button',{name:'Close dialog',exact:true}).click();await result(page).waitFor({state:'hidden'});}
async function layout(page){
  return page.evaluate(()=>{
    const issues=[];
    const visible=element=>element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';
    const roots=[document.querySelector('#hire-preview'),...document.querySelectorAll('dialog[open]')].filter(visible);
    for(const root of roots){if(root.scrollWidth>root.clientWidth+1)issues.push('Horizontal overflow: '+root.className);}
    for(const element of document.querySelectorAll('.hire-category-cards button,.hire-category-copy,.hire-card,.hire-journey li,.hire-comparison-card,.hire-compact-toolbar')){
      if(!visible(element))continue;
      if(element.scrollWidth>element.clientWidth+1)issues.push('Clipped content: '+element.className+' '+element.textContent.trim().slice(0,70));
    }
    for(const element of document.querySelectorAll('.hire-category-cards button,.hire-category-cards strong,.hire-card-main h3')){
      if(!visible(element))continue;
      const style=getComputedStyle(element);if(style.textOverflow==='ellipsis'||(style.webkitLineClamp&&style.webkitLineClamp!=='none'))issues.push('Truncated primary name: '+element.textContent);
    }
    const cards=[...document.querySelectorAll('.hire-category-cards button')].filter(visible);
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
      const a=cards[i].getBoundingClientRect(),b=cards[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)issues.push('Overlapping category cards');
    }
    const surface=[...document.querySelectorAll('dialog[open]')].at(-1)||document.querySelector('#hire-preview');
    for(const control of surface.querySelectorAll('button,summary,label.hire-check')){
      if(!visible(control)||control.disabled)continue;const r=control.getBoundingClientRect();if(r.width<44||r.height<44)issues.push('Small target '+Math.round(r.width)+'×'+Math.round(r.height)+': '+(control.getAttribute('aria-label')||control.textContent.trim()).slice(0,70));
    }
    return [...new Set(issues)];
  });
}
async function audit(page,aaa=false){
  if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:require.resolve('axe-core')});
  return page.evaluate(async aaa=>{
    const root=[...document.querySelectorAll('dialog[open]')].at(-1)||document.querySelector('#hire-preview');
    const result=await window.axe.run(root,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa',...(aaa?['wcag2aaa']:[])]},rules:{'color-contrast-enhanced':{enabled:aaa}}});
    return result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
  },aaa);
}

async function privacyRegressions(){
  const page=await newPage(),recent=page.locator('.hire-recent-categories');
  await recent.getByRole('heading',{name:'Continue exploring'}).waitFor();
  await choose(page,'electrician');
  await result(page).locator('.hire-shortlist-method').waitFor();
  for(const professional of profiles.slice(0,2))await result(page).getByRole('checkbox',{name:'Compare '+professional.name}).check();
  await result(page).getByRole('button',{name:'Compare (2)',exact:true}).click();
  const comparison=page.getByRole('dialog',{name:'Compare professionals',exact:true});
  await comparison.locator('.hire-comparison-prices').first().waitFor();
  await page.evaluate(()=>window.__hireFixtureAuth('fixture-hire-account'));await page.waitForTimeout(50);
  assert.equal(await comparison.count(),1,'Same-account token refresh must preserve the comparison sheet.');
  assert.equal(await comparison.locator('.hire-comparison-prices').count(),2,'Same-account token refresh must preserve current private suggestions.');
  const delayed=holdResponse('recommendationBarrier',({uid})=>uid==='fixture-hire-account');
  await page.evaluate(()=>window.dispatchEvent(new Event('repaido:interests')));await delayed.reached;
  await page.evaluate(()=>window.__hireFixtureAuth('fixture-second-account'));
  await comparison.waitFor({state:'hidden'});
  await recent.locator('button').filter({hasText:/^Painting$/}).waitFor();
  delayed.release();await delayed.done;await page.waitForTimeout(100);
  assert.equal(await recent.locator('button').filter({hasText:categories[0].name}).count(),0,'A late old-account recommendation cannot restore old private interests.');
  assert.equal(await recent.locator('button').filter({hasText:/^Painting$/}).count(),1);
  assert.equal(await result(page).locator('.hire-decision-card').count(),4,'Public directory profiles remain available after account changes.');
  await result(page).locator('.hire-card-actions').first().getByRole('button',{name:'View profile',exact:false}).click();
  const profile=page.getByRole('dialog',{name:profiles[0].name,exact:true});await profile.waitFor();
  await page.evaluate(()=>window.__hireFixtureAuth('fixture-second-account'));await page.waitForTimeout(50);assert.equal(await profile.count(),1,'Same-account token refresh must preserve the profile.');
  await page.evaluate(()=>window.__hireFixtureAuth(''));await profile.waitFor({state:'hidden'});await recent.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('dialog',{name:'Compare professionals',exact:true}).count(),0);
  await page.evaluate(()=>window.__hireFixtureAuth('fixture-third-account'));await recent.waitFor();

  state.dayHireReady=true;await closeResult(page);await choose(page,'electrician');
  await result(page).locator('.hire-card-actions').first().getByRole('button',{name:'View profile',exact:false}).click();
  await profile.getByRole('button',{name:'Check availability & request day hire',exact:true}).click();
  const location=page.getByRole('dialog',{name:'Where do you need help?',exact:true});await location.waitFor();
  await page.evaluate(()=>window.__hireFixtureAuth(''));await profile.waitFor({state:'hidden'});await location.waitFor({state:'hidden'});
  await page.evaluate(()=>window.__hireFixtureAuth('fixture-third-account'));
  await result(page).locator('.hire-card-actions').first().getByRole('button',{name:'View profile',exact:false}).click();
  await profile.getByRole('button',{name:'Check availability & request day hire',exact:true}).click();
  await location.getByLabel('Latitude',{exact:true}).fill('21.50');
  const availability=holdResponse('availabilityBarrier',()=>true);
  await location.getByRole('button',{name:'Confirm this location',exact:true}).click();await availability.reached;
  await page.evaluate(()=>window.__hireFixtureAuth(''));await profile.waitFor({state:'hidden'});
  availability.release();await availability.done;await page.waitForTimeout(100);
  const booking=page.getByRole('dialog',{name:'Hire '+profiles[0].name,exact:true});
  assert.equal(await booking.count(),0,'A late availability response must not reopen the previous account’s booking sheet.');

  await page.evaluate(()=>window.__hireFixtureAuth('fixture-third-account'));
  await result(page).locator('.hire-card-actions').first().getByRole('button',{name:'View profile',exact:false}).click();
  await profile.getByRole('button',{name:'Check availability & request day hire',exact:true}).click();await booking.waitFor();
  await page.evaluate(()=>window.__hireFixtureAuth('fixture-third-account'));await page.waitForTimeout(50);assert.equal(await booking.count(),1,'Same-account token refresh must preserve the booking sheet.');
  await page.evaluate(()=>window.__hireFixtureAuth('fixture-fourth-account'));await booking.waitFor({state:'hidden'});
  assert.equal(requests.filter(r=>r.path==='/api/operations/hiring/requests').length,0,'Privacy checks must not send a real day-hire request.');
  state.dayHireReady=false;await page.context().close();
  console.log('Hire same-account refresh, new-account/signout privacy, and late recommendation/availability checks passed.');
}

let success=false;
try{
  await mkdir(artifacts,{recursive:true});
  if(!privacyOnly){
  const page=await newPage();
  assert.equal(requests.filter(r=>r.path.endsWith('/hiring/leaderboard')).length,0,'The directory must open only after an explicit category/search.');
  assert.equal(await page.locator('[aria-roledescription="carousel"]').count(),0,'Hire must not auto-rotate professional carousels.');
  await choose(page,'electrician');
  assert.equal(await result(page).locator('.hire-decision-card').count(),4);
  assert.equal(await result(page).getByRole('heading',{name:profiles[4].name}).count(),0);
  await result(page).getByRole('region',{name:'Category leaders'}).getByText(profiles[0].name,{exact:true}).waitFor();
  for(const p of profiles.slice(0,3))await result(page).getByRole('checkbox',{name:'Compare '+p.name}).check();
  assert.equal(await result(page).getByRole('checkbox',{name:'Compare '+profiles[3].name}).isDisabled(),true);
  await result(page).getByRole('button',{name:'Compare (3)',exact:true}).click();
  const compare=page.getByRole('dialog',{name:'Compare professionals',exact:true});await compare.waitFor();
  await compare.getByLabel('Reference budget (₹)',{exact:true}).fill('800');
  await compare.getByText('Catalogue references within your budget',{exact:true}).first().waitFor();
  assert.equal(await compare.locator('.hire-comparison-card').count(),3);
  assert.equal(await compare.getByText(packages[0].name,{exact:true}).count(),3);
  await compare.getByText('Work evidence is a limited sample, rather than a complete history.',{exact:true}).waitFor();
  await compare.getByRole('button',{name:'Remove '+profiles[2].name+' from comparison'}).click();assert.equal(await compare.locator('.hire-comparison-card').count(),2);
  await compare.getByRole('button',{name:'Close dialog',exact:true}).click();
  await result(page).locator('.hire-scope-planner').getByText('Scope & budget guide',{exact:false}).click();
  await result(page).locator('.hire-catalogue-references').getByText(packages[0].name,{exact:true}).click();
  await result(page).getByText('Excluded: Parts, Travel, Additional work.',{exact:true}).waitFor();
  await result(page).getByRole('button',{name:'Review this service booking'}).click();
  assert.equal(await page.getByLabel('Last Hire action').textContent(),'service:fixture-electrical');
  await choose(page,'electrician');
  state.failDirectory=true;state.failRecommendations=true;
  await result(page).getByRole('button',{name:'Refresh professional directory'}).click();
  await result(page).getByText('Fixture directory temporarily unavailable',{exact:true}).waitFor();
  assert.equal(await result(page).locator('.hire-decision-card').count(),4,'A failed refresh must preserve cached public profiles.');
  await result(page).getByText('Suggestions could not refresh. The directory below is still available.',{exact:true}).waitFor();
  state.failDirectory=false;state.failRecommendations=false;await result(page).getByRole('button',{name:'Retry profiles',exact:true}).click();
  await result(page).locator('.hire-card-grid[aria-busy="false"]').waitFor();assert.equal(await result(page).locator('.hire-decision-card').count(),4);
  await closeResult(page);
  let captured,finished;const reached=new Promise(resolve=>{captured=resolve;}),done=new Promise(resolve=>{finished=resolve;});state.delayCategory='cleaning';state.captured=captured;state.finished=finished;
  await categoryNav(page).getByRole('button',{name:/^Home cleaning and household help/}).click();await reached;
  await closeResult(page);await choose(page,'electrician');state.delayCategory='';state.release();await done;await page.waitForTimeout(150);
  assert.equal(await result(page).getAttribute('aria-label'),categories[0].name);assert.equal(await result(page).locator('.hire-decision-card').count(),4,'A late category read cannot replace the current directory.');assert.equal(await result(page).getByRole('heading',{name:profiles[4].name}).count(),0);
  state.captured=null;state.finished=null;state.release=null;
  await closeResult(page);await choose(page,'cleaning');assert.equal(await result(page).locator('.hire-decision-card').count(),1);await closeResult(page);
  await page.getByRole('button',{name:/Show all \d+ categories/}).click();assert.equal(await categoryNav(page).getByRole('button').count(),15);
  await choose(page,'home:maid');assert.equal(await result(page).locator('.hire-decision-card').count(),1);await result(page).getByRole('button',{name:'View profile',exact:false}).click();
  const profile=page.getByRole('dialog',{name:profiles[4].name,exact:true});await profile.waitFor();await profile.getByRole('button',{name:'Request Maid & daily home help scope'}).click();assert.equal(await page.getByLabel('Last Hire action').textContent(),'home:maid:fixture-worker-4');
  console.log('Hire category selection, 3-way comparison, budget scope, native handoff, cached errors and stale race passed.');
  await page.context().close();

  const failures=[];
  for(const width of [320,390,499])for(const text of [100,200])for(const dark of [false,true]){
    const p=await newPage(width,{text,dark});
    const initialIssues=await layout(p),initialAudit=await audit(p,true);
    if(width===390&&text===100)await p.screenshot({path:resolve(artifacts,'hire-categories-'+(dark?'dark':'phone')+'.png'),fullPage:true});
    await choose(p,'electrician');
    const resultIssues=await layout(p),resultAudit=await audit(p,true);
    const motion=await p.evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animated:[...document.querySelectorAll('.hire-category-cards button,.hire-card,.hire-shortlist button')].some(e=>{const s=getComputedStyle(e);return s.animationName!=='none'&&parseFloat(s.animationDuration)>0;})}));assert.deepEqual(motion,{reduced:true,animated:false});
    if(width===390&&text===100)await p.screenshot({path:resolve(artifacts,'hire-discovery-'+(dark?'dark':'phone')+'.png')});
    await result(p).getByRole('checkbox',{name:'Compare '+profiles[0].name}).check();await result(p).getByRole('checkbox',{name:'Compare '+profiles[1].name}).check();
    await result(p).getByRole('button',{name:'Compare (2)',exact:true}).click();
    const compareDialog=p.getByRole('dialog',{name:'Compare professionals',exact:true});
    await compareDialog.getByLabel('Reference budget (₹)',{exact:true}).fill('400');
    await compareDialog.getByText('Catalogue references exceed your budget',{exact:true}).first().waitFor();
    const compareIssues=await layout(p),compareAudit=await audit(p,true);
    if(width===390&&text===100)await p.screenshot({path:resolve(artifacts,'hire-compare-'+(dark?'dark':'phone')+'.png')});
    await compareDialog.getByRole('button',{name:'Close dialog',exact:true}).click();
    await result(p).locator('.hire-card-actions').first().getByRole('button',{name:'View profile',exact:false}).click();
    const profileDialog=p.getByRole('dialog',{name:profiles[0].name,exact:true});
    await profileDialog.getByRole('heading',{name:profiles[0].name,exact:true}).first().waitFor();
    const profileIssues=await layout(p),profileAudit=await audit(p,true);
    await profileDialog.getByRole('button',{name:'Close dialog',exact:true}).click();
    await result(p).getByRole('button',{name:'Filters and sort',exact:true}).click();
    const filterIssues=await layout(p),filterAudit=await audit(p,true);
    await p.getByRole('dialog',{name:'Find your professional',exact:true}).getByRole('button',{name:'Show matching profiles',exact:true}).click();
    if([initialIssues,resultIssues,compareIssues,profileIssues,filterIssues,initialAudit,resultAudit,compareAudit,profileAudit,filterAudit].some(items=>items.length))failures.push({width,text,dark,initialIssues,resultIssues,compareIssues,profileIssues,filterIssues,initialAudit,resultAudit,compareAudit,profileAudit,filterAudit});
    await p.context().close();
    console.log('Checked Hire phone',JSON.stringify({width,text,dark}));
  }
  await import('node:fs/promises').then(fs=>fs.writeFile(resolve(artifacts,'hire-discovery-accessibility.json'),JSON.stringify(failures,null,2)));
  assert.equal(failures.length,0,'Hire layout and AAA accessibility findings: '+JSON.stringify(failures.map(({width,text,dark})=>({width,text,dark})))+'. Full selectors are in test-results/hire-discovery-accessibility.json.');
  }
  await privacyRegressions();
  assert.deepEqual(errors,[],'Unexpected runtime errors');
  success=true;console.log(privacyOnly?'Hire privacy browser checks passed.':'Hire discovery browser checks passed.');
}finally{
  state.release?.();for(const release of releaseBarriers)release();if(!success&&activePage&&!activePage.isClosed()){await activePage.screenshot({path:resolve(artifacts,'hire-discovery-failure.png')}).catch(()=>{});console.error('Open dialogs at failure:',await activePage.locator('dialog[open]').evaluateAll(dialogs=>dialogs.map(dialog=>dialog.getAttribute('aria-label'))).catch(()=>[]));}await browser.close();if(!success)console.error('Hire checks failed; see web/test-results/hire-discovery-accessibility.json if produced.');
}
