import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const origin=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187',out=process.env.REPAIDO_DRIVER_ARTIFACTS||'/workspace/artifacts/go-material/driver';
assert.equal(new URL(origin).hostname,'127.0.0.1');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const errors=[],checks=[];let page;
try{
 const context=await browser.newContext({viewport:{width:466,height:850},reducedMotion:'reduce'});
 await context.addInitScript(()=>{window.google={maps:{Map:class{constructor(element){element.style.background='#dfe9dc';element.innerHTML='<span style="display:block;padding:16px;color:#32442d;font-size:12px">Local Google Maps SDK fixture</span>';}addListener(){return{remove(){}}}fitBounds(){}setCenter(){}},Marker:class{setMap(){}setPosition(){}},Polyline:class{setMap(){}},LatLngBounds:class{extend(){}},SymbolPath:{CIRCLE:0},event:{trigger(){}}}};});
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();if(url.pathname==='/@vite/client'){const r=await route.fetch();return route.fulfill({response:r,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+(await r.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}if(url.pathname.endsWith('/bike-rides/map-config'))return route.fulfill({json:{provider:'google',configured:true,browser_key:'local-preview-key'}});if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{detail:'Local visual fixture only'}});return route.continue();});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const state of ['empty','offer']){
  await page.goto(origin+'/tests/bike-rider-preview.html?state='+state);await page.locator('.bike-rider-workspace').first().waitFor();await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'});
  for(const width of [320,466])for(const scale of [100,200])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:850});await page.evaluate(({scale,theme})=>{document.documentElement.style.fontSize=scale+'%';document.documentElement.dataset.theme=theme;},{scale,theme});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${state}/${width}/${scale}/${theme} overflow`);
   const violations=await page.evaluate(async()=>(await window.axe.run(document.querySelector('dialog[open]')||document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));assert.deepEqual(violations,[],`${state}/${width}/${scale}/${theme}`);
  }
  await page.setViewportSize({width:466,height:850});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});
  await page.screenshot({path:out+'/driver-'+state+'-466.png',fullPage:true});checks.push(state+' passes mobile/large-text/light/dark accessibility');
  if(state==='empty'){
   await page.getByRole('button',{name:'Money',exact:true}).click();const finance=page.getByRole('dialog',{name:'Salary & company cash',exact:true});await finance.waitFor();await page.screenshot({path:out+'/driver-earnings-466.png'});await finance.getByRole('button',{name:'Close dialog',exact:true}).click();
   await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'History 0',exact:true}).click();assert((await page.locator('.driver-records-motion').evaluate(el=>el.getAnimations().map(a=>a.effect.getTiming().duration))).includes(520));await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.driver-records-motion').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length),0);checks.push('Driver records animate on navigation and stop immediately for reduced motion');
  }
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/checks.json',JSON.stringify({passed:true,checks,provider_boundary:'Local Google Maps SDK fixture; no production actions'},null,2));console.log('PASS: '+checks.join('; '));
}catch(e){await page?.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.error(e);process.exitCode=1;}finally{await browser.close();}
