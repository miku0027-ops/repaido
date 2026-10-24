import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require('/opt/codex/runtimes/cua/lib/node_modules/playwright');
const work=await mkdtemp('/tmp/repaido-service-places-'),checks=[],errors=[];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  window.placeFixture={calls:[],maps:[],details:[],reverse:[],missingCity:false,fail:false,delay:0};const f=window.placeFixture;
  const coord={lat:21.491,lng:86.914},components=[{types:['locality'],longText:'Balasore'},{types:['postal_code'],longText:'756001'}];
  window.google={maps:{Map:class{constructor(el,options){this.el=el;el.dataset.map='fixture';this.center=options.center;this.listeners={};f.maps.push(this);}addListener(name,fn){this.listeners[name]=fn;return{remove:()=>delete this.listeners[name]};}getCenter(){return {lat:()=>this.center.lat,lng:()=>this.center.lng};}setCenter(p){this.center=p;}panTo(p){this.center=p;}fitBounds(){}},LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},OverlayView:class{setMap(m){this.map=m;if(m){this.onAdd();this.draw();}else this.onRemove();}getPanes(){return {overlayMouseTarget:this.map.el};}getProjection(){return {fromLatLngToDivPixel:p=>{f.projected=p;return{x:145,y:130};}};}},Marker:class{constructor(options){this.position=options.position;}setMap(){}},Polyline:class{setMap(){}},SymbolPath:{CIRCLE:0},LatLngBounds:class{extend(){}},event:{trigger(){}},Geocoder:class{async geocode({location}){f.reverse.push(location);if(f.fail)throw Error('REQUEST_DENIED');return{results:[{formatted_address:'Station Road, Balasore, Odisha, India',geometry:{location:{lat:()=>50,lng:()=>50}},address_components:[{types:['locality'],long_name:'Balasore'}]}]};}},async importLibrary(){return {AutocompleteSessionToken:class{},AutocompleteSuggestion:{async fetchAutocompleteSuggestions(request){f.calls.push(request);const delay=f.delay;if(delay)await new Promise(r=>setTimeout(r,delay));if(f.fail)throw Error('disabled');if(request.input==='nothing')return {suggestions:[]};return {suggestions:[{placePrediction:{placeId:'iti-square',mainText:{text:request.input==='old'?'Old result':'ITI Square'},secondaryText:{text:'Balasore, Odisha, India'},distanceMeters:280,toPlace(){return {async fetchFields(fields){f.details.push(fields);if(f.delay)await new Promise(r=>setTimeout(r,f.delay));this.location={lat:()=>coord.lat,lng:()=>coord.lng};this.formattedAddress='ITI Square, Balasore, Odisha, India';this.displayName='ITI Square';this.addressComponents=f.missingCity?[]:components;}};}}}]};}}};}}};
 });
 await context.addInitScript(()=>localStorage.setItem('repaido.token','isolated-test-token'));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();if(url.pathname.startsWith('/api/'))return route.fulfill({json:url.pathname.endsWith('/shop/me')?{shop:null}:{}});return route.continue();});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5187/tests/location-lifecycle-preview.html');
 const open=()=>page.getByRole('button',{name:'Open first address',exact:true}).click();
 const dialog=page.getByRole('dialog'),search=dialog.getByRole('combobox'),confirm=dialog.getByRole('button',{name:'Confirm this location',exact:true});
 await open();await search.fill('ITI');await page.getByRole('option',{name:/ITI Square/}).waitFor();
 assert.equal(await confirm.isDisabled(),true);await search.press('ArrowDown');await search.press('Enter');
 await page.waitForFunction(()=>document.querySelector('input[autocomplete="street-address"]')?.value==='ITI Square, Balasore, Odisha, India');
 assert.equal(await dialog.getByLabel('City',{exact:true}).inputValue(),'Balasore');assert.equal(await confirm.isDisabled(),true);
 assert.deepEqual(await page.evaluate(()=>window.placeFixture.maps.at(-1).center),{lat:21.491,lng:86.914});
 await dialog.getByRole('checkbox').check();await confirm.click();await dialog.waitFor({state:'detached'});
 assert.deepEqual(JSON.parse(await page.getByLabel('Saved location').textContent()),{lat:21.491,lng:86.914,address:'ITI Square, Balasore, Odisha, India',city:'Balasore'});
 checks.push('Keyboard selection fills the service address, city and exact pin; explicit entrance confirmation saves them together.');
 await open();await page.evaluate(()=>{window.placeFixture.delay=650;});await search.fill('old');await page.waitForFunction(()=>window.placeFixture.calls.some(c=>c.input==='old'));
 await page.evaluate(()=>window.placeFixture.delay=0);await search.fill('new');await page.getByRole('option',{name:/ITI Square/}).waitFor();await page.waitForTimeout(700);
 assert.equal(await page.getByRole('option',{name:/Old result/}).count(),0);checks.push('A late old suggestion cannot replace the latest query.');
 await page.evaluate(()=>window.placeFixture.delay=650);await page.getByRole('option',{name:/ITI Square/}).click();
 await page.evaluate(()=>window.placeFixture.delay=0);await page.evaluate(()=>window.placeFixture.maps.at(-1).listeners.click({latLng:{lat:()=>21.51,lng:()=>86.93}}));
 await page.waitForFunction(()=>document.querySelector('input[autocomplete="street-address"]')?.value==='Station Road, Balasore, Odisha, India');await page.waitForTimeout(700);
 assert.equal(await dialog.getByLabel('House, street and landmark',{exact:true}).inputValue(),'Station Road, Balasore, Odisha, India');
 await confirm.click();await dialog.waitFor({state:'detached'});assert.deepEqual(JSON.parse(await page.getByLabel('Saved location').textContent()),{lat:21.51,lng:86.93,address:'Station Road, Balasore, Odisha, India',city:'Balasore'});
 checks.push('A map adjustment supersedes pending place details and preserves the exact point rather than geocoder centroid.');
 await open();await page.evaluate(()=>{window.placeFixture.fail=true;});await search.fill('failure');await page.getByText('Place search couldn’t connect. Retry or use the map.',{exact:true}).waitFor();
 await page.evaluate(()=>{window.placeFixture.fail=false;});await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('option',{name:/ITI Square/}).waitFor();
 await search.fill('nothing');await page.getByText('No places found. Try a nearby street or landmark.',{exact:true}).waitFor();assert.equal(await confirm.isDisabled(),true);
 checks.push('Provider failures recover on retry; empty results never fabricate or confirm a location.');
 await search.fill('ITI');await page.getByRole('option',{name:/ITI Square/}).waitFor();
 await page.addScriptTag({path:process.cwd()+'/web/node_modules/axe-core/axe.min.js'});
 for(const width of [320,490])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const violations=await page.evaluate(async()=>(await window.axe.run('.place-search',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})));
  assert.deepEqual(violations,[],JSON.stringify({width,scale,violations}));
 }
 checks.push('Search passes WCAG AA checks at 320/490px and 100/200% text.');
 await page.setViewportSize({width:490,height:850});await page.evaluate(()=>document.documentElement.style.fontSize='100%');await dialog.screenshot({path:work+'/service-search.png'});
 await page.evaluate(()=>window.placeFixture.delay=650);await search.fill('close');await page.waitForFunction(()=>window.placeFixture.calls.some(c=>c.input==='close'));await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Open second address',exact:true}).click();await page.waitForTimeout(700);
 assert.equal(await dialog.getByLabel('House, street and landmark',{exact:true}).inputValue(),'Second house, Market Road');assert.equal(await page.getByRole('option').count(),0);
 checks.push('Closing and reopening in another city cancels the old session and keeps the supplied address.');

 await page.goto('http://127.0.0.1:5187/tests/location-lifecycle-preview.html?view=shop');
 const shopSearch=page.getByRole('combobox',{name:'Find shop address'});await shopSearch.fill('ITI');await page.getByRole('option',{name:/ITI Square/}).click();
 await page.waitForFunction(()=>document.querySelector('textarea[name="address"]')?.value==='ITI Square, Balasore, Odisha, India');
 assert.equal(await page.getByLabel('City',{exact:true}).inputValue(),'Balasore');assert.equal(await page.getByLabel('Postal code',{exact:true}).inputValue(),'756001');
 assert.equal(await page.getByLabel('Latitude',{exact:true}).inputValue(),'21.491');assert.equal(await page.getByLabel('Longitude',{exact:true}).inputValue(),'86.914');
 checks.push('The actual shop registration form receives address, city, postal code and coordinates from one selection.');
 await page.goto('http://127.0.0.1:5187/tests/location-lifecycle-preview.html?view=private');
 await page.getByRole('combobox',{name:'Find private work address'}).fill('ITI');await page.getByRole('option',{name:/ITI Square/}).click();
 await page.waitForFunction(()=>document.querySelector('input[name="site"]')?.value==='ITI Square, Balasore, Odisha, India');
 checks.push('The private project form stores the selected site in its existing private address field.');
 assert.deepEqual(errors,[]);await writeFile(work+'/report.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,work}));
}finally{await browser.close();}
