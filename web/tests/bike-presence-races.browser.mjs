// Isolated browser transport fault tests; no production accounts or requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1366,height:900},permissions:['geolocation'],geolocation:{latitude:21.49,longitude:86.91,accuracy:8}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>r.abort());
 await page.goto(base+'/tests/bike-rider-workspace-preview.html?nativeGps');
 const toggle=page.getByRole('switch',{name:'Available for bike rides'});
 await toggle.waitFor();
 // Hold an old read across a successful online mutation.
 await page.evaluate(()=>window.bikeRiderFixture.control.holdNextRead=true);
 await page.getByRole('button',{name:'Refresh bike rides',exact:true}).click();
 await page.waitForFunction(()=>!!window.bikeRiderFixture.control.releaseRead);
 await toggle.click();
 await page.waitForFunction(()=>document.querySelector('[role=switch]').getAttribute('aria-checked')==='true');
 assert.equal(await page.evaluate(()=>window.bikeRiderFixture.availability.online),true);
 await page.evaluate(()=>window.bikeRiderFixture.control.releaseRead());
 await page.waitForTimeout(150);
 assert.equal(await toggle.getAttribute('aria-checked'),'true');
 await page.screenshot({path:'/workspace/artifacts/go-reliability-2026-10-23/desktop-online.png',fullPage:true});
 console.log('PASS: desktop browser GPS and server receipt work while an older refresh is pending.');
 // Native browser watch may reuse its fix; change position for a fresh heartbeat.
 await context.setGeolocation({latitude:21.49001,longitude:86.91001,accuracy:8});
 await page.waitForTimeout(100);
 await page.evaluate(()=>window.bikeRiderFixture.control.holdNextWrite=true);
 await page.locator('.bike-rider-settings>summary').click();
 await page.getByRole('button',{name:'Update GPS',exact:true}).click();
 await page.waitForFunction(()=>!!window.bikeRiderFixture.control.releaseWrite);
 // Heartbeat is committed but its ACK is delayed. Offline must refresh its
 // version, retry the explicit intent and ignore the later heartbeat response.
 await toggle.click();
 await page.waitForFunction(()=>!window.bikeRiderFixture.availability.online);
 await page.evaluate(()=>window.bikeRiderFixture.control.releaseWrite());
 await page.waitForTimeout(150);
 assert.equal(await toggle.getAttribute('aria-checked'),'false');
 assert.equal(await page.evaluate(()=>window.bikeRiderFixture.availability.online),false);
 console.log('PASS: a delayed heartbeat acknowledgement cannot undo offline; conflict recovery is bounded.');
 await page.evaluate(()=>window.bikeRiderFixture.control.failNextWrite=true);
 await toggle.click();
 await page.getByText('LOCAL QA · write failed',{exact:true}).waitFor();
 assert.equal(await toggle.getAttribute('aria-checked'),'false');
 assert.equal(await page.evaluate(()=>window.bikeRiderFixture.availability.online),false);
 console.log('PASS: failed writes never display a fabricated online state.');
 await page.screenshot({path:'/workspace/artifacts/go-reliability-2026-10-23/desktop-rider.png',fullPage:true});
 // Denied laptop geolocation must explain the failure and make no presence write.
 const denied=await browser.newContext({viewport:{width:1366,height:900}});
 await denied.grantPermissions([], {origin:base});
 const blocked=await denied.newPage();await blocked.route('**/api/**',r=>r.abort());
 await blocked.goto(base+'/tests/bike-rider-workspace-preview.html?nativeGps');
 await blocked.getByRole('switch').click();
 await blocked.locator('.bike-rider-error').waitFor();
 assert.equal(await blocked.getByRole('switch').getAttribute('aria-checked'),'false');
 assert.equal(await blocked.evaluate(()=>window.bikeRiderFixture.reads.presenceWrites),0);
 // Exercise the shared HTTP adapter, not just the injected component transport.
 await blocked.route('**/api/operations/bike-rides/driver/availability',r=>r.fulfill({status:409,json:{detail:{code:'AVAILABILITY_CHANGED',message:'Refresh presence.'}}}));
 const failure=await blocked.evaluate(async()=>{
  localStorage.setItem('repaido.token','local-only-presence-test');
  const {operation}=await import('/src/services/operations.ts');
  try{await operation('/bike-rides/driver/availability',{method:'PUT',body:'{}'},{feedback:false});return null;}
  catch(error){return {code:error.code,status:error.status};}
 });
 assert.deepEqual(failure,{code:'AVAILABILITY_CHANGED',status:409});
 assert.deepEqual(errors,[]);
 console.log('PASS: denied desktop location keeps the rider offline with an actionable error.');
}finally{await browser.close();}
