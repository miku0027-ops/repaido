import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.BOOKING_UI_PREVIEW||'http://127.0.0.1:5186';
assert.equal(new URL(origin).hostname,'127.0.0.1','Use a local development server');
const evidence=await mkdtemp(tmpdir()+'/repaido-booking-ui-'),results=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
async function pageFor(width,reducedMotion='reduce'){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/catalog')return route.fulfill({json:{services:[{id:'home-clean',name:'Home deep cleaning',category:'cleaning',price_paise:299900,included:['Floors'],excluded:['Parts']}]}});
    if(url.pathname.startsWith('/api/operations/service-terms/'))return route.fulfill({json:{id:'home-clean',version:1,text:'Review the included work before requesting your visit.'}});
    if(url.pathname==='/api/operations/campaigns/selection')return route.fulfill({json:{offer:null}});
    return route.fulfill({json:{}});
  });
  return {context,page};
}
async function check(name,action){
  try{await action();results.push({name,passed:true});}
  catch(error){results.push({name,passed:false,error:String(error)});process.exitCode=1;}
}
try{
  for(const width of [390,1440]){
    await check('Map keeps address and city at '+width+'px',async()=>{
      const {context,page}=await pageFor(width);
      try{
        await page.goto(origin+'/tests/booking-ui-preview.html?mode=booking');
        const booking=page.getByRole('dialog',{name:'Plan your visit'});
        await booking.getByLabel('House number, street and landmark').fill('12 Existing Street, Balasore');
        await booking.getByRole('button',{name:'Set location on map',exact:true}).click();
        const map=page.getByRole('dialog',{name:'Confirm service location'});
        assert.equal(await map.getByLabel('House, street and landmark',{exact:true}).inputValue(),'12 Existing Street, Balasore');
        assert.equal(await map.getByLabel('City',{exact:true}).inputValue(),'Balasore');
        await map.getByLabel('House, street and landmark',{exact:true}).fill('45 New Street, Market Square');
        await map.getByLabel('City',{exact:true}).fill('Cuttack');
        await map.getByLabel('Latitude',{exact:true}).fill('20.4625');
        await map.getByLabel('Longitude',{exact:true}).fill('85.8830');
        await map.getByRole('button',{name:'Confirm this location',exact:true}).click();
        await map.waitFor({state:'hidden'});
        assert.equal(await booking.getByLabel('House number, street and landmark').inputValue(),'45 New Street, Market Square');
        await booking.getByText('Service city: Cuttack',{exact:true}).waitFor();
        await booking.getByRole('button',{name:'Set location on map',exact:true}).click();
        assert.equal(await map.getByLabel('House, street and landmark',{exact:true}).inputValue(),'45 New Street, Market Square');
        assert.equal(await map.getByLabel('City',{exact:true}).inputValue(),'Cuttack');
        await page.screenshot({path:evidence+'/booking-map-'+width+'.png'});
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog',{name:'Plan your visit'}).count(),1,'Closing the map preserves the booking');
      }finally{await context.close();}
    });
    for(const motion of ['reduce','no-preference'])await check('Slideshow navigation stays on the selected card at '+width+'px ('+motion+')',async()=>{
      const {context,page}=await pageFor(width,motion);
      try{
        await page.goto(origin+'/tests/booking-ui-preview.html');
        const counter=page.locator('.task-slide-counter'),rail=page.getByRole('region',{name:'Bookings slideshow'});
        await counter.getByText('Booking 1 of 5',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Booking 3: Fixture visit 3',exact:true}).click();await page.waitForTimeout(700);
        await counter.getByText('Booking 3 of 5',{exact:true}).waitFor();
        for(let index=0;index<2;index++){await page.getByRole('button',{name:'Previous booking card',exact:true}).click();await page.waitForTimeout(700);}
        await counter.getByText('Booking 1 of 5',{exact:true}).waitFor();
        for(let index=1;index<5;index++){
          await page.getByRole('button',{name:'Next booking card',exact:true}).click();
          await page.waitForTimeout(700);
          assert.equal((await counter.innerText()).split('·')[0].trim(),'Booking '+(index+1)+' of 5');
        }
        assert.equal(await page.getByRole('button',{name:'Next booking card',exact:true}).isDisabled(),true);
        await page.screenshot({path:evidence+'/booking-slideshow-'+width+'-'+motion+'.png'});
        await rail.focus();await page.keyboard.press('ArrowLeft');await page.waitForTimeout(700);
        await counter.getByText('Booking 4 of 5',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Booking 3: Fixture visit 3',exact:true}).click();await page.waitForTimeout(700);
        await counter.getByText('Booking 3 of 5',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Next booking card',exact:true}).click();await page.waitForTimeout(700);
        await counter.getByText('Booking 4 of 5',{exact:true}).waitFor();
      }finally{await context.close();}
    });
  }
  assert.deepEqual(errors,[],'No browser runtime errors');
}finally{
  await browser.close();await writeFile(evidence+'/report.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors,evidence},null,2));
}
