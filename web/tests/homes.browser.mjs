import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:5192',out='/tmp/repaido-homes-browser';await mkdir(out,{recursive:true});
const home={id:'00000000-0000-4000-8000-000000000001',version:1,title:'Sunny two bedroom apartment',city:'Balasore',locality:'Station Road',property_type:'apartment',bedrooms:2,furnishing:'unfurnished',rent_paise:1200000,deposit_paise:2400000,description:'Two bedrooms with balcony, parking and separate maintenance charges.',available_from:'2026-11-01',photo_id:'fixture-photo',image_url:'/images/home-fixture.jpg',status:'published'};
const authFixture=`const listeners=new Set();const user=uid=>uid?{uid,getIdToken:async()=>uid}:null;export const auth={currentUser:user('buyer'),authStateReady:async()=>{},onIdTokenChanged(next){const fn=typeof next==='function'?next:next.next.bind(next);listeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>listeners.delete(fn);}};window.__homesSwitchAccount=uid=>{auth.currentUser=user(uid);listeners.forEach(fn=>fn(auth.currentUser));};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
const requests=[],errors=[],checks=[];let enquiry=null,failSave=false,failPhoto=false,photoUnavailable=true,reviewed=false,holdMine=null,catalogPaging=false;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/kcAAAAASUVORK5CYII=','base64');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:467,height:850},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/src/firebase.ts')return route.fulfill({contentType:'text/javascript',body:authFixture});
  if(url.pathname==='/images/home-fixture.jpg')return route.fulfill({contentType:'image/png',body:png});
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let payload;try{payload=req.postDataJSON();}catch{}
  requests.push({path:url.pathname,query:url.search,method:req.method(),payload,headers:req.headers()});let data={items:[]};
  if(url.pathname.endsWith('/homes/catalog'))data={items:[home],next_cursor:catalogPaging&&!url.searchParams.get('cursor')?'page-two':null};
  else if(url.pathname.endsWith('/homes/mine')){if(holdMine)await holdMine;data={items:req.headers().authorization==='Bearer buyer'?[{...home,title:'Private owner draft',status:'pending_review'}]:[]};}
  else if(url.pathname.endsWith('/enquiry')){enquiry={id:'enquiry-one',title:home.title,state:'requested',version:1,is_owner:false,viewing_at:payload.viewing_at,messages:[{side:'customer',text:payload.message,at:Date.now()/1000}]};data=enquiry;}
  else if(url.pathname.endsWith('/homes/enquiries'))data={items:enquiry?[enquiry]:[]};
  else if(url.pathname.endsWith('/homes/photos')){if(failPhoto){failPhoto=false;return route.abort('failed');}data={id:'photo-new'};}
  else if(url.pathname.includes('/admin/homes/photos/')){if(photoUnavailable)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'Photo temporarily unavailable.'}})});return route.fulfill({contentType:'image/png',body:png});}
  else if(url.pathname.endsWith('/admin/homes'))data={items:reviewed?[]:[{...home,status:'pending_review'}]};
  else if(url.pathname.endsWith('/review')){reviewed=true;data={...home,status:payload.decision};}
  else if(url.pathname.includes('/homes/listings/')&&req.method()==='PUT'){if(failSave){failSave=false;return route.abort('failed');}data={...home,...payload,status:'pending_review'};}
  else if(url.pathname.includes('/homes/listings/')&&req.method()==='GET'){if(!url.pathname.endsWith(home.id))return route.fulfill({status:404,contentType:'application/json',body:'{}'});data=home;}
  else if(url.pathname.endsWith('/customer-hub/activity'))data={items:[],scope:'Fixture activity scope'};
  else if(url.pathname.endsWith('/customer-hub/saved'))data=req.method()==='POST'?{id:'saved'}:{items:[]};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/tests/homes-preview.html');await page.getByRole('button',{name:'Homes',exact:true}).click();await page.getByRole('heading',{name:home.title,exact:true}).waitFor();
 for(const width of [320,467]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${out}/browse-${width}.png`,fullPage:true});}
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 const accessibility=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('.homes-panel'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)}));});assert.deepEqual(accessibility,[]);
 checks.push('Rental type switch and home catalogue fit 320px and 467px screens; catalogue passes WCAG A/AA checks');
 await Promise.all([page.waitForRequest(r=>r.url().endsWith('/customer-hub/saved')&&r.method()==='POST'),page.getByRole('button',{name:'Save home',exact:true}).click()]);assert(requests.some(x=>x.payload?.kind==='home'));
 await page.getByRole('button',{name:'Details & viewing',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Propose a viewing (your local time)').fill('2026-12-01T14:00');
 await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await page.getByText('requested ·',{exact:false}).waitFor();
 assert(enquiry&&enquiry.viewing_at>0);assert.equal(requests.filter(x=>x.path.endsWith('/enquiry')).length,1);assert(requests.find(x=>x.path.endsWith('/enquiry')).payload.request_id);
 checks.push('A simultaneous double submission creates one dated viewing request and opens its private enquiry');
 await page.getByRole('button',{name:'My properties',exact:true}).click();await page.getByRole('button',{name:'List a home',exact:true}).click();
 async function fillListing(){
  await dialog.getByLabel('Listing title').fill('Bright house near the park');await dialog.getByLabel('City',{exact:true}).fill('Balasore');await dialog.getByLabel('Locality',{exact:true}).fill('Station Road');await dialog.getByLabel('Monthly rent (₹)').fill('12000');await dialog.getByLabel('Available from').fill('2026-11-01');await dialog.getByLabel('Amenities, costs & terms').fill('Two bedrooms, parking and a balcony. Maintenance charges extra.');await dialog.getByLabel('Property photo · JPG/PNG, up to 5 MB').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});await dialog.getByRole('checkbox').check();
 }
 await fillListing();await page.setViewportSize({width:320,height:850});assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:out+'/listing-form.png',fullPage:true});
 failSave=true;await dialog.getByRole('button',{name:'Submit for review',exact:true}).click();await dialog.getByRole('alert').waitFor();
 await dialog.getByRole('button',{name:'Submit for review',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const puts=requests.filter(x=>x.method==='PUT');assert.equal(puts.length,2);assert.deepEqual(puts[0].payload,puts[1].payload);assert.equal(puts[0].path,puts[1].path);assert.equal(puts[0].payload.rent_paise,1200000);assert.equal(puts[0].payload.authority_confirmed,true);assert.equal(requests.filter(x=>x.path.endsWith('/homes/photos')).length,1);
 checks.push('Failed listing-save retry reuses the uploaded photo, listing ID and unchanged integer-paise payload');
 await page.getByRole('button',{name:'List a home',exact:true}).click();await fillListing();failPhoto=true;await dialog.getByRole('button',{name:'Submit for review',exact:true}).click();await dialog.getByRole('alert').waitFor();await dialog.getByRole('button',{name:'Submit for review',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const photos=requests.filter(x=>x.path.endsWith('/homes/photos'));assert.equal(photos[1].headers['x-upload-id'],photos[2].headers['x-upload-id']);
 checks.push('An uncertain photo-upload retry retains its upload ID');
 await page.getByRole('button',{name:'List a home',exact:true}).click();await dialog.getByLabel('Listing title').fill('Private unfinished draft');
 await page.evaluate(()=>window.__homesSwitchAccount('other'));await dialog.waitFor({state:'hidden'});await page.getByRole('heading',{name:home.title,exact:true}).waitFor();assert.equal(await page.getByText('Private owner draft',{exact:true}).count(),0);
 await page.getByRole('button',{name:'My properties',exact:true}).click();await page.getByText('No homes in this view yet.',{exact:false}).waitFor();
 checks.push('Account changes immediately discard private owner data and unfinished property forms');
 await page.evaluate(()=>window.__homesSwitchAccount('buyer'));await page.getByRole('heading',{name:home.title,exact:true}).waitFor();
 let releaseMine;holdMine=new Promise(resolve=>releaseMine=resolve);const mineRequest=page.waitForRequest(r=>r.url().endsWith('/homes/mine'));await page.getByRole('button',{name:'My properties',exact:true}).click();await mineRequest;
 await page.evaluate(()=>window.__homesSwitchAccount('other'));releaseMine();holdMine=null;await page.getByRole('heading',{name:home.title,exact:true}).waitFor();assert.equal(await page.getByText('Private owner draft',{exact:true}).count(),0);
 checks.push('A late private response cannot restore data after an account switch');
 catalogPaging=true;await page.getByLabel('City',{exact:true}).fill('Balasore');await page.getByRole('button',{name:'Find homes',exact:true}).click();await page.getByRole('button',{name:'Show more homes',exact:true}).waitFor();await page.getByLabel('City',{exact:true}).fill('Unsubmitted city');await page.getByRole('button',{name:'Show more homes',exact:true}).click();await page.getByRole('button',{name:'Show more homes',exact:true}).waitFor({state:'hidden'});assert.equal(new URLSearchParams(requests.filter(x=>x.path.endsWith('/homes/catalog')).at(-1).query).get('city'),'Balasore');assert.equal(await page.getByRole('heading',{name:home.title,exact:true}).count(),1);catalogPaging=false;
 checks.push('Pagination retains submitted filters and deduplicates overlapping records');
 await page.goto(origin+'/tests/homes-preview.html?listing='+home.id);await dialog.waitFor();assert.equal(await dialog.getByRole('heading',{name:home.title,exact:true}).count(),1);await dialog.getByRole('button',{name:'View my enquiries',exact:true}).click();await page.getByRole('button',{name:'My enquiries',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'My enquiries',exact:true}).getAttribute('aria-pressed'),'true');
 await page.goto(origin+'/tests/homes-preview.html?listing=unavailable');await page.getByText('This property is no longer available. Browse current homes below.',{exact:true}).waitFor();assert.equal(await dialog.count(),0);
 checks.push('Public saved-home links open details and unavailable homes show a recovery message');
 await page.goto(origin+'/tests/homes-preview.html?admin=1');await page.getByRole('button',{name:'Review property',exact:true}).click();await dialog.getByRole('button',{name:'Retry photo',exact:true}).waitFor();assert(await dialog.getByRole('button',{name:'Save review',exact:true}).isDisabled());
 photoUnavailable=false;await dialog.getByRole('button',{name:'Retry photo',exact:true}).click();await dialog.getByRole('img',{name:'Property photo for moderation',exact:true}).waitFor();await dialog.getByLabel('Review findings').fill('Reviewed the photo, locality, pricing and listing description.');await dialog.getByRole('button',{name:'Save review',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(requests.filter(x=>x.path.endsWith('/review')).length,1);
 checks.push('Moderation blocks publication until the authenticated photo is decoded and supports photo retry');
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({checks,errors,network:'UI uses fixtures; domain HTTP tests run separately'},null,2));console.log(JSON.stringify({out,checks}));
}finally{await browser.close();}
