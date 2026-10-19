import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.RIDES_PREVIEW_ORIGIN||'http://127.0.0.1:5187',api='http://127.0.0.1:8094',work=await mkdtemp('/tmp/repaido-journey-fullscreen-'),checks=[],errors=[];let browser,log='';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const server=spawn(resolve(web,'../backend/.venv/bin/python'),['-m','uvicorn','main:app','--host','127.0.0.1','--port','8094'],{cwd:resolve(web,'../backend'),env:{...process.env,NO_GCE_CHECK:'true',REPAIDO_STORAGE:'sqlite',REPAIDO_DB:work+'/test.db'},stdio:['ignore','pipe','pipe']});for(const stream of [server.stdout,server.stderr])stream.on('data',data=>log+=data);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dockHits=nav=>nav.evaluate(root=>[...root.querySelectorAll('button')].filter(button=>button.getClientRects().length).map(button=>{const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {name:button.textContent.trim(),reachable:button===hit||button.contains(hit)};}));
try{
 for(let i=0;i<120;i++){try{if((await fetch(api+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await pause(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:485,height:850}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin){if(url.pathname.startsWith('/api/'))return route.fetch({url:api+url.pathname+url.search}).then(response=>route.fulfill({response}));return route.continue();}return route.abort();});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(')});});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
 for(const width of [320,485])for(const reducedMotion of ['reduce','no-preference']){
  await page.setViewportSize({width,height:850});await page.emulateMedia({reducedMotion});await page.goto(origin+'/?sub=mobility');
  const dock=page.getByRole('navigation',{name:'Bottom Navigation',exact:true});await dock.waitFor();await dock.getByRole('button',{name:'Market',exact:true}).click();await page.getByRole('tablist',{name:'Marketplace destination',exact:true}).getByRole('tab',{name:'Rides',exact:true}).click();await page.locator('.bike-route-sheet').waitFor();
  assert.deepEqual((await dockHits(dock)).filter(hit=>!hit.reachable),[],`actual dock hit test ${width}/${reducedMotion}`);
  await page.locator('.bike-map').getByRole('button',{name:'Fullscreen journey map',exact:true}).click();const fullscreen=page.getByRole('dialog',{name:'Bike pickup and drop-off map',exact:true});await fullscreen.waitFor();
  assert(await fullscreen.evaluate(el=>el.parentElement===document.body),'Fullscreen is a body portal');const rect=await fullscreen.boundingBox();assert(Math.abs(rect.x)<1&&Math.abs(rect.y)<1&&Math.abs(rect.width-width)<1&&Math.abs(rect.height-850)<1,`fullscreen viewport ${width}/${reducedMotion}`);
  await fullscreen.getByRole('button',{name:'Exit fullscreen map',exact:true}).waitFor();await fullscreen.getByRole('link',{name:'OpenStreetMap contributors',exact:true}).waitFor();
  assert(await fullscreen.evaluate(el=>{const r=document.querySelector('.android-bottom-nav').getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Native map dialog covers dock');
  await page.keyboard.press('Escape');await fullscreen.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.matches('[data-map-toggle]'));assert.deepEqual((await dockHits(dock)).filter(hit=>!hit.reachable),[],'Dock is reachable after fullscreen Escape');
  await dock.getByRole('button',{name:'Bookings',exact:true}).click();await dock.getByRole('button',{name:'Explore',exact:true}).click();await page.locator('.android-explore-screen').waitFor();checks.push(`Actual App ${width}px/${reducedMotion}: all dock hit targets, viewport map, attribution, Escape, focus and Bookings/Explore`);
 }
 await page.goto(origin+'/tests/journey-fullscreen-preview.html');await page.getByRole('button',{name:'Open booking map',exact:true}).click();const booking=page.getByRole('dialog',{name:'Booking map',exact:true});await booking.waitFor();const toggle=booking.getByRole('button',{name:'Fullscreen journey map',exact:true});await toggle.click();const nested=page.getByRole('dialog',{name:'Booking journey map',exact:true});await nested.waitFor();await page.keyboard.press('Escape');await nested.waitFor({state:'detached'});assert(await booking.isVisible(),'Escape closes only the fullscreen map');assert.equal(await booking.getByLabel('Booking note',{exact:true}).inputValue(),'Keep this booking open');await page.waitForFunction(()=>document.activeElement?.matches('[data-map-toggle]'));assert(await toggle.evaluate(el=>el===document.activeElement));await page.keyboard.press('Escape');await booking.waitFor({state:'detached'});checks.push('A fullscreen map escapes a transformed existing booking dialog, restores its map toggle, preserves entered data and Escape closes only the top dialog');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));console.log('Evidence: '+work);}
