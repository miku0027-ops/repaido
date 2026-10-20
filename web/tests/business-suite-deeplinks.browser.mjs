import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

// Real suite components and /worker URLs; only identity and HTTP data use the
// existing isolated preview. This verifies routing, not backend authorization.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.BUSINESS_SUITE_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const work=await mkdtemp(resolve(tmpdir(),'repaido-suite-deeplinks-')),checks=[],errors=[],requests=[];
const now=()=>Date.now()/1000;
let browser;
try{
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:465,height:850},reducedMotion:'reduce'});
  await context.route('https://**/*',route=>route.abort('blockedbyclient'));
  await context.route('**/@vite/client',async route=>{const response=await route.fetch();await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(')});});
  await context.route(url=>url.origin===origin&&url.pathname==='/worker',async route=>{
    // Keep the real /worker path and its query while Vite provides its required
    // React refresh preamble for the existing test entry point.
    const response=await route.fetch({url:origin+'/tests/business-suites-preview.html'});await route.fulfill({response});
  });
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname+url.search,method:request.method()});
    let status=200,body;
    if(url.pathname==='/api/operations/local-business/partner')body={partner:{id:'worker',role:url.searchParams.get('role'),status:'approved',valid_until:now()+86400,name:'Deep-link fixture',city:'Balasore',address:'Fixture office entrance',location:{lat:21.4934,lng:86.9135}},vehicles:[]};
    else if(url.pathname==='/api/operations/local-business/rides')body={rides:[]};
    else if(url.pathname==='/api/operations/local-business/shared')body={departures:[]};
    else if(url.pathname==='/api/operations/local-business/driver-invitations')body={invitations:[]};
    else if(url.pathname==='/api/operations/local-business/transport/public-availability')body={vehicles:[],server_time:now(),position_ttl_seconds:75,session_duration_seconds:3600,approximation_metres:200};
    else if(url.pathname==='/api/operations/bike-rides/driver/availability')body={availability:null,vehicles:[],dispatch_ready:true,service_ready:true,rider_approved:false,server_time:now()};
    else if(url.pathname==='/api/operations/bike-rides/driver/rides')body={rides:[],next_cursor:null,server_time:now()};
    else if(url.pathname==='/api/operations/bike-rides/driver/payroll')body={rostered:false,approved:false,obligations:[],server_time:now()};
    else{status=404;body={detail:{message:'No deep-link fixture endpoint'}};}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  async function open(role,query,panel,heading){
    const params=new URLSearchParams({mode:role,uid:'worker',...query});await page.goto(origin+'/worker?'+params);await page.locator('.suite-workspace[data-panel="'+panel+'"]').waitFor();assert.equal(await page.locator('.suite-panel-title').textContent(),heading);return page;
  }
  await open('cab_owner',{tab:'fleet'},'fleet','Fleet & rates');await page.getByRole('button',{name:'Add vehicle',exact:true}).click();await page.getByRole('dialog',{name:'Vehicle & owner tariffs',exact:true}).waitFor();await page.getByLabel('Vehicle name / model',{exact:true}).fill('Deep-link bike');await page.getByRole('combobox',{name:'Vehicle kind',exact:true}).selectOption('bike');await page.getByRole('dialog',{name:'Bike & ride services',exact:true}).waitFor();await page.keyboard.press('Escape');await page.screenshot({path:work+'/owner-fleet.png'});
  checks.push('cab_owner tab=fleet opens the actual Fleet & rates panel with the usable bike vehicle editor');
  await open('driver',{tab:'vehicles'},'vehicles','Vehicle assignments');await page.getByRole('heading',{name:'Vehicle assignments',exact:true}).waitFor();await page.getByText('No vehicle invitations yet.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Add vehicle',exact:true}).count(),0);await page.screenshot({path:work+'/driver-assignments.png'});
  checks.push('driver tab=vehicles opens Vehicle assignments without owner fleet controls');
  const valid={cab_owner:{overview:'Overview',bikes:'Bike rides',shared:'Shared rides',cabs:'Cab bookings',rentals:'Self-drive',schedule:'Schedule',payments:'Payments',account:'Account',more:'More'},driver:{overview:'Today',journeys:'Cab journeys',bikes:'Bike rides',shared:'Shared journeys',account:'Account'}};
  for(const [role,tabs] of Object.entries(valid))for(const [tab,heading] of Object.entries(tabs))await open(role,{tab},tab,heading);
  checks.push('every other allowlisted owner and driver tab opens its real role-specific panel');
  for(const [role,tab,heading] of [['cab_owner','vehicles','Overview'],['driver','fleet','Today'],['driver','payments','Today'],['cab_owner','not-a-panel','Overview'],['driver','__proto__','Today']])await open(role,{tab},'overview',heading);
  checks.push('cross-role and unknown tabs safely open overview instead of a blank or unintended panel');
  for(const role of ['cab_owner','driver']){
    await open(role,{tab:role==='cab_owner'?'fleet':'vehicles','bike-ride':'exact-bike-record'},'bikes','Bike rides');
    await open(role,{tab:'bikes','shared-ride':'exact-shared-record'},'shared',role==='cab_owner'?'Shared rides':'Shared journeys');
    await open(role,{tab:'account','bike-ride':'exact-bike-record','shared-ride':'exact-shared-record'},'bikes','Bike rides');
  }
  checks.push('explicit bike and shared ride IDs beat generic tabs for both roles; bike IDs retain priority when both ride IDs are present');
  for(const role of ['cab_owner','driver'])for(const theme of ['light','dark']){
    await page.setViewportSize({width:320,height:850});await open(role,{tab:'shared'},'shared',role==='cab_owner'?'Shared rides':'Shared journeys');await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize='200%';},theme);
    // Re-enter at enlarged text so the real suite selects and reveals its tab.
    await open(role,{tab:'shared'},'shared',role==='cab_owner'?'Shared rides':'Shared journeys');await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize='200%';},theme);await page.getByRole('navigation',{name:'Booking types'}).getByRole('button',{name:role==='cab_owner'?'Cab bookings':'Cab journeys',exact:true}).click();
    const navigation=page.getByRole('navigation',{name:'Booking types'});for(const label of role==='cab_owner'?['Shared rides','Self-drive','Bike rides','Cab bookings']:['Shared journeys','Cab journeys']){await navigation.getByRole('button',{name:label,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'booking rail must not overflow the page');assert(await navigation.evaluate(rail=>{const active=rail.querySelector('[aria-current=page]'),box=rail.getBoundingClientRect(),item=active.getBoundingClientRect();return item.left>=box.left-1&&item.right<=box.right+1;}),'selected booking type must remain visible');for(const tab of await navigation.locator('button').all())assert(await tab.evaluate(button=>{const range=document.createRange();range.selectNodeContents(button);return new Set(Array.from(range.getClientRects()).map(rect=>Math.round(rect.y))).size===1;}),'booking type words must stay on one readable line');}
    await page.screenshot({path:work+'/'+role+'-booking-rail-320-200-'+theme+'.png',fullPage:true});
  }
  checks.push('owner and driver booking-type rails keep whole labels and the selected tab visible at320px/200% in both themes, with every destination actionable and no page overflow');
  for(const role of ['cab_owner','driver'])for(const theme of ['light','dark']){
    await page.setViewportSize({width:320,height:850});await open(role,{tab:'overview'},'overview',role==='cab_owner'?'Overview':'Today');await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize='100%';},theme);const dock=page.getByRole('navigation',{name:role==='cab_owner'?'Cab owner suite navigation':'Driver suite navigation',exact:true});
    assert(await dock.evaluate(rail=>rail.scrollWidth<=rail.clientWidth+1),'all five dock destinations fit at normal320px');for(const button of await dock.locator('button').all())assert(await button.evaluate(element=>{const box=element.getBoundingClientRect(),rail=element.parentElement.getBoundingClientRect();return box.width>=43&&box.height>=43&&box.left>=rail.left-1&&box.right<=rail.right+1&&document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===element;}),'normal-size dock targets fit, remain unobscured and meet44px touch sizes');
    await page.screenshot({path:work+'/'+role+'-dock-320-normal-'+theme+'.png'});await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'enlarged dock must not overflow the page');
    for(const label of await dock.locator('button>span').all())assert(await label.evaluate(element=>{const node=element.firstChild;if(!node||node.nodeType!==Node.TEXT_NODE)return false;for(const match of node.textContent.matchAll(/\S+/g)){const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);if(new Set(Array.from(range.getClientRects()).map(rect=>Math.round(rect.y))).size!==1)return false;}return true;}),'dock labels may wrap between words, never within a word');
    const destinations=role==='cab_owner'?[['Home','overview'],['Bookings','cabs'],['Fleet','fleet'],['Schedule','schedule'],['More','more']]:[['Today','overview'],['Cab rides','journeys'],['Bike rides','bikes'],['Vehicles','vehicles'],['Account','account']];
    await dock.getByRole('button',{name:destinations[0][0],exact:true}).focus();for(let index=0;index<destinations.length;index++){assert(await dock.getByRole('button',{name:destinations[index][0],exact:true}).evaluate(element=>document.activeElement===element),'each dock destination is reachable in keyboard Tab order');if(index<destinations.length-1)await page.keyboard.press('Tab');}
    for(const [name,panel] of destinations){const button=dock.getByRole('button',{name,exact:true});await button.focus();await page.keyboard.press('Enter');await page.locator('.suite-workspace[data-panel="'+panel+'"]').waitFor();await page.waitForFunction(()=>{const rail=document.querySelector('.suite-workspace .suite-navigation'),active=rail?.querySelector('[aria-current=page]');if(!rail||!active)return false;const bounds=rail.getBoundingClientRect(),item=active.getBoundingClientRect();return item.left>=bounds.left-1&&item.right<=bounds.right+1;});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'every keyboard dock transition remains contained');}
    await page.screenshot({path:work+'/'+role+'-dock-320-200-'+theme+'.png',fullPage:true});
  }
  checks.push('normal320px fits five44px dock targets; at200% both roles/themes preserve whole words, every destination is keyboard reachable/actionable and each current destination stays visible without page overflow');
  assert.equal(requests.some(request=>!['GET','HEAD'].includes(request.method)),false,'following setup links must not submit or start a ride');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);process.exitCode=1;}
finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors,requests},null,2));await browser?.close();console.log('Evidence: '+work);}
