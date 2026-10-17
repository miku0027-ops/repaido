import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp('/tmp/repaido-public-cab-map-');
const api='http://127.0.0.1:8065',origin=process.env.PUBLIC_CAB_MAP_ORIGIN||'http://127.0.0.1:5195';
const server=spawn(resolve(web,'../backend/.venv/bin/python'),[web+'/tests/public-cab-map_api.py',work+'/test.db','8065'],{cwd:resolve(web,'../backend'),stdio:['ignore','pipe','pipe']});
const vite=process.env.PUBLIC_CAB_MAP_ORIGIN?null:spawn(process.execPath,[web+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5195','--strictPort'],{cwd:web,stdio:['ignore','pipe','pipe']});
let log='',browser;for(const child of [server,vite].filter(Boolean))for(const stream of [child.stdout,child.stderr])stream.on('data',data=>log+=data);
const checks=[],errors=[],requests=[],responses=[],pause=ms=>new Promise(r=>setTimeout(r,ms)),pin={lat:21.4934,lng:86.9135};
const base='/operations/local-business',publicPath=base+'/transport/available-cabs';
async function call(path,uid,body){const response=await fetch(api+base+path,{method:body?'POST':'GET',headers:{...(uid?{Authorization:'Bearer '+uid}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert(response.ok,JSON.stringify(data));return {response,data};}
async function ready(url,child){for(let attempt=0;attempt<180;attempt++){try{if((await fetch(url)).ok)return;}catch{}if(child?.exitCode!==null&&child?.exitCode!==undefined)throw Error(log);await pause(100);}throw Error('Test server did not start: '+log.slice(-1500));}
const sample=(seconds=60,count=2)=>({server_time:2000000000,available_cabs:[{id:'public-coarse-area',position:{lat:21.494,lng:86.914},available_count:count,updated_at:2000000000,expires_at:2000000000+seconds,approximation_metres:450}]});
const empty={server_time:2000000000,available_cabs:[]};
try{
 await Promise.all([ready(api+'/health',server),ready(origin+'/tests/public-cab-map-preview.html',vite)]);
 const sessions=[];
 for(const uid of ['worker','worker2']){
  const mine=(await call('/transport/public-availability',uid)).data,vehicle=mine.vehicles.find(row=>row.eligible);assert(vehicle);
  const session=(await call('/vehicles/'+vehicle.id+'/public-availability',uid,{enabled:true,consent:true,expected_version:vehicle.sharing.version,request_id:crypto.randomUUID()})).data;
  await call('/vehicles/'+vehicle.id+'/public-availability/position',uid,{session_token:session.session_token,sequence:1,...pin,accuracy:5,captured_at:Date.now()/1000});sessions.push({uid,vehicle,session});
 }
 const projection=await call('/transport/available-cabs?'+new URLSearchParams(pin));
 assert.equal(projection.response.headers.get('cache-control'),'private, no-store');assert.equal(projection.data.available_cabs.length,1);
 const coarse=projection.data.available_cabs[0];assert.equal(coarse.available_count,2);assert.notDeepEqual(coarse.position,pin);assert(coarse.approximation_metres>=300);
 assert.deepEqual(Object.keys(coarse).sort(),['approximation_metres','available_count','expires_at','id','position','updated_at']);
 for(const {uid,vehicle,session} of sessions)for(const secret of [uid,vehicle.id,session.session_token,'registration','phone','captured_at'])assert(!JSON.stringify(projection.data).includes(secret));
 checks.push('real SQLite HTTP consent and fresh GPS publish two approved cabs as one coarse anonymous area, with no-store response');
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:480,height:850},reducedMotion:'reduce'});
 // No live external tiles or authentication services are needed by this fixture.
 await context.route('**/*.tile.openstreetmap.org/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf2f7"/></svg>'}));
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();const body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+body});});
 let scenario='real',held=[],reads=0;
 await context.route('**/api/**',async route=>{
  try{
   const url=new URL(route.request().url());requests.push({method:route.request().method(),path:url.pathname,search:url.search});
   if(url.pathname==='/api'+publicPath){
    reads++;
    if(scenario==='hold'){held.push(route);return;}
    if(scenario==='error'){await route.fulfill({status:503,json:{detail:'Availability unavailable'}});return;}
    if(scenario==='bad'){await route.fulfill({json:{...sample(),available_cabs:[{...sample().available_cabs[0],approximation_metres:5}]}});return;}
    if(scenario==='empty'){await route.fulfill({json:empty});return;}
    if(scenario==='expiry'){await route.fulfill({json:sample(1.3)});return;}
    if(scenario==='fresh'){await route.fulfill({json:sample()});return;}
   }
   const response=await route.fetch({url:api+url.pathname.replace(/^\/api/,'')+url.search});
   if(url.pathname==='/api'+publicPath)responses.push(await response.json());
   await route.fulfill({response});
  }catch{await route.abort().catch(()=>{});}
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 const marker=page.locator('.mobility-map-cab-area'),status=page.locator('.mobility-map-legend');
 async function open(){await page.goto(origin+'/tests/public-cab-map-preview.html');await page.getByRole('region',{name:'Pickup area map',exact:true}).waitFor();}
 async function refresh(){const prior=reads;await page.getByRole('button',{name:'Refresh nearby transport',exact:true}).click();for(let i=0;i<100&&reads===prior;i++)await pause(20);assert(reads>prior,'Refresh performs a public availability read');}
 async function count(expected){for(let attempt=0;attempt<150;attempt++){if(await marker.count()===expected){await pause(80);if(await marker.count()===expected)return;}await pause(25);}assert.equal(await marker.count(),expected);}
 await open();await count(1);assert.equal(await marker.locator('span').textContent(),'2');await status.getByText('2 cabs sharing · approximate areas.',{exact:false}).waitFor();
 const map=page.getByRole('region',{name:'Pickup area map',exact:true});await map.focus();await page.keyboard.press('ArrowRight');
 const pan=await page.locator('.leaflet-map-pane').getAttribute('style');await refresh();await count(1);assert.equal(await page.locator('.leaflet-map-pane').getAttribute('style'),pan,'Heartbeat updates markers without resetting customer map pan');
 checks.push('production TransportRail and Leaflet map render genuine aggregated availability; refresh preserves the customer’s pan');
 for(const [index,{uid,vehicle,session}] of sessions.entries()){
  await call('/vehicles/'+vehicle.id+'/public-availability',uid,{enabled:false,session_token:session.session_token});await refresh();
  if(index===0){await count(1);await page.waitForFunction(()=>document.querySelector('.mobility-map-cab-area>span')?.textContent==='1');}
  else{await count(0);await status.getByText('No drivers are sharing nearby right now.',{exact:false}).waitFor();}
 }
 checks.push('real server revoke updates aggregate counts and removes the last marker; an empty result never creates decorative cabs');
 scenario='fresh';await refresh();await count(1);
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});dispatchEvent(new Event('offline'));});await count(0);await status.getByText('Live availability pauses',{exact:false}).waitFor();
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});dispatchEvent(new Event('online'));});await count(1);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await count(0);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await count(1);
 scenario='error';await refresh();await count(0);await status.getByText('Live availability is temporarily unavailable.',{exact:true}).waitFor();
 scenario='fresh';await refresh();await count(1);scenario='bad';await refresh();await count(0);await status.getByText('Live availability is temporarily unavailable.',{exact:true}).waitFor();
 checks.push('offline, hidden, network-error and unsafe malformed projection states immediately remove public markers');
 scenario='expiry';await refresh();await count(1);await page.evaluate(()=>{window.__realDateNow=Date.now;Date.now=()=>0;});await count(0);await page.evaluate(()=>{Date.now=window.__realDateNow;});
 checks.push('server-relative monotonic expiry removes the pin even when the device wall clock is moved backwards');
 scenario='hold';await refresh();assert(held.length);const delayed=held.splice(0);
 await page.evaluate(()=>{window.__seenLateMarkers=0;window.__lateObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element&&(node.matches('.mobility-map-cab-area')||node.querySelector('.mobility-map-cab-area')))window.__seenLateMarkers++;});window.__lateObserver.observe(document.querySelector('.mobility-pickup-map'),{childList:true,subtree:true});});
 await pause(1500);scenario='empty';const lateResponse=page.waitForResponse(response=>response.url().includes(publicPath)&&response.status()===200);
 for(const route of delayed)await route.fulfill({json:sample(1)}).catch(()=>{});await lateResponse;await pause(100);await count(0);
 assert.equal(await page.evaluate(()=>{window.__lateObserver.disconnect();return window.__seenLateMarkers;}),0,'A projection already expired during network transit is never rendered');
 checks.push('network transit time consumes the pin lifetime: a delayed already-expired response never flashes a cab marker');
 // Deliver an old response only after a new location/account/mode has taken over.
 for(const control of ['Change pickup','Change account','Change mode','Toggle active']){
  scenario='hold';await refresh();assert(held.length);
  const pending=held.splice(0);scenario='empty';await page.getByRole('button',{name:control,exact:true}).click();
  for(const route of pending)await route.fulfill({json:sample()}).catch(()=>{});
  await count(0);await pause(100);assert.equal(await marker.count(),0,control+' ignores the late response');
  await page.getByRole('button',{name:control,exact:true}).click();
  if(control==='Change mode'||control==='Toggle active')await status.getByText('No drivers are sharing nearby right now.',{exact:false}).waitFor();
 }
 checks.push('late responses cannot restore markers after pickup, account, service mode or active-screen changes');
 scenario='fresh';await refresh();await count(1);await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
 for(const width of [320,480,1440])for(const scale of [100,200])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(({scale,theme})=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=theme;},{scale,theme});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}px ${scale}% ${theme} has no horizontal overflow`);
  for(const control of await page.locator('.mobility-map-controls button').all()){
   await control.scrollIntoViewIfNeeded();const rect=await control.boundingBox();assert(rect&&rect.width>=44&&rect.height>=44);
   assert(await control.evaluate(element=>{const rect=element.getBoundingClientRect(),target=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return target===element||element.contains(target);}),`${width}px ${scale}% ${theme} map control receives pointer input`);
   const overlaps=await control.evaluate(element=>{const rect=element.getBoundingClientRect();return [...document.querySelectorAll('.mobility-map-caption,.mobility-map-legend')].some(overlay=>{const other=overlay.getBoundingClientRect();return Math.min(rect.right,other.right)>Math.max(rect.left,other.left)&&Math.min(rect.bottom,other.bottom)>Math.max(rect.top,other.top);});});
   assert.equal(overlaps,false,`${width}px ${scale}% ${theme} map labels do not cover controls`);
  }
  const violations=await page.evaluate(async()=>(await window.axe.run('.mobility-pickup-map',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.failureSummary)})));
  assert.deepEqual(violations,[],`${width}px ${scale}% ${theme} map accessibility`);
  if(width===320&&scale===200&&theme==='dark'||width===480&&scale===100&&theme==='light')await page.screenshot({path:`${work}/map-${width}-${scale}-${theme}.png`,fullPage:true});
 }
 checks.push('real map keyboard pan, 44px controls, reduced motion and 12 viewport/theme/text-size combinations pass geometry and WCAG checks');
 assert(!requests.some(request=>/journey.*location|\/tracking|\/journeys/.test(request.path)),'Public discovery never requests private journey locations');
 assert(requests.every(request=>request.method==='GET'),'Customer map performs reads only');assert.deepEqual(errors,[]);
 checks.push('customer discovery performs only GET requests and never reads private journey tracking');
 console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);console.error(log.slice(-1800));process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');vite?.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors,requests,responses},null,2));console.log('Evidence: '+work);}
