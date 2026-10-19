import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.LOCATION_PREVIEW_ORIGIN||'http://127.0.0.1:5187';assert.equal(new URL(origin).hostname,'127.0.0.1');
const evidence=await mkdtemp(tmpdir()+'/repaido-location-lifecycle-'),checks=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:850},reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.__locationReads=[];
  navigator.geolocation.getCurrentPosition=(success,error)=>window.__locationReads.push({success,error});
  window.__resolveLocation=(index,latitude,longitude)=>window.__locationReads[index].success({coords:{latitude,longitude,accuracy:12},timestamp:Date.now()});
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname.endsWith('.tile.openstreetmap.org'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{readyState=0;addEventListener(){};removeEventListener(){};send(){};close(){}}\n'+(await response.text()).replaceAll('new WebSocket(', 'new PreviewSocket(')});}
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});return route.continue();
 });
 await page.goto(origin+'/tests/location-lifecycle-preview.html');
 const dialog=page.getByRole('dialog',{name:'Confirm test location',exact:true}),confirm=dialog.getByRole('button',{name:'Confirm this location',exact:true}),checkbox=dialog.getByRole('checkbox');
 const open=async(name)=>{await page.getByRole('button',{name,exact:true}).click();await dialog.waitFor();};
 const close=async()=>{await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await dialog.waitFor({state:'detached'});};
 await open('Open first address');await dialog.getByLabel('Latitude',{exact:true}).fill('22.1');await dialog.getByLabel('Longitude',{exact:true}).fill('87.2');await dialog.getByLabel('House, street and landmark',{exact:true}).fill('Unsaved draft at a different house');assert.equal(await checkbox.isChecked(),true);await close();
 await open('Open second address');
 assert.equal(await dialog.getByLabel('Latitude',{exact:true}).inputValue(),'20.2961');assert.equal(await dialog.getByLabel('Longitude',{exact:true}).inputValue(),'85.8245');assert.equal(await dialog.getByLabel('House, street and landmark',{exact:true}).inputValue(),'Second house, Market Road');assert.equal(await dialog.getByLabel('City',{exact:true}).inputValue(),'Bhubaneswar');assert.equal(await checkbox.isChecked(),false);assert.equal(await confirm.isDisabled(),true);
 await checkbox.check();await confirm.click();await dialog.waitFor({state:'detached'});assert.deepEqual(JSON.parse(await page.getByRole('status').textContent()),{lat:20.2961,lng:85.8245,address:'Second house, Market Road',city:'Bhubaneswar'});
 checks.push('A mounted picker reopens with the supplied address and coordinates, requires fresh confirmation, and saves the same point');
 await open('Open first address');await dialog.getByRole('button',{name:'Use my current location',exact:true}).click();await page.waitForFunction(()=>window.__locationReads.length===1);await close();await open('Open second address');await page.evaluate(()=>window.__resolveLocation(0,25,80));
 assert.equal(await dialog.getByLabel('Latitude',{exact:true}).inputValue(),'20.2961');assert.equal(await checkbox.isChecked(),false);assert.equal(await dialog.getByRole('button',{name:'Use my current location',exact:true}).isEnabled(),true);assert.equal(await dialog.getByText(/GPS accuracy:/).count(),0);
 checks.push('A GPS callback from a closed opening cannot move or reconfirm the next opening');
 await dialog.getByRole('button',{name:'Use my current location',exact:true}).click();await page.waitForFunction(()=>window.__locationReads.length===2);await dialog.getByLabel('Latitude',{exact:true}).fill('20.4');await page.evaluate(()=>window.__resolveLocation(1,26,81));assert.equal(await dialog.getByLabel('Latitude',{exact:true}).inputValue(),'20.4');assert.equal(await dialog.getByLabel('Longitude',{exact:true}).inputValue(),'85.8245');assert.equal(await dialog.getByText(/GPS accuracy:/).count(),0);
 checks.push('A manual pin edit takes priority over an older in-flight GPS request');
 await dialog.getByRole('button',{name:'Use my current location',exact:true}).click();await page.waitForFunction(()=>window.__locationReads.length===3);await page.evaluate(()=>window.__resolveLocation(2,20.5,85.9));await dialog.getByText(/GPS accuracy: about 12 metres/).waitFor();assert.equal(await dialog.getByLabel('Latitude',{exact:true}).inputValue(),'20.5');assert.equal(await dialog.getByLabel('Longitude',{exact:true}).inputValue(),'85.9');assert.equal(await checkbox.isChecked(),true);assert.equal(await dialog.getByRole('button',{name:'Use my current location',exact:true}).isEnabled(),true);
 checks.push('The current GPS request still updates the pin, explains accuracy and releases its busy state');
 assert.deepEqual(errors,[]);await writeFile(evidence+'/report.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,evidence}));
}finally{await browser.close();}
