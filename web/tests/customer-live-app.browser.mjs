import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.RIDES_PREVIEW_ORIGIN||'http://127.0.0.1:5187',api='http://127.0.0.1:8086',work=await mkdtemp('/tmp/repaido-live-app-'),checks=[],errors=[],writes=[];
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const server=spawn(web+'/../backend/.venv/bin/python',[web+'/tests/business_suites_api.py',work+'/fixture.db','8086'],{cwd:web+'/../backend',env:{...process.env,NO_GCE_CHECK:'true'},stdio:['ignore','pipe','pipe']});let log='',browser,page,phase='on_the_way';
for(const stream of [server.stdout,server.stderr])stream.on('data',data=>log+=data);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(api+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}assert(ready,'Disposable backend ready');
 const response=await fetch(api+'/operations/local-business/rides',{headers:{Authorization:'Bearer customer'}}),records=await response.json();assert(response.ok,JSON.stringify(records));
 const source=records.rides.find(row=>row.mode==='cab'&&row.state==='requested');assert(source,'Fixture cab request exists');
 const now=Date.now()/1000,trip={...source,quote:source.quote||source.quotes?.[0],starts_at:now-300,ends_at:now+3600,pickup_address:'Station Road, Balasore',dropoff_address:'College Square, Balasore'};
 const call=async(path,uid,body)=>{const response=await fetch(api+'/operations/local-business'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+uid,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),data=await response.json();assert(response.ok,JSON.stringify(data));return data;};
 const vehicle=(await call('/partner?role=cab_owner','worker2')).vehicles[0],originPin={lat:21.4934,lng:86.9135},destinationPin={lat:21.5934,lng:86.9135};
 const departure=await call('/shared','worker2',{request_id:crypto.randomUUID(),vehicle_id:vehicle.id,origin:originPin,destination:destinationPin,origin_address:'ITI Square, Balasore',destination_address:'Soro College entrance',starts_at:now+900,ends_at:now+3600,seats:2,price_paise:20000,pickup_mode:'meeting_point',terms:'One bag per seat. Meet at the agreed pickup pin and pay the accepted fare directly to the owner.'});
 await call('/shared/'+departure.id+'/join','customer',{request_id:crypto.randomUUID(),expected_version:departure.version,pickup:originPin,dropoff:destinationPin,seats:1,consent:true});
 const ownerRow=(await call('/shared','worker2')).departures.find(row=>row.id===departure.id);
 await call('/shared/'+departure.id+'/commands','worker2',{action:'accept',passenger_id:ownerRow.passengers[0].id,expected_version:ownerRow.version,command_id:crypto.randomUUID()});
 const shared=(await call('/shared','customer')).departures.find(row=>row.id===departure.id);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:522,height:850},reducedMotion:'reduce'});
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin?route.continue():route.abort();});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();await route.fulfill({response,body:'class PreviewSocket {addEventListener(){} removeEventListener(){} send(){} close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});});
 await context.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace(/^\/api/,'');
  if(!['GET','HEAD'].includes(route.request().method())&&/bike-rides\/bookings|local-business\/(rides|shared).*\/(commands|join)|\/bookings$/.test(path))writes.push(path);
  if(path==='/operations/local-business/rides')return route.fulfill({json:{rides:[{...trip,state:['completed','shared'].includes(phase)?'completed':'on_the_way',version:phase==='on_the_way'?8:9}],server_time:Date.now()/1000}});
  if(path==='/operations/local-business/shared')return route.fulfill({json:{departures:phase==='shared'?[shared]:[],server_time:Date.now()/1000}});
  if(path==='/operations/bike-rides/bookings')return route.fulfill({json:{rides:[],next_cursor:null,server_time:Date.now()/1000}});
  try{const response=await route.fetch({url:api+url.pathname+url.search});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}
 });
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/customer-rides-app-preview.html?uid=customer&tab=explore');
 const home=page.getByRole('region',{name:'Your current activity',exact:true}),dock=page.getByRole('navigation',{name:'Bottom Navigation',exact:true});
 await home.getByRole('heading',{name:'Your cab is on the way',exact:true}).waitFor();assert.equal(await home.getByText('College Square, Balasore',{exact:true}).count(),1);
 assert.equal(await home.getByText('In progress',{exact:true}).count(),0,'En-route pickup is not labelled as an already-started customer journey');
 for(const width of [320,390,522,1280]){
  await page.setViewportSize({width,height:850});await home.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Home reflows '+width);
  await page.screenshot({path:work+`/home-live-viewport-${width}.png`});
  await page.screenshot({path:work+`/home-live-${width}.png`,fullPage:true});
 }
 checks.push('Actual customer App shows the current cab activity on Home at320–1280px');
 await page.setViewportSize({width:522,height:850});await home.getByRole('button',{name:'Open ride',exact:true}).click();
 await page.getByRole('group',{name:'Booking service type'}).getByRole('button',{name:'Rides',exact:true}).waitFor();
 assert.equal(await page.getByRole('group',{name:'Booking service type'}).getByRole('button',{name:'Rides',exact:true}).getAttribute('aria-pressed'),'true');
 await page.locator('.transport-bookings').getByText(trip.quote.vehicle.name,{exact:true}).waitFor();
 assert.equal(await page.getByText('No active rides yet.',{exact:true}).count(),0,'Empty bike/shared sources do not insert orphan messages around the active cab');
 await page.screenshot({path:work+'/bookings-from-home.png',fullPage:true});
 await page.screenshot({path:work+'/bookings-from-home-viewport.png'});
 checks.push('Home opens the matching cab booking in the unified Rides view without empty sibling messages');
 phase='completed';await dock.getByRole('button',{name:'Explore',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('repaido:operations-updated')));await home.waitFor({state:'detached'});
 checks.push('A confirmed completed trip disappears from Home after the next authoritative read');
 phase='shared';await page.evaluate(()=>window.dispatchEvent(new Event('repaido:operations-updated')));await home.getByRole('heading',{name:'Waiting for your shared pickup',exact:true}).waitFor();await home.getByRole('button',{name:'Open ride',exact:true}).click();
 const sharedCard=page.locator('.transport-bookings .shared-customer-card');await sharedCard.getByRole('heading',{name:'Seat confirmed',exact:true}).waitFor();
 assert.equal(await page.getByRole('group',{name:'Ride booking view'}).count(),1,'Shared and cab use a single view control');
 assert.equal(await page.getByText('No active rides yet.',{exact:true}).count(),0);
 assert((await sharedCard.boundingBox()).height<510,'The actual App keeps the scheduled shared card compact');
 await sharedCard.scrollIntoViewIfNeeded();await page.screenshot({path:work+'/shared-from-home-viewport.png'});await page.screenshot({path:work+'/shared-from-home.png',fullPage:true});
 checks.push('A real accepted shared reservation appears on Home and opens the compact passenger card inside the actual App');
 phase='completed';await dock.getByRole('button',{name:'Explore',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('repaido:operations-updated')));await home.waitFor({state:'detached'});
 phase='on_the_way';await page.evaluate(()=>window.dispatchEvent(new Event('repaido:operations-updated')));await home.waitFor();
 await page.evaluate(()=>window.__customerRidesFixture.emit('worker2'));await home.waitFor({state:'detached'});await pause(250);assert.equal(await page.locator('.customer-live-card').count(),0,'A different account never sees the prior customer trip');
 checks.push('Changing accounts removes the prior customer’s live trip immediately');
 assert.deepEqual(writes,[],'Home and open-booking actions do not mutate a trip');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);process.exitCode=1;await page?.screenshot({path:work+'/failure.png',fullPage:true}).catch(()=>{});}
finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors,writes},null,2));await writeFile(work+'/backend.log',log);console.log('Evidence: '+work);}
