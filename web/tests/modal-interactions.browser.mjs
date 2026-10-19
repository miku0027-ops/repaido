import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.MODAL_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const evidence=await mkdtemp(tmpdir()+'/repaido-modal-interactions-'),checks=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:800,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{readyState=0;addEventListener(){};removeEventListener(){};send(){};close(){}}\n'+(await response.text()).replaceAll('new WebSocket(', 'new PreviewSocket(')});}
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
  return route.continue();
 });
 await page.goto(origin+'/tests/feedback-preview.html?mode=controls');
 const launch=page.getByRole('button',{name:'Open test form',exact:true});await launch.click();
 const dialog=page.getByRole('dialog',{name:'Test form',exact:true});await dialog.waitFor();
 await dialog.getByLabel('Preserved draft').fill('A draft worth keeping');
 const heading=await dialog.getByRole('heading',{name:'Test form',exact:true}).boundingBox();
 await page.mouse.move(heading.x+10,heading.y+10);await page.mouse.down();await page.mouse.move(5,5,{steps:20});await page.mouse.up();
 assert.equal(await dialog.count(),1,'Selecting text out into the backdrop must not discard a dialog');
 assert.equal(await dialog.getByLabel('Preserved draft').inputValue(),'A draft worth keeping');
 checks.push('A pointer drag starting inside the dialog and ending outside preserves the dialog and its draft');
 const nestedLaunch=dialog.getByRole('button',{name:'Open nested form',exact:true});await nestedLaunch.click();
 const nested=page.getByRole('dialog',{name:'Nested form',exact:true});await nested.waitFor();
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
 const nestedClose=nested.getByRole('button',{name:'Close dialog',exact:true}),nestedLast=nested.getByRole('button',{name:'Save nested profile',exact:true});
 await nestedLast.focus();await page.keyboard.press('Tab');assert.equal(await nestedClose.evaluate(element=>element===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');assert.equal(await nestedLast.evaluate(element=>element===document.activeElement),true);
 await page.keyboard.press('Escape');await nested.waitFor({state:'detached'});
 assert.equal(await nestedLaunch.evaluate(element=>element===document.activeElement),true);
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
 assert.equal(await dialog.getByLabel('Preserved draft').inputValue(),'A draft worth keeping');
 checks.push('Nested dialogs contain keyboard focus, Escape restores the parent trigger, and the parent stays scroll locked with its draft');
 await page.mouse.click(5,5);await dialog.waitFor({state:'detached'});
 assert.equal(await launch.evaluate(element=>element===document.activeElement),true);
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 checks.push('A deliberate backdrop click dismisses the dialog, restores its trigger and releases the final scroll lock');
 await page.setViewportSize({width:390,height:850});await launch.click();await dialog.waitFor();await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await dialog.waitFor({state:'detached'});
 assert.equal(await launch.evaluate(element=>element===document.activeElement),true);
 checks.push('The explicit close action also restores focus at phone width');
 assert.deepEqual(errors,[]);await writeFile(evidence+'/report.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,evidence}));
}finally{await browser.close();}
