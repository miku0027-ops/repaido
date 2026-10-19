import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.MARKET_HIGHLIGHTS_ORIGIN||'http://127.0.0.1:5187';
const evidence=await mkdtemp(resolve(tmpdir(),'repaido-market-highlights-')),checks=[],errors=[],metrics=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const authFixture=`export const auth={currentUser:null,onIdTokenChanged(next){queueMicrotask(()=>next(null));return()=>{};}};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
const context=await browser.newContext({viewport:{width:487,height:850},reducedMotion:'reduce'});
await context.routeWebSocket('**',socket=>socket.close());
await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
await context.route('**/src/firebase.ts',route=>route.fulfill({contentType:'text/javascript',body:authFixture}));
let page;
async function geometry(){
 return page.locator('.market-discovery-hub').evaluate(root=>{
  const bounds=root.getBoundingClientRect(),slide=root.querySelector('.opportunity-slide').getBoundingClientRect(),footer=root.querySelector('.opportunity-footer').getBoundingClientRect(),photo=root.querySelector('.opportunity-photo').getBoundingClientRect(),copy=root.querySelector('.opportunity-copy').getBoundingClientRect();
  const clipped=[];for(const el of root.querySelectorAll('button,small,strong,b,span')){if(!el.getClientRects().length||el.closest('svg'))continue;const box=el.getBoundingClientRect();if(box.left<bounds.left-1||box.right>bounds.right+1)clipped.push(el.textContent.trim());if(el.scrollHeight>el.clientHeight+1&&['hidden','clip'].includes(getComputedStyle(el).overflowY))clipped.push('vertical clipping: '+el.textContent.trim());}
  const targets=[...root.querySelectorAll('button')].map(el=>({label:el.getAttribute('aria-label')||el.textContent.trim(),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
  return {width:innerWidth,height:bounds.height,documentOverflow:document.documentElement.scrollWidth>innerWidth+1,clipped,targets,footerOverlap:footer.top<slide.bottom-1,photoOverlap:copy.right>photo.left+1,heroHeight:slide.height,footerHeight:footer.height};
 });
}
try{
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/market-highlights-preview.html');await page.locator('.market-discovery-hub').waitFor();await page.evaluate(()=>document.fonts.ready);await page.addScriptTag({path:require.resolve('axe-core')});
 const hub=page.getByRole('region',{name:'Market highlights',exact:true});
 for(const width of [320,360,487,768])for(const theme of ['light','dark'])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});
  for(let slide=0;slide<5;slide++){
   const g=await geometry();assert.equal(g.documentOverflow,false,JSON.stringify(g));assert.deepEqual(g.clipped,[],JSON.stringify(g));assert.equal(g.footerOverlap,false,'Controls must stay below the hero.');assert.equal(g.photoOverlap,false,'The photo must not cover the copy.');assert(g.targets.every(target=>target.width>=44&&target.height>=44),JSON.stringify(g.targets));
   if(width===487&&scale===100)assert(g.height<=210,JSON.stringify(g));
   if(slide===0)metrics.push({theme,scale,...g});await hub.getByRole('button',{name:'Next banner',exact:true}).click();
  }
  const axe=await page.evaluate(async()=>(await window.axe.run('.market-discovery-hub',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(node=>node.target)})));assert.deepEqual(axe,[],JSON.stringify({width,theme,scale,axe}));
 }
 checks.push('All five slides preserve readable copy, distinct photo/control regions and 44 px targets at 320/360/487/768 px, light/dark and 100/200% text; no horizontal overflow or WCAG AA violations.');
 await page.setViewportSize({width:487,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='100%';});await hub.screenshot({path:evidence+'/compact-market.png'});
 assert.equal(await page.locator('.opportunity-home .opportunity-footer,.opportunity-market .opportunity-footer').count(),0,'Other carousel variants must retain their original controls.');
 assert((await page.locator('.opportunity-home').boundingBox()).height>=230);assert((await page.locator('.opportunity-market').boundingBox()).height<=60);checks.push('Home hero and old ribbon retain their own layout and controls.');
 const benefits=hub.getByRole('button',{name:'Benefits',exact:true});await benefits.focus();await page.keyboard.press('Enter');let dialog=page.getByRole('dialog',{name:'Market shortcuts',exact:true});await dialog.waitFor();assert.equal(await dialog.getByRole('navigation',{name:'Shopping shortcuts',exact:true}).getByRole('button').count(),6);
 await page.keyboard.press('Shift+Tab');assert(await dialog.getByRole('button',{name:'Contracts',exact:true}).evaluate(e=>document.activeElement===e),'The sheet must trap reverse tab navigation.');
 const violations=await page.evaluate(async()=>(await window.axe.run('.market-perks-dialog',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(node=>node.target)})));assert.deepEqual(violations,[]);
 await dialog.getByRole('button',{name:'Offers & coupons',exact:true}).click();dialog=page.getByRole('dialog',{name:'Your offers & coupons',exact:true});await dialog.getByRole('button',{name:'Sign in to view offers',exact:true}).click();assert.equal(await page.locator('output').innerText(),'sign-in');await dialog.getByRole('button',{name:'All market shortcuts',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Market shortcuts',exact:true});await dialog.getByRole('button',{name:'My rewards',exact:true}).click();dialog=page.getByRole('dialog',{name:'Your Captain rewards',exact:true});await dialog.getByRole('button',{name:'Sign in to view your rewards',exact:true}).waitFor();await dialog.getByRole('button',{name:'All market shortcuts',exact:true}).click();await page.keyboard.press('Escape');assert(await benefits.evaluate(e=>e===document.activeElement),'Escape must return focus to Benefits.');
 checks.push('The Benefits sheet supports keyboard focus, Escape, offers/sign-in and rewards without removing account features.');
 for(const [name,id] of [['Sell an item','sell'],['Buy spares','spares'],['Refurbished','refurbished'],['Rent equipment','rentals'],['Direct swap','exchange'],['Pre-owned','preowned'],['Contracts','contracts']]){
  await benefits.click();await page.getByRole('dialog',{name:'Market shortcuts',exact:true}).getByRole('button',{name,exact:true}).click();assert.equal(await page.locator('output').innerText(),id);assert.equal(await page.getByRole('dialog').count(),0);
 }
 checks.push('Selling and all six destination shortcuts dispatch their original action and close the sheet.');
 await hub.locator('.opportunity-slide').click();dialog=page.getByRole('dialog');await dialog.getByText('How it works & terms',{exact:true}).waitFor();await page.keyboard.press('Escape');assert(await hub.locator('.opportunity-slide').evaluate(e=>e===document.activeElement));
 assert.equal(await hub.getByRole('button',{name:'Automatic banners paused for reduced motion',exact:true}).isDisabled(),true);assert.equal(await hub.locator('.opportunity-motion').count(),0);
 await page.emulateMedia({reducedMotion:'no-preference'});await hub.getByRole('button',{name:'Pause automatic banners',exact:true}).click();const slide=await hub.locator('.opportunity-controls>span').getAttribute('aria-label');await page.locator('h1').click();await page.mouse.move(0,0);await new Promise(resolve=>setTimeout(resolve,6700));assert.equal(await hub.locator('.opportunity-controls>span').getAttribute('aria-label'),slide);await hub.getByRole('button',{name:'Next banner',exact:true}).click();assert.notEqual(await hub.locator('.opportunity-controls>span').getAttribute('aria-label'),slide);checks.push('Detail terms/focus, reduced motion, persistent playback pause and manual navigation remain functional.');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,evidence,defaultPhoneHeight:metrics.find(m=>m.width===487&&m.theme==='light'&&m.scale===100)?.height}));
}catch(error){console.error(error);if(page)await page.screenshot({path:evidence+'/failure.png',fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(evidence+'/report.json',JSON.stringify({checks,metrics,errors},null,2));await browser.close();console.log('Evidence: '+evidence);}
