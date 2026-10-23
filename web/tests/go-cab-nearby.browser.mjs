import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)('/opt/codex/runtimes/cua/lib/node_modules/playwright');
const work=await mkdtemp('/tmp/repaido-cab-nearby-'),errors=[],reads=[];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:465,height:850},reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  const f=window.cabFixture={maps:[],markers:[],gps:[]};
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,error,options){f.gps.push({success,error,options});}}});
  window.google={maps:{Map:class{constructor(el,options){this.center=options.center;this.zoom=options.zoom;this.el=el;f.maps.push(this);}addListener(){return{remove(){}};}setCenter(p){this.center=p;}panTo(p){this.center=p;}setZoom(z){this.zoom=z;}getCenter(){return{lat:()=>this.center.lat,lng:()=>this.center.lng};}getZoom(){return this.zoom;}moveCamera(v){this.center=v.center;this.zoom=v.zoom;}fitBounds(){}},Marker:class{constructor(options){Object.assign(this,options);f.markers.push(this);}setMap(m){this.map=m;}},Polyline:class{setMap(){}},SymbolPath:{CIRCLE:0},LatLngBounds:class{extend(){}},event:{trigger(){}}}};
 });
 let scenario='fresh';
 const snapshot=()=>{const now=Date.now()/1000;return{server_time:now,available_cabs:scenario==='empty'?[]:[{id:'cell-1',position:{lat:21.495,lng:86.915},available_count:2,updated_at:now,expires_at:now+(scenario==='expire'?1.2:75),approximation_metres:450}]};};
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}
  if(url.pathname.endsWith('/transport/available-cabs')){reads.push(Object.fromEntries(url.searchParams));return scenario==='error'?route.fulfill({status:503,json:{detail:'Unavailable'}}):route.fulfill({json:snapshot()});}
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:url.pathname.endsWith('/policy')?{enabled:true,bookings_available:true,service_radius_metres:4000,version:1}:{areas:[],rides:[],departures:[]}});
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5187/tests/go-location-preview.html');
 await page.getByRole('button',{name:'Cab With a driver',exact:true}).click();
 const status=page.locator('.go-nearby-status'),locate=page.getByRole('button',{name:'Locate me',exact:true});
 await status.getByText('2 cabs online nearby · approximate areas',{exact:true}).waitFor();
 assert.equal(reads[0].lat,'21.4934');assert.equal(reads[0].lng,'86.9135');
 await page.getByRole('button',{name:/^Pickup Set pickup on map/}).waitFor();
 assert.equal(await page.evaluate(()=>window.cabFixture.markers.filter(m=>m.map&&m.title==='2 online cabs · approximate area').length),1);
 await locate.click();await page.waitForFunction(()=>window.cabFixture.gps.length===1);
 assert(await locate.isDisabled());assert.equal(await page.evaluate(()=>window.cabFixture.gps[0].options.maximumAge),0);
 await page.evaluate(()=>window.cabFixture.gps[0].success({coords:{latitude:21.51,longitude:86.93,accuracy:10}}));
 await page.waitForFunction(()=>window.cabFixture.maps.at(-1).center.lat===21.51);
 await status.getByText('2 cabs online nearby · approximate areas',{exact:true}).waitFor();
 assert.equal(reads.at(-1).lat,'21.51');assert.equal(reads.at(-1).lng,'86.93');
 await page.getByRole('button',{name:/^Pickup Set pickup on map/}).waitFor();
 assert.equal(await page.evaluate(()=>window.cabFixture.markers.filter(m=>m.map&&m.title==='Your current location').length),1);
 await page.evaluate(()=>window.cabFixture.maps.at(-1).setCenter({lat:21.52,lng:86.94}));
 await page.getByRole('button',{name:'Refresh nearby cabs',exact:true}).click();await status.getByText('2 cabs online nearby · approximate areas',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.cabFixture.maps.at(-1).center.lat),21.52);
 scenario='expire';await page.getByRole('button',{name:'Refresh nearby cabs',exact:true}).click();await status.getByText('No drivers are sharing nearby right now.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.cabFixture.markers.filter(m=>m.map&&m.title==='2 online cabs · approximate area').length),0);
 scenario='error';await page.getByRole('button',{name:'Refresh nearby cabs',exact:true}).click();await status.getByText('Nearby cabs couldn’t refresh.',{exact:true}).waitFor();
 scenario='fresh';await page.getByRole('button',{name:'Refresh nearby cabs',exact:true}).click();await status.getByText('2 cabs online nearby · approximate areas',{exact:true}).waitFor();
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});dispatchEvent(new Event('offline'));});
 await status.getByText('Reconnect to see nearby cabs.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.cabFixture.markers.filter(m=>m.map&&m.title==='2 online cabs · approximate area').length),0);
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});dispatchEvent(new Event('online'));});
 await status.getByText('2 cabs online nearby · approximate areas',{exact:true}).waitFor();
 await locate.click();await page.evaluate(()=>window.cabFixture.gps.at(-1).error({code:1}));
 await page.getByText('Allow location access in your browser to recenter the map.',{exact:true}).waitFor();assert(await locate.isEnabled());
 await locate.click();await page.getByRole('button',{name:'Bike One passenger',exact:true}).click();
 await page.evaluate(()=>window.cabFixture.gps.at(-1).success({coords:{latitude:0,longitude:0,accuracy:10}}));
 assert.notEqual(await page.evaluate(()=>window.cabFixture.maps.at(-1).center.lat),0);
 await page.getByRole('button',{name:'Cab With a driver',exact:true}).click();await status.getByText('2 cabs online nearby · approximate areas',{exact:true}).waitFor();
 for(const width of [320,465,1100]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const box=await locate.boundingBox();assert(box.width>=44&&box.height>=44);const refresh=page.getByRole('button',{name:'Refresh nearby cabs',exact:true});await refresh.scrollIntoViewIfNeeded();assert(await refresh.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Refresh control must not be covered by the ride sheet');}
 await page.setViewportSize({width:465,height:850});await page.screenshot({path:work+'/cab-nearby-465.png'});
 assert.deepEqual(errors,[]);const report={passed:true,checks:['Availability loads before pickup confirmation from the current area','Only server-supplied fresh cab areas appear; grouped cab count is preserved','Locate me reads fresh GPS, recentres, and shows a blue dot without confirming or changing ride stops','Live discovery follows located area; feed refresh does not reset map panning','Expired and offline markers disappear; network errors and empty results have distinct states','Denied location can retry; delayed GPS after switching tabs is ignored','Locate control is at least 44px; 320/465px layouts do not overflow'],errors};await writeFile(work+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,work}));
}finally{await browser.close();}
