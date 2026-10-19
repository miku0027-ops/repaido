import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
await mkdir('test-results',{recursive:true});
try{
 for(const width of [320,390,487,768]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/tests/bike-rider-preview.html`,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Bike rides',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'Available for bike rides'}).getAttribute('aria-checked'),'true');
  assert.equal(await page.getByText('Within the stop area · GPS verified',{exact:true}).count(),1);
  const current=page.getByRole('region',{name:'Current bike ride'});
  assert.equal(await current.getByRole('button',{name:'Finish ride',exact:true}).count(),1);
  assert.equal(await current.getByRole('button',{name:'Verify OTP & start'}).count(),0);
  assert.equal(await current.getByText('No fare to collect',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Money',exact:true}).click();
  const moneyDialog=page.getByRole('dialog',{name:'Salary & company cash',exact:true});
  assert.equal(await moneyDialog.getByText('₹7,000.00',{exact:false}).count(),1);
  await moneyDialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  const requests=page.getByRole('region',{name:'Bike ride requests'});
  assert.equal(await requests.getByRole('link',{name:'Call passenger'}).count(),0);
  await requests.getByRole('button',{name:'Accept ride',exact:true}).click();
  await page.getByText('Local fixture: accept requested',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}px`);
  // Hidden disclosure actions have no target, and provider attribution links
  // are inline legal text. All visible ride controls retain a 44px target.
  const undersized=await page.locator('.bike-rider-workspace button,.bike-rider-workspace a,.bike-rider-workspace summary').evaluateAll(elements=>elements.filter(element=>element.getClientRects().length&&!element.closest('.leaflet-control-attribution')&&element.getBoundingClientRect().height<43.5).map(element=>element.textContent));
  assert.deepEqual(undersized,[],`Small targets at ${width}px`);
  const obscured=await page.locator('.bike-rider-trip').evaluateAll(cards=>cards.filter(card=>{
   const actions=card.querySelector('.bike-rider-trip-actions'),fare=card.querySelector('.bike-rider-fare');
   return actions&&fare&&actions.getClientRects().length&&(actions.getBoundingClientRect().top<fare.getBoundingClientRect().bottom-1||actions.getBoundingClientRect().bottom>card.getBoundingClientRect().bottom+1);
  }).map(card=>card.getAttribute('aria-label')));
  assert.deepEqual(obscured,[],`Ride actions must not obscure details at ${width}px`);
  await current.locator('.bike-rider-more-actions>summary').click();
  assert.equal(await current.getByRole('button',{name:'Report a concern',exact:true}).isVisible(),true);
  await current.locator('.bike-rider-more-actions>summary').click();
  await current.getByRole('button',{name:'Fullscreen journey map',exact:true}).click();
  assert.equal(await current.locator('.journey-map.is-fullscreen').evaluate(element=>Math.round(element.getBoundingClientRect().height)),900);
  await page.keyboard.press('Escape');
  assert.equal(await current.locator('.journey-map.is-fullscreen').count(),0);
  if(width===390){await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'});const violations=await page.evaluate(async()=>(await window.axe.run('main',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})));assert.deepEqual(violations,[],'light rider view accessibility');}
  await page.getByRole('button',{name:'History 1',exact:true}).click();
  await page.getByText('Completed · #ISTORY',{exact:true}).waitFor();
  await page.screenshot({path:`test-results/bike-rider-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage({viewport:{width:320,height:900}});
 await page.goto(`${base}/tests/bike-rider-preview.html?text=200&theme=dark&state=gps-error`,{waitUntil:'networkidle'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow with 200% text');
 await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'});const violations=await page.evaluate(async()=>(await window.axe.run('main',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})));assert.deepEqual(violations,[],'dark rider view at 200% text accessibility');
 await page.getByRole('switch',{name:'Available for bike rides'}).click();
 assert.equal(await page.getByRole('switch',{name:'Available for bike rides'}).getAttribute('aria-checked'),'false');
 await page.screenshot({path:'test-results/bike-rider-320-large-dark.png',fullPage:true});
 console.log('PASS: compact rider cards, server action controls, salary separate from fare collection, passenger privacy, online toggle, targets and overflow across 5 variants');
}finally{await browser.close();}
