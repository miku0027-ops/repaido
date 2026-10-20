import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const base=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187',out='/workspace/artifacts/bike-experience';await mkdir(out,{recursive:true});
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  window.rings=0;window.mapMarkers=[];
  class AudioContext{state='suspended';currentTime=0;destination={};async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}createOscillator(){return{frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(){window.rings++;},stop(){}};}}
  window.AudioContext=AudioContext;
  class Map{constructor(element){element.dataset.googleMap='fixture';}addListener(){return{remove(){}};}fitBounds(){}setCenter(){}}
  class Marker{constructor(options){window.mapMarkers.push(options);}setMap(){}}
  window.google={maps:{Map,Marker,Polyline:class{setMap(){}},LatLngBounds:class{extend(){}},SymbolPath:{CIRCLE:0}}};
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 let ride={id:'pickup-test',state:'arrived',version:1,vehicle_name:'Himalayan',rider_name:'Sample rider',passenger_name:'Sample passenger',pickup:{lat:21.49,lng:86.91},dropoff:{lat:21.50,lng:86.92},pickup_address:'Station entrance',dropoff_address:'Hospital entrance',pricing:{customer_total_paise:0,free:true},created_at:Date.now()/1000,allowed_actions:['cancel'],otp:'123456'},writes=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;let value={};
  if(path.endsWith('/policy'))value={enabled:true,bookings_available:true,promo_enabled:true,version:1};
  else if(path.endsWith('/nearby'))value={riders:[{lat:21.493,lng:86.913,received_at:Date.now()/1000}],server_time:Date.now()/1000};
  else if(path.endsWith('/commands')){const body=route.request().postDataJSON();writes.push(body);assert.equal(body.action,'request_stop');ride={...ride,early_dropoff:{requested_at:Date.now()/1000},version:ride.version+1,allowed_actions:['dispute']};value=ride;}
  else if(path.endsWith('/bookings'))value={rides:ride?[ride]:[],server_time:Date.now()/1000};
  else if(path.endsWith('/pickup-test'))value=ride;
  await route.fulfill({json:value});
 });
 await page.goto(base+'/tests/bike-rides-preview.html?mode=bookings&ride=pickup-test');
 const alert=page.getByRole('dialog',{name:'Your rider is at pickup'});await alert.waitFor();await alert.getByRole('button',{name:'Enable ringing'}).click();await page.waitForTimeout(2500);assert(await page.evaluate(()=>window.rings)>=4,'arrival rings repeatedly');
 await alert.getByRole('button',{name:'Got it · view pickup'}).click();await alert.waitFor({state:'hidden'});const rings=await page.evaluate(()=>window.rings);await page.waitForTimeout(2400);assert.equal(await page.evaluate(()=>window.rings),rings,'acknowledgement stops the alarm');
 ride={...ride,state:'in_progress',version:2,allowed_actions:['request_stop','dispute']};await page.evaluate(()=>window.dispatchEvent(new Event('repaido:bike-rides-updated')));await page.getByRole('button',{name:'End trip at a safe stop'}).click();
 const stop=page.getByRole('dialog',{name:'Request an early drop-off?'});await stop.getByText('Your agreed fare stays',{exact:false}).waitFor();await stop.getByRole('button',{name:'Request safe drop-off'}).click();await stop.waitFor({state:'hidden'});assert.equal(writes.length,1);await page.getByText('Early drop-off requested. Your rider can finish',{exact:false}).waitFor();
 ride=null;await page.goto(base+'/tests/bike-rides-preview.html');await page.waitForFunction(()=>window.mapMarkers.some(m=>m.title.startsWith('Available bike nearby')));assert.equal(await page.locator('.leaflet-container').count(),0);
 await page.goto(base+'/tests/bike-rider-workspace-preview.html');await page.getByRole('heading',{name:'Bike rides',exact:true}).waitFor();
 await page.evaluate(()=>window.bikeRiderFixture.records[0].expires_at=Date.now()/1000+120);await page.getByRole('button',{name:'Refresh bike rides'}).click();
 const offer=page.getByRole('dialog',{name:'New bike request',exact:true});await offer.waitFor();await offer.getByRole('button',{name:'Reject',exact:true}).waitFor();await page.screenshot({path:out+'/new-request.png'});await offer.getByRole('button',{name:'Accept ride',exact:true}).click();await offer.waitFor({state:'hidden'});
 await page.evaluate(()=>Object.assign(window.bikeRiderFixture.records[0],{state:'in_progress',version:5,allowed_actions:['complete','dispute'],stop_status:{destination:{status:'outside',distance_metres:200,valid_until:Date.now()/1000+75}}}));await page.getByRole('button',{name:'Refresh bike rides'}).click();await page.getByText('Finish ride unlocks within 150 m',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Finish ride',exact:true}).count(),0);
 await page.evaluate(()=>Object.assign(window.bikeRiderFixture.records[0],{version:6,early_dropoff:{requested_at:Date.now()/1000}}));await page.getByRole('button',{name:'Refresh bike rides'}).click();await page.getByRole('button',{name:'Finish ride',exact:true}).waitFor();
 for(const width of [320,703]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 assert.deepEqual(errors,[]);console.log('PASS: repeating pickup alarm/acknowledgement, customer early-stop confirmation, real-record nearby markers, Google map adapter, green offer Accept/Reject, hidden outside-radius completion, authorized early-stop finish, responsive layout.');
}finally{await browser.close();}
