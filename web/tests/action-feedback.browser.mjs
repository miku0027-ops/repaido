import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const evidence=await mkdtemp(tmpdir()+'/repaido-feedback-');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const base=process.env.FEEDBACK_PREVIEW||'http://127.0.0.1:5187/tests/feedback-preview.html';
const checks=[],errors=[];
let photoCalls=0,listingCalls=0,decisionCalls=0,profileFails=false;
let rows=[];
let hire={id:'hire-one',version:1,state:'quoted',worker_id:'professional',worker_name:'Test professional',category:'Cleaning',starts_at:new Date(Date.now()+86400000).toISOString(),notes:'Fixture cleaning request',bonus_paise:0,quote:{base_paise:49900,travel_paise:2000,gst_paise:0,total_paise:51900,outbound_metres:1000,return_metres:1000}};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const page=await browser.newPage({viewport:{width:465,height:850},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname;
  if(u.hostname!=='127.0.0.1')return route.abort();
  if(!p.startsWith('/api/'))return route.continue();
  if(p.endsWith('/market/eligibility'))return route.fulfill({json:{second_hand:true,exchange:true}});
  if(p.endsWith('/market/mine'))return route.fulfill({json:{listings:rows}});
  if(p.endsWith('/market/photos')){photoCalls++;await wait(900);return photoCalls===1?route.fulfill({status:503,json:{detail:'Photo upload interrupted. Please retry.'}}):route.fulfill({json:{id:'saved-photo'}});}
  if(p.endsWith('/market/listings')){listingCalls++;await wait(1100);if(listingCalls===1)return route.fulfill({status:422,json:{detail:'Please review the listing condition.'}});const body=req.postDataJSON();rows=[{...body,id:'saved-listing',image_url:'',status:'published',fee_status:'free_trial'}];return route.fulfill({json:rows[0]});}
  if(p.endsWith('/hiring/requests'))return route.fulfill({json:{requests:[hire]}});
  if(p.endsWith('/decision')){decisionCalls++;await wait(1000);if(decisionCalls===1)return route.fulfill({status:409,json:{detail:'The quote changed. Review it before confirming.'}});hire={...hire,state:'cancelled',version:2};return route.fulfill({json:hire});}
  if(p.endsWith('/profile')){await wait(900);return profileFails?route.fulfill({status:422,json:{detail:'Please correct the profile details.'}}):route.fulfill({json:{saved:true}});}
  return route.fulfill({json:{}});
 });
 const stack=page.locator('.app-feedback-stack');
 const dismiss=async()=>{while(await stack.getByRole('button',{name:'Dismiss notification'}).count())await stack.getByRole('button',{name:'Dismiss notification'}).first().click();};
 const layout=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No horizontal overflow');if(await stack.isVisible()){const b=await stack.boundingBox();assert(b.x>=0&&b.x+b.width<=await page.evaluate(()=>innerWidth)+1);assert(b.y>=0&&b.y+b.height<=await page.evaluate(()=>innerHeight)+1);}};
 await page.goto(base);const form=page.locator('form.market-form');await form.waitFor();
 assert(await form.getByRole('button',{name:'Publish listing',exact:true}).isDisabled());
 await form.getByLabel('Product photo',{exact:true}).setInputFiles({name:'test-photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
 await form.getByText('Photo selected',{exact:true}).waitFor();assert.equal(photoCalls,0,'Selection is not an upload');
 await form.getByRole('button',{name:'Publish listing',exact:true}).click();await stack.getByText('Check your details',{exact:true}).waitFor();assert.match(await stack.locator('.app-feedback-card p').textContent(),/^Product Name:/);assert.equal(await stack.locator('.app-feedback-card p').evaluate(el=>getComputedStyle(el).color),'rgb(225, 234, 255)');assert.equal(listingCalls,0);assert.equal(await form.locator('[name=name]').getAttribute('aria-invalid'),'true');
 await layout();await page.screenshot({path:evidence+'/validation-mobile.png'});await dismiss();
 for(const [name,value] of Object.entries({name:'Test appliance',brand:'Test brand',purchase:'5000',age:'12',year:'2025',condition:'Used appliance in working condition',warranty:'No warranty',reason:'Upgrading to another appliance'}))await form.locator(`[name=${name}]`).fill(value);
 await form.getByLabel('Selling Price (₹)',{exact:true}).fill('1500');await form.getByRole('checkbox').check();
 await form.getByRole('button',{name:'Publish listing',exact:true}).click();await stack.getByText('Uploading your file…',{exact:true}).waitFor();assert(await form.getByRole('button',{name:'Uploading photo…',exact:true}).isDisabled());
 await stack.getByText('Photo upload interrupted. Please retry.',{exact:true}).waitFor();assert.equal(await form.locator('[name=name]').inputValue(),'Test appliance');assert.equal(listingCalls,0);await dismiss();
 await form.getByRole('button',{name:'Publish listing',exact:true}).click();await form.getByText('Photo uploaded',{exact:true}).waitFor();await stack.getByText('Please review the listing condition.',{exact:true}).waitFor();assert.equal(await form.locator('[name=condition]').inputValue(),'Used appliance in working condition');await dismiss();
 await form.getByRole('button',{name:'Publish listing',exact:true}).click();await stack.getByText('Listing published',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(photoCalls,2,'Retry reuses a confirmed photo');assert.equal(listingCalls,2);await layout();await page.screenshot({path:evidence+'/listing-published-mobile.png'});checks.push('Selection, upload progress/failure/retry, saved photo reuse and listing completion visible after dialog closes');
 await page.goto(base+'?mode=hire');await page.getByRole('heading',{name:'Cleaning · Test professional'}).waitFor();
 await page.getByRole('button',{name:'Cancel request',exact:true}).click();await stack.getByText('Saving your decision…',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Cancel request',exact:true}).isDisabled());await stack.getByText('The quote changed. Review it before confirming.',{exact:true}).waitFor();assert.equal(await page.locator('.hire-role').textContent(),'quoted');await dismiss();
 await page.getByRole('button',{name:'Cancel request',exact:true}).click();await stack.getByText('Hire request cancelled',{exact:true}).waitFor();await page.locator('.action-inline-status').getByText('Request cancelled.',{exact:true}).waitFor();checks.push('Hiring decisions show pending, server rejection and persistent confirmed outcome');
 await page.goto(base+'?mode=controls');await page.getByRole('button',{name:'Open test form'}).click();await page.getByRole('button',{name:'Open nested form'}).click();profileFails=true;
 await page.getByRole('button',{name:'Save nested profile'}).click();await stack.getByText('Please correct the profile details.',{exact:true}).waitFor();assert.equal(await stack.evaluate(e=>e.closest('dialog')?.getAttribute('aria-label')),'Nested form');
 await dismiss();assert.equal(await page.getByRole('dialog').count(),2,'Dismissing feedback must not dismiss a form');profileFails=false;
 await page.getByRole('button',{name:'Save nested profile'}).click();await stack.getByText('Changes saved',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Nested form',exact:true}).waitFor({state:'detached'});await stack.getByText('Changes saved',{exact:true}).waitFor();assert.equal(await stack.evaluate(e=>e.closest('dialog')?.getAttribute('aria-label')),'Test form');await dismiss();assert.equal(await page.getByLabel('Preserved draft').inputValue(),'Keep these details');checks.push('Nested modal feedback is accessible, dismissible and survives closing the inner dialog without losing the draft');
 for(const [width,theme,scale] of [[320,'light',1],[320,'dark',2],[465,'light',2],[1440,'dark',1]]){
  await page.setViewportSize({width,height:900});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=16*scale+'px';},{theme,scale});
  await page.getByRole('button',{name:'Save profile',exact:true}).click();await stack.getByText('Changes saved',{exact:true}).waitFor();await layout();await page.addScriptTag({path:new URL('../node_modules/axe-core/axe.min.js',import.meta.url).pathname});const accessibility=await page.evaluate(async()=>{const result=await window.axe.run('.app-feedback-stack',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});assert.deepEqual(accessibility,[]);await page.screenshot({path:evidence+`/feedback-${width}-${theme}-${scale}.png`});await dismiss();
 }
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Add test spare'}).click();await stack.getByText('Added to cart',{exact:true}).waitFor();await dismiss();await page.getByRole('button',{name:'Add test spare'}).click();await dismiss();await page.getByRole('button',{name:'Add test spare'}).click();await stack.getByText('Available quantity reached',{exact:true}).waitFor();checks.push('Feedback fits small/large screens, dark theme and 200% text; cart confirmation distinguishes quantity limit');
 assert.deepEqual(errors,[]);await writeFile(evidence+'/report.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,evidence}));
}finally{await browser.close();}
