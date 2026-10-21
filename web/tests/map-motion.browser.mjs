import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const origin=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187';assert.equal(new URL(origin).hostname,'127.0.0.1');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({reducedMotion:'no-preference'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.__mapMotion={created:0,readings:[],rider:null};
  window.google={maps:{Map:class{constructor(){window.__mapMotion.created++;}addListener(){return{remove(){}}}setCenter(){}panTo(){}fitBounds(){}},Marker:class{constructor(options){this.position=options.position;this.visible=true;if(options.label?.text==='R')window.__mapMotion.rider=this;}setPosition(position){this.position=position;window.__mapMotion.readings.push({...position});}setTitle(){}setMap(map){this.visible=!!map;}},Polyline:class{setMap(){}},SymbolPath:{CIRCLE:0},LatLngBounds:class{extend(){}},event:{trigger(){}}}};
 });
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket{addEventListener(){}removeEventListener(){}send(){}close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}return route.continue();});
 await page.goto(origin+'/tests/map-motion-preview.html');await page.waitForFunction(()=>!!window.__mapMotion.rider);
 await page.getByRole('button',{name:'Next confirmed reading',exact:true}).click();await page.waitForFunction(()=>window.__mapMotion.readings.length>1);const middle=await page.evaluate(()=>window.__mapMotion.rider.position);assert(middle.lat>21.4934&&middle.lat<21.4944);
 await page.getByRole('button',{name:'Newer confirmed reading',exact:true}).click();await page.waitForFunction(()=>Math.abs(window.__mapMotion.rider.position.lat-21.4954)<1e-10);assert.equal(await page.evaluate(()=>window.__mapMotion.created),1);assert(await page.evaluate(()=>window.__mapMotion.readings.every(point=>point.lat>=21.4934&&point.lat<=21.4954)));
 await page.getByRole('button',{name:'Change section',exact:true}).click();assert.equal(await page.evaluate(()=>window.__mapMotion.created),1);assert(await page.locator('.motion-page').evaluate(el=>el.getAnimations().some(animation=>animation.playState==='running')));
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!document.querySelector('.motion-page').getAnimations().some(animation=>animation.playState==='running'));
 await page.getByRole('button',{name:'Next confirmed reading',exact:true}).click();await page.waitForFunction(()=>window.__mapMotion.rider.position.lat===21.4944);const before=await page.evaluate(()=>window.__mapMotion.readings.length);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__mapMotion.readings.length),before);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'Newer confirmed reading',exact:true}).click();await page.getByRole('button',{name:'GPS became stale',exact:true}).click();await page.waitForFunction(()=>!window.__mapMotion.rider.visible);const cleared=await page.evaluate(()=>window.__mapMotion.readings.length);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__mapMotion.readings.length),cleared);
 assert.deepEqual(errors,[]);console.log('Passed: confirmed GPS interpolation, interruption, no map recreation, reduced motion and immediate stale-position removal.');
}finally{await browser.close();}
