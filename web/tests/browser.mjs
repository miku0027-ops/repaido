import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
const failures=[];
await mkdir('test-results',{recursive:true});
const fillAddress=async(page)=>{
  await page.getByLabel('Full name',{exact:true}).fill('Preview Customer');
  await page.getByLabel('Mobile number',{exact:true}).fill('9876543210');
  await page.getByLabel('Flat, building & street',{exact:true}).fill('24 Palm Grove, 12th Main');
  await page.getByLabel('Area',{exact:true}).fill('Indiranagar');
  await page.getByLabel('PIN code',{exact:true}).fill('560038');
};
const noOverflow=async(page)=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Horizontal overflow at ${page.viewportSize().width}px`);
const chooseTime=async(page)=>{
  await page.locator('label').filter({has:page.locator('input[name="booking-day"]')}).nth(1).click();
  await page.locator('label').filter({has:page.locator('input[name="booking-time"]:not(:disabled)')}).first().click();
};
try {
  for(const width of [1440,768,390,320]){
    const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
    page.on('pageerror',e=>failures.push(e.message));
    await page.goto('http://127.0.0.1:5186/',{waitUntil:'networkidle'});
    await noOverflow(page);
    assert.equal(await page.locator('article').count(),19);
    for (const img of await page.locator('article img').all()) { await img.scrollIntoViewIfNeeded(); await img.evaluate(i=>i.decode()); }
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.ok(await page.locator('article img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)));
    await page.screenshot({path:`test-results/discovery-${width}.png`,fullPage:width===1440});
    if(width===768||width===320){await page.close();continue;}
    await page.getByRole('button',{name:'Add AC service & cleaning',exact:true}).click();
    await page.getByRole('button',{name:'Review 1 item added',exact:true}).waitFor();
    await page.getByRole('button',{name:'Choose date and address',exact:true}).click();
    await noOverflow(page);
    if(width<768){
      await page.getByRole('button',{name:'Next: choose date and time'}).click();
      await page.getByText('Please enter your full name.').waitFor();
      await fillAddress(page);
      await page.getByRole('button',{name:'Next: choose date and time'}).click();
      await chooseTime(page);
      await page.screenshot({path:`test-results/schedule-${width}.png`,fullPage:true});
      await page.getByRole('button',{name:'Review booking',exact:true}).click();
    }else{
      await page.getByRole('button',{name:'Finish sample booking'}).click();
      await page.getByText('Please enter your full name.').waitFor();
      await fillAddress(page);await chooseTime(page);
    }
    await page.getByRole('button',{name:'Add one AC service & cleaning'}).click();
    assert.equal(await page.getByTestId('invoice-total').innerText(),'₹1,413.64');
    await noOverflow(page);
    await page.screenshot({path:`test-results/checkout-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Finish sample booking'}).click();
    await page.getByRole('heading',{name:'Sample booking complete'}).waitFor();
    await page.getByText('No appointment has been booked and no payment has been taken.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Back to services'}).click();
    await page.getByRole('button',{name:'Review 2 items added'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Remove one AC service & cleaning'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Remove one AC service & cleaning'}).click();
    await page.getByRole('heading',{name:'Your booking is empty'}).waitFor();
    await page.getByRole('button',{name:'View services',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Choose date and address',exact:true}).isEnabled(),false);
    await page.getByRole('searchbox').fill('unavailable service');
    await page.getByRole('heading',{name:'No services found'}).waitFor();
    await page.getByRole('button',{name:'Show all services'}).click();
    await page.getByRole('button',{name:'What’s included in Plumbing repair visit'}).click();
    await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.close();
    console.log(`PASS: ${width}px booking flow, invoice, validation, quantities, empty states, modal keyboard dismissal`);
  }
  assert.deepEqual(failures,[]);
  console.log('PASS: image loading and overflow at 320, 390, 768, 1440px; no JavaScript runtime errors');
} finally {await browser.close();}
