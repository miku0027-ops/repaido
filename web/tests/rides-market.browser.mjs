import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.RIDES_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Local preview only');
const work=await mkdtemp('/tmp/repaido-rides-market-'),requests=[],errors=[],checks=[],variants=[],layoutIssues=[];
let browser;
const policy={enabled:true,bookings_available:true,promo_enabled:true,promo_ready:true,paid_ready:true,routing_ready:true,service_radius_metres:4000,free_distance_metres:2000,weekly_free_limit:3,version:1};
const now=()=>Date.now()/1000,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const vehicle={id:'market-fixture-car',name:'Swift',owner_name:'Fixture cars',seats:4,transmission:'Manual',fuel:'Petrol',offered_modes:['cab','rental'],distance_metres:900,base_paise:10000,per_km_paise:1800,daily_paise:200000};
const departure={id:'market-fixture-shared',vehicle_kind:'car',origin:{lat:21.4934,lng:86.9235},origin_address:'Station Road',destination_address:'City Market',vehicle_name:'Swift',owner_name:'Fixture driver',starts_at:now()+3600,available_seats:3,distance_metres:700,price_paise:10000};
function fixture(path){
 if(path==='/operations/bike-rides/policy')return policy;
 if(path==='/operations/bike-rides/bookings')return {rides:[]};
 if(path==='/operations/local-business/transport/nearby')return {departures:[departure],vehicles:[vehicle],radius_km:20,vehicle_radius_km:8};
 if(path==='/operations/local-business/transport/available-cabs')return {server_time:now(),available_cabs:[]};
 if(path==='/operations/local-business/policy')return {routing_ready:true,payments_ready:false,radius_km:8,minimum_total_paise:50000,advance_paise:50000,advance_credited:true};
 if(path==='/operations/local-business/rides')return {rides:[]};
 if(path==='/operations/local-business/shared/bookings')return {departures:[],bookings:[]};
 if(path==='/operations/products/catalog')return {items:[],shops:[]};
 return {};
}
async function setVariant(page,width,scale,theme){
 await page.setViewportSize({width,height:850});
 await page.evaluate(({scale,theme})=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},{scale,theme});
 await pause(80);
}
async function inspect(page,mode,variant){
 const scope=page.locator('.rides-workspace');
 const result=await scope.evaluate(root=>{
  const pageY=scrollY,panel=root.getBoundingClientRect(),issues=[],rail=root.querySelector('.mobility-mode-switch');
  const navScroll=rail.scrollLeft;
  for(const button of rail.querySelectorAll('button')){
   button.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
   const b=button.getBoundingClientRect(),r=rail.getBoundingClientRect();
   if(b.x<r.x-1||b.right>r.right+1)issues.push('Mode cannot be reached: '+button.textContent.trim());
   if(b.width<43||b.height<43)issues.push('Small mode target: '+button.textContent.trim());
  }
  rail.scrollLeft=navScroll;
  scrollTo(0,pageY);
  const constrained=root.querySelectorAll('.mobility-heading,.mobility-mode-switch button,.mobility-trip-heading,.mobility-route-start,.mobility-alternative,.mobility-pickup-shortcut,.bike-heading,.bike-route-footer,.bike-history-switch,.transport-card');
  for(const block of constrained){
   const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node;
   while(node=walker.nextNode())for(const word of node.textContent.matchAll(/[\p{L}\p{N}]+/gu)){
    const range=document.createRange();range.setStart(node,word.index);range.setEnd(node,word.index+word[0].length);
    const rects=[...range.getClientRects()].filter(r=>r.width>0);
    if(rects.length>1)issues.push('Split word: '+word[0]);
   }
  }
  const controls=[...root.querySelectorAll('button,input,select,summary')].filter(el=>el.getClientRects().length&&!el.closest('[hidden],dialog'));
  for(const el of controls){
   const b=el.getBoundingClientRect();if(b.width<43||b.height<43)issues.push('Small target: '+(el.getAttribute('aria-label')||el.textContent.trim()));
   if(!el.closest('.mobility-mode-switch,.mobility-alternative-rail,.transport-card-rail')&&(b.x<panel.x-1||b.right>panel.right+1))issues.push('Escaping control: '+(el.getAttribute('aria-label')||el.textContent.trim()));
  }
  const words=[...root.querySelectorAll('*')].filter(el=>el.children.length===0&&el.textContent?.trim()).map(el=>el.textContent.trim());
  return {issues:[...new Set(issues)],overflow:document.documentElement.scrollWidth>innerWidth+1,modeRows:new Set([...rail.querySelectorAll('button')].map(el=>Math.round(el.getBoundingClientRect().y))).size,words};
 });
 assert.equal(result.overflow,false,`${mode} overflow ${JSON.stringify(variant)}`);
 if(variant.scale===100)assert.equal(result.modeRows,1,'The five modes share one compact row at ordinary text sizes');
 if(process.env.RIDES_COLLECT_ERRORS&&result.issues.length){layoutIssues.push({mode,...variant,issues:result.issues});console.log(JSON.stringify({mode,...variant,issues:result.issues}));}else assert.deepEqual(result.issues,[],`${mode} layout ${JSON.stringify(variant)}`);
 const violations=await page.evaluate(async()=>(await window.axe.run('.rides-workspace',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
 assert.deepEqual(violations,[],`${mode} accessibility ${JSON.stringify(variant)}`);
 variants.push({mode,...variant,passed:true});
}
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:485,height:850},reducedMotion:'reduce',timezoneId:'Asia/Kolkata'});
 await context.routeWebSocket('**',socket=>socket.close());
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.route('**/@vite/client',async route=>{const response=await route.fetch(),body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+body});});
 await context.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;requests.push({path,method:request.method()});await route.fulfill({contentType:'application/json',body:JSON.stringify(fixture(path.replace(/^\/api/,'')))});});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/market-compact-preview.html?destination=mobility');
 const market=page.getByRole('tablist',{name:'Marketplace destination',exact:true});
 assert.equal(await market.getByRole('tab',{name:'Cabs & cars',exact:true}).count(),0);
 assert.equal(await market.getByRole('tab',{name:'Rides',exact:true}).getAttribute('aria-selected'),'true');
 const modes=page.getByRole('group',{name:'Transport service type',exact:true});await modes.waitFor();
 await page.getByText('Routes up to 4 km',{exact:false}).waitFor();
 assert.equal(await modes.getByRole('button').count(),5);assert.equal(await modes.getByRole('button',{name:'Bike',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(requests.filter(r=>r.path==='/api/operations/local-business/rides').length,0,'Ride history stays lazy');
 await page.locator('.bike-map .journey-leaflet .leaflet-overlay-pane path').waitFor();assert.equal(await page.locator('.bike-map .journey-leaflet .leaflet-overlay-pane path').count(),1,'Browse map shows a confirmed pickup without invented bikes');
 assert.equal(await page.getByText(/\b\d+\s*(min|minutes) away\b/).count(),0,'Browsing does not invent a pickup ETA');
 await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 await page.screenshot({path:work+'/initial-bike-485.png',fullPage:true,animations:'disabled'});console.log('Initial visual: '+work+'/initial-bike-485.png');
 const dock=page.getByRole('navigation',{name:'Fixture bottom navigation'});for(const name of ['Explore','Services','Bookings','Market','Hire'])await dock.getByRole('button',{name,exact:true}).click();
 checks.push('Bike map/composer layers never intercept the customer navigation dock');
 await page.emulateMedia({reducedMotion:'no-preference'});const mapToggle=page.getByRole('button',{name:'Fullscreen journey map',exact:true});await mapToggle.click();const fullscreen=page.getByRole('dialog',{name:'Bike pickup and drop-off map',exact:true});await fullscreen.waitFor();assert(await fullscreen.evaluate(el=>el.parentElement===document.body),'Full map escapes animated application ancestors');const fullBox=await fullscreen.boundingBox();assert(fullBox&&Math.abs(fullBox.x)<1&&Math.abs(fullBox.y)<1&&fullBox.width>=484&&fullBox.height>=849,'Full map covers the viewport');await fullscreen.getByRole('button',{name:'Exit fullscreen map',exact:true}).click({trial:true});await page.keyboard.press('Escape');await fullscreen.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Fullscreen journey map');for(const name of ['Explore','Bookings'])await dock.getByRole('button',{name,exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});checks.push('Motion-enabled fullscreen uses the native top layer, Escape restores the map control, and navigation remains usable');
 const sharedBike=page.getByRole('button',{name:'Shared bike',exact:true});await sharedBike.click();const sharedBikeDialog=page.getByRole('dialog',{name:'Shared bike',exact:true});await sharedBikeDialog.getByRole('button',{name:'Your pickup Station Road, Balasore',exact:true}).waitFor();await sharedBikeDialog.getByText('1 passenger',{exact:true}).waitFor();await page.keyboard.press('Escape');await sharedBikeDialog.waitFor({state:'detached'});assert(await sharedBike.evaluate(el=>el===document.activeElement));
 checks.push('Shared bike preserves a confirmed pickup and one-passenger capacity');
 checks.push('Market Rides name, Bike default, five real services, no invented available bikes or pickup ETA');
 for(const name of ['Bike','Cab','Shared ride','Self-drive','Cab rental']){
  await modes.getByRole('button',{name,exact:true}).click();await pause(250);
  for(const width of [320,485,1440])for(const theme of ['light','dark'])for(const scale of [100,200]){
   await setVariant(page,width,scale,theme);await inspect(page,name,{width,theme,scale});
   if(width===485&&scale===100&&theme==='light'){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/'+name.replaceAll(' ','-').toLowerCase()+'-485.png',fullPage:true,animations:'disabled'});}
   if(width===320&&scale===200&&theme==='dark'&&['Bike','Cab'].includes(name)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/'+name.toLowerCase()+'-320-200-dark.png',fullPage:true,animations:'disabled'});}
   if(width===1440&&scale===100&&theme==='light'&&['Bike','Cab'].includes(name)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:work+'/'+name.toLowerCase()+'-1440.png',fullPage:true,animations:'disabled'});}
  }
  await setVariant(page,485,100,'light');
 }
 checks.push('Five modes across 60 layout/theme/text variants: readable words, reachable 44px controls, WCAG A/AA and enhanced contrast');
 await modes.getByRole('button',{name:'Cab',exact:true}).click();await pause(100);
 const more=page.getByRole('region',{name:'More ways to travel',exact:true}),rail=more.locator('.mobility-alternative-rail');
 const railLayout=await rail.evaluate(el=>({scrollable:el.scrollWidth>el.clientWidth+1,overflow:getComputedStyle(el).overflowX,height:el.getBoundingClientRect().height,cards:[...el.children].map(c=>({x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y,height:c.getBoundingClientRect().height}))}));
 assert(railLayout.scrollable&&['auto','scroll'].includes(railLayout.overflow),'Alternatives are a horizontal rail');assert(railLayout.cards.length===4);assert(railLayout.cards.every(card=>Math.abs(card.y-railLayout.cards[0].y)<2),'Alternatives stay on one row');assert(railLayout.height<260,'Alternative cards do not form a giant panel');
 await rail.focus();await page.keyboard.press('End');await page.waitForFunction(()=>{const el=document.querySelector('.mobility-alternative-rail');return el.scrollLeft+el.clientWidth>=el.scrollWidth-2;});await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.mobility-alternative-rail').scrollLeft<=2);assert(await rail.evaluate(el=>el.scrollLeft<=2),'Keyboard returns to the first alternative');
 await more.screenshot({path:work+'/more-ways-485.png'});
 for(const [mode,action,title,field] of [['shared','Find a shared ride','Shared ride',null],['self_drive','Find a self-drive car','Self-drive','Return date & time'],['rental','Plan a cab rental','Cab rental','Hire starts']]){
  const button=more.getByRole('button',{name:action,exact:true});await button.scrollIntoViewIfNeeded();await button.click();const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();if(field)await dialog.getByLabel(field,{exact:true}).waitFor();else{await dialog.getByRole('heading',{name:'Find a shared car or bike ride',exact:true}).waitFor();await dialog.getByRole('button',{name:'Your pickup Station Road, Balasore',exact:true}).waitFor();}assert.equal(await page.locator('.rides-workspace').getAttribute('data-mode'),'cab');await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await button.evaluate(el=>el===document.activeElement),'Booking close restores the source action');
 }
 checks.push('Compact horizontal alternatives open shared, self-drive and hire flows with stable selected mode and restored focus');
 const history=page.getByRole('button',{name:'Your ride bookings',exact:true});await history.click();const historyDialog=page.getByRole('dialog',{name:'Your rides',exact:true});await historyDialog.getByText('No active rides yet.',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.path==='/api/operations/local-business/rides').length,1);await page.keyboard.press('Escape');await historyDialog.waitFor({state:'detached'});assert(await history.evaluate(el=>el===document.activeElement));
 await modes.getByRole('button',{name:'Cab',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await modes.getByRole('button',{name:'Cab',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await modes.getByRole('button',{name:'Cab',exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 checks.push('History opens on demand, returns keyboard focus, and service selection retains visible focus');
 await page.goto(origin+'/tests/market-compact-preview.html?destination=mobility&noPickup=1');await page.getByRole('button',{name:'Shared bike',exact:true}).click();const unconfirmed=page.getByRole('dialog',{name:'Shared bike',exact:true});await unconfirmed.getByRole('button',{name:'Your pickup Choose on the map',exact:true}).waitFor();await page.keyboard.press('Escape');checks.push('An unconfirmed area is never silently reused as a shared pickup');
 assert.equal(requests.filter(r=>r.method!=='GET').length,0,'Exploration never creates a quote, booking or payment');assert.equal(requests.some(r=>/\/(tracking|position)|guest-tracking/.test(r.path)),false,'Public discovery never requests participant GPS');assert.deepEqual(errors,[]);assert.deepEqual(layoutIssues,[]);
 console.log(JSON.stringify({passed:true,checks,variants:variants.length,work}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();await writeFile(work+'/report.json',JSON.stringify({checks,variants,requests,errors,layoutIssues},null,2));console.log('Evidence: '+work);}
