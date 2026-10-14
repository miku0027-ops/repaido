import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.MARKET_PREVIEW_ORIGIN||'http://127.0.0.1:5186',web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(web,'test-results/market'),now=Math.floor(Date.now()/1000);
const errors=[],requests=[],checks=[],pin={lat:21.4934,lng:86.9135};
await mkdir(out,{recursive:true});
const product={id:'fixture-part',shop_id:'fixture-shop',name:'Brass tap cartridge',sku:'TAP-22',category:'plumbing',price_paise:22000,mrp_paise:26000,stock:12,image_url:'/images/icon-plumbing.png',brand:'Fixture',condition:'new',gst_bps:1800,stock_confirmed_at:now};
const wholesale={id:'fixture-bulk',shop_id:'fixture-shop',shop_name:'Fixture supplies',city:'Balasore',title:'Brass tap cartridges · box of 20',category:'plumbing',part_number:'TAP-22',unit:'Pieces',moq:20,stock:200,base_price_paise:18500,bulk_slabs:[],lead_time_days:2,image:'/images/icon-plumbing.png',specifications:{Material:'Brass'},status:'active',created_at:now,updated_at:now,version:1};
const tender={id:'fixture-tender',title:'Electrical maintenance for a local office',city:'Balasore',sector:'Electrical',status:'open',phase:'bidding',scope:'Inspect and maintain the lighting and electrical fittings.',budget_paise:8500000,manpower_needed:3,bids_count:2,opens_at:now-86400,deadline:now+86400*3,starts_at:now+86400*7,ends_at:now+86400*30,terms:'Customer reviews the work before confirming completion.'};
const departure={id:'fixture-shared',vehicle_kind:'car',origin_address:'Station Road',destination_address:'City Market',vehicle_name:'Swift',owner_name:'Fixture driver',starts_at:now+3600,available_seats:3,distance_metres:700,price_paise:10000};
const vehicle={id:'fixture-car',name:'City cab · Swift',owner_name:'Fixture cars',seats:4,transmission:'Manual',fuel:'Petrol',offered_modes:['cab','rental'],distance_metres:900,base_paise:10000,per_km_paise:1800,daily_paise:200000};
const captain={qualifying_points:85,lifetime_points:140,ranking_points:140,verified_cleanups:14,gold:false,gold_until:null,server_time:now,cash_received_paise:50000,cash_pending_paise:0,profile:{name:'Fixture customer',photo_id:null,public:true,city:'Balasore',version:1},offers:[],factors:[],awards:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(url,request){
 const path=url.pathname.replace(/^\/api/,'');
 if(path==='/operations/products/catalog')return {items:[product],shops:[{id:'fixture-shop',name:'Fixture supplies',city:'Balasore',address:'Station Road',location:pin}]};
 if(path==='/operations/b2b/policy')return {payments_ready:false,acceptance_note:'A quotation does not collect payment or reserve stock.'};
 if(path==='/operations/b2b/listings'){const query=url.searchParams.get('search')?.toLowerCase()||'',category=url.searchParams.get('category');return {listings:(!query||wholesale.title.toLowerCase().includes(query))&&(!category||category===wholesale.category)?[wholesale]:[],next_cursor:null};}
 if(path==='/operations/b2b/rfq')return {rfqs:[],next_cursor:null};
 if(path==='/operations/contractor/overview')return {contracts:[],leaders:[]};
 if(path==='/operations/contractor/sectors')return {sectors:[]};
 if(path==='/operations/contractor/opportunities')return {status:403,body:{detail:{message:'Fixture customer has no contractor access.'}}};
 if(path==='/operations/contractor/published'){const query=url.searchParams.get('query')||url.searchParams.get('q')||'',sector=url.searchParams.get('sector');const rows=(!query||tender.title.toLowerCase().includes(query.toLowerCase()))&&(!sector||sector==='Electrical')?[tender]:[];return {tenders:rows,total:rows.length,has_more:false,next_cursor:null,server_time:now};}
 if(path.startsWith('/operations/contractor/published/'))return {tender};
 if(path==='/operations/local-business/transport/nearby')return {departures:[departure],vehicles:[vehicle],radius_km:20};
 if(path==='/operations/local-business/policy')return {routing_ready:true,payments_ready:false,radius_km:8,minimum_total_paise:50000,advance_paise:50000,advance_credited:true};
 if(path==='/operations/local-business/rides')return {rides:[]};
 if(path==='/operations/local-business/scrap')return {collections:[]};
 if(path==='/operations/local-business/cleanup/reports')return {reports:[],summary:{verified_reports:0},server_time:now};
 if(path==='/operations/local-business/captain/me')return captain;
 if(path==='/operations/local-business/captain/leaderboard')return {city:'Balasore',entries:[],my_rank:null};
 if(path==='/operations/rentals/listings')return {listings:[]};
 if(path==='/operations/market/search')return {items:[]};
 if(path==='/operations/cart')return {items:[]};
 return {status:404,body:{detail:{message:'Unconfigured fixture route: '+path}}};
}
async function geometry(page){
 const result=await page.locator('.market-workspace').evaluate(root=>{
  const nav=root.querySelector('.market-destinations'),panel=root.querySelector('.market-destination-panel'),box=root.getBoundingClientRect();
  return {width:innerWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth+1,navOverflow:nav.scrollWidth>nav.clientWidth+1,navButtons:[...nav.querySelectorAll('button')].map(button=>({name:button.getAttribute('aria-label'),left:button.getBoundingClientRect().left,right:button.getBoundingClientRect().right,selected:button.getAttribute('aria-selected')})),small:[...panel.querySelectorAll('button,summary')].filter(button=>button.getClientRects().length&&getComputedStyle(button).visibility!=='hidden').filter(button=>button.getBoundingClientRect().height<43||button.getBoundingClientRect().width<43).map(button=>({label:button.textContent.trim(),class:button.className,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})),panelLeft:panel.getBoundingClientRect().left-root.getBoundingClientRect().left,panelRight:root.getBoundingClientRect().right-panel.getBoundingClientRect().right,outside:[...root.querySelectorAll('*')].filter(e=>e.getClientRects().length&&!e.closest('svg,dialog,[hidden],[aria-hidden=true]')&&!e.closest('.spare-category-rail,.b2b-category-rail,.tender-sector-rail,.transport-card-rail')).filter(e=>e.getBoundingClientRect().left<box.left-1||e.getBoundingClientRect().right>box.right+1).map(e=>({class:e.className,tag:e.tagName})).slice(0,12)};
 });
 assert.equal(result.documentOverflow,false,JSON.stringify(result));assert.equal(result.navOverflow,false,JSON.stringify(result));assert.equal(result.navButtons.length,5);assert.deepEqual(result.small,[],JSON.stringify(result));assert.deepEqual(result.outside,[],JSON.stringify(result));assert.ok(result.panelLeft>=9&&result.panelRight>=9,JSON.stringify(result));
}
async function audit(page){
 const result=await page.evaluate(()=>window.axe.run(document.querySelector('.market-workspace'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}}));
 assert.ok(result.passes.some(rule=>rule.id==='color-contrast-enhanced')||result.violations.some(rule=>rule.id==='color-contrast-enhanced'),'The enhanced contrast check must actually run.');
 if(result.violations.length)await writeFile(resolve(out,'axe-failures.json'),JSON.stringify(result.violations,null,2));
 assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
}
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:471,height:850},timezoneId:'Asia/Kolkata'});
 await context.routeWebSocket('**',socket=>socket.close());
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname,method:request.method()});const value=fixture(url,request);await route.fulfill({status:value.status||200,contentType:'application/json',body:JSON.stringify(value.body||value)});});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.stack||error.message));page.setDefaultTimeout(15000);
 await page.goto(origin+'/tests/market-compact-preview.html');await page.locator('.spare-compact-card').first().waitFor();await page.addScriptTag({path:require.resolve('axe-core')});
 const navigation=page.getByRole('tablist',{name:'Marketplace destination',exact:true});
 for(const name of ['Marketplace','B2B Wholesale','Contracts','Cabs & cars','Sell scrap']){
  await navigation.getByRole('tab',{name,exact:true}).click();await pause(700);
  for(const width of [320,471,768,1280]){await page.setViewportSize({width,height:850});await geometry(page);if(width===471)await page.screenshot({path:resolve(out,name.replaceAll(/[^\w]+/g,'-').toLowerCase()+'.png')});}
  await page.setViewportSize({width:471,height:850});await audit(page);checks.push(name+' layouts and accessible controls');
 }
 await navigation.getByRole('tab',{name:'Marketplace',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.getByRole('tab',{name:'B2B Wholesale',exact:true}).waitFor();assert.equal(await navigation.getByRole('tab',{name:'B2B Wholesale',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await navigation.getByRole('tab',{name:'Sell scrap',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await navigation.getByRole('tab',{name:'Marketplace',exact:true}).getAttribute('aria-selected'),'true');checks.push('keyboard destination navigation');
 await pause(500);assert.equal(await page.locator('.opportunity-carousel').count(),0);await page.locator('.market-highlights>summary').click();await page.locator('.opportunity-carousel').waitFor();await page.locator('.market-highlights>summary').click();await page.locator('.opportunity-carousel').waitFor({state:'detached'});checks.push('highlights mount only when expanded');
 await navigation.getByRole('tab',{name:'B2B Wholesale',exact:true}).click();await page.locator('.b2b-product-card').waitFor();await page.getByLabel('Search wholesale listings',{exact:true}).fill('no-match');await page.getByText('No matching wholesale listings',{exact:true}).waitFor();await audit(page);await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.locator('.b2b-product-card').waitFor();await page.getByRole('button',{name:'Request quotation',exact:true}).first().click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');checks.push('wholesale search, empty state, clear filters and quotation entry');
 await navigation.getByRole('tab',{name:'Contracts',exact:true}).click();await pause(500);await page.locator('.tender-tools>summary').click();await page.getByRole('button',{name:'Bid planner',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');checks.push('contract tools disclosure and bid planner');
 await navigation.getByRole('tab',{name:'Cabs & cars',exact:true}).click();await pause(500);
 const before=requests.filter(r=>r.path==='/api/operations/local-business/rides').length;assert.equal(before,0,'Closed booking history must not fetch records.');
 for(const name of ['Shared ride','Self-drive','Cab rental','Cab']){await page.getByRole('button',{name,exact:true}).click();await pause(350);await geometry(page);await audit(page);}
 await page.locator('.mobility-booking-history>summary').click();await page.getByText('No active rides yet.',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.path==='/api/operations/local-business/rides').length,1);checks.push('four transport modes and lazy booking history');
 await navigation.getByRole('tab',{name:'Sell scrap',exact:true}).click();await page.getByRole('button',{name:'Report litter',exact:true}).click();await pause(400);await geometry(page);await audit(page);await page.getByRole('button',{name:'My rewards',exact:true}).click();await page.locator('.captain-pass').waitFor();await geometry(page);await audit(page);checks.push('scrap reports and reward panels');
 await navigation.getByRole('tab',{name:'Cabs & cars',exact:true}).click();await pause(500);await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.market-destination-panel').evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.getByRole('button',{name:/^Change transport pickup area/}).click();const picker=page.getByRole('dialog',{name:'Your pickup area',exact:true});await picker.getByRole('region',{name:'Service location map',exact:true}).waitFor();
 const zoom=picker.locator('.leaflet-control-zoom-in');await zoom.click();assert.notEqual(await picker.locator('.leaflet-marker-icon').first().evaluate(e=>getComputedStyle(e).transform),'none','Reduced motion must preserve the map marker transform.');
 await picker.getByLabel('House, street and landmark',{exact:true}).fill('Fixture pickup square, Balasore');await picker.getByLabel('I have checked that this pin marks my service entrance.').check();await picker.getByRole('button',{name:'Confirm this location',exact:true}).click();await page.getByRole('button',{name:'Change transport pickup area: Fixture pickup square, Balasore',exact:true}).waitFor();checks.push('pickup selection and reduced-motion map operation');
 for(const name of ['Marketplace','B2B Wholesale','Contracts','Cabs & cars','Sell scrap']){
  await navigation.getByRole('tab',{name,exact:true}).click();await pause(500);await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await page.setViewportSize({width:320,height:850});await geometry(page);
  await page.evaluate(()=>{document.documentElement.style.fontSize='';document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark');});await page.setViewportSize({width:471,height:850});await geometry(page);await audit(page);await page.screenshot({path:resolve(out,'dark-'+name.replaceAll(/[^\w]+/g,'-').toLowerCase()+'.png')});
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.classList.remove('dark');});
 }
 checks.push('all five destinations with 200% text and dark theme');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,requests:requests.length}));
}finally{await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify({checks,errors,requests},null,2));}
