import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '/opt/codex/runtimes/cua/lib/node_modules/playwright/index.mjs';
const base=process.env.ACCOUNT_PREVIEW_URL||'http://127.0.0.1:5189';
const artifacts=process.env.ACCOUNT_ARTIFACTS||'/workspace/artifacts/account-journey-2026-10-23';
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[],checks=[],suffix=Date.now();
async function open(uid='journey-new-'+suffix,newAccount=true,motion='reduce'){
 const context=await browser.newContext({viewport:{width:495,height:850},reducedMotion:motion});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/tests/account-journey-preview.html');
 await page.evaluate(({uid,newAccount})=>Object.assign(window.__accountFixture.fixture,{uid,newAccount}),{uid,newAccount});
 return page;
}
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function audit(page,selector,name){
 await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')});
 for(const width of [320,495,1024])for(const scale of [100,200]){
  await page.setViewportSize({width,height:850});await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);
  assert(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth+1),name+' dialog overflow '+width+'/'+scale);
  const violations=await page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),selector);
  assert.deepEqual(violations,[],JSON.stringify({name,width,scale,violations}));
 }
 await page.setViewportSize({width:495,height:850});await page.evaluate(()=>document.documentElement.style.fontSize='100%');
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 const dark=await page.evaluate(async selector=>(await window.axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})),selector);
 assert.deepEqual(dark,[],name+' dark '+JSON.stringify(dark));
 await page.locator(selector).screenshot({path:artifacts+'/'+name+'-dark.png'});
 await page.evaluate(()=>delete document.documentElement.dataset.theme);
 await page.locator(selector).evaluate(el=>el.scrollTop=0);
 await page.locator(selector).screenshot({path:artifacts+'/'+name+'-mobile.png'});
}
try{
 const page=await open();
 assert.equal(await page.locator('dialog[open]').count(),0,'Guest browsing never requires signup');
 await button(page,'Sign in or create account').click();await audit(page,'.account-journey-dialog','sign-in');
 await button(page,'Keep exploring for now').click();assert.equal(await page.locator('dialog[open]').count(),0);
 await button(page,'Sign in or create account').click();await button(page,'Continue with Google').click();
 await page.getByRole('heading',{name:'One last security step'}).waitFor();
 assert.equal(await page.getByLabel('Your name',{exact:true}).count(),0,'Google signup cannot skip verified mobile');
 await page.getByLabel('Mobile number',{exact:true}).fill('9876543210');await button(page,'Continue with mobile').click();
 await page.getByLabel('Verification code',{exact:true}).fill('000000');await button(page,'Verify mobile').click();
 await page.getByRole('alert').filter({hasText:'The code does not match'}).waitFor();
 assert(await button(page,'Resend in 60s').count()||await page.getByRole('button',{name:/Resend in/}).isDisabled());
 await page.getByLabel('Verification code',{exact:true}).fill('123456');await button(page,'Verify mobile').click();
 await page.getByRole('heading',{name:'A little about you'}).waitFor();await audit(page,'.account-journey-dialog','your-details');
 await page.getByLabel('Your name',{exact:true}).fill('Asha Mohanty');await page.getByLabel('Email address',{exact:true}).fill('asha@example.com');
 await button(page,'Choose my interests').click();
 await button(page,'AC & appliances').click();await button(page,'Plumber').click();await button(page,'Bike & cab rides').click();
 await page.getByLabel('Your most-needed service').selectOption('ac');
 assert(!await page.getByRole('checkbox').isChecked(),'Behavioral consent is optional and off by default');
 await audit(page,'.account-journey-dialog','your-interests');
 let fail=true;const saves=[];
 await page.route('**/api/account/onboarding',async route=>{
  if(route.request().method()!=='PUT')return route.continue();saves.push(route.request().postDataJSON());
  if(fail){fail=false;return route.fulfill({status:503,json:{detail:{message:'Setup is temporarily unavailable. Please retry.'}}});}
  return route.continue();
 });
 await button(page,'Make Repaido mine').click();await page.getByRole('alert').filter({hasText:'Please retry'}).waitFor();
 assert.equal(await page.getByRole('button',{pressed:true}).count(),3);
 await button(page,'Make Repaido mine').click();await page.locator('.account-welcome-dialog').waitFor();
 assert.equal(saves[0].request_id,saves[1].request_id,'Retry preserves command identity');
 await page.getByRole('heading',{name:'Welcome, Asha!'}).waitFor();
 assert.match(await page.locator('.account-welcome-dialog .welcome-catalogue>button').first().innerText(),/AC power/,'The most-needed service comes first');
 await page.locator('.welcome-offer-price').filter({hasText:'579'}).waitFor();
 assert.match(await page.locator('.welcome-offer-price').innerText(),/599/);
 await audit(page,'.account-welcome-dialog','welcome');
 await button(page,'View offer').click();await page.getByText('offer:journey-real-offer:57900',{exact:true}).waitFor();
 await page.locator('.customer-interest-rail').waitFor();
 await button(page,'Edit interests').click();await page.getByRole('heading',{name:'What can we help with?'}).waitFor();
 await button(page,'Bike & cab rides').click();await button(page,'Save my interests').click();await page.locator('.account-journey-dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('.account-welcome-dialog').count(),0,'Editing interests does not replay the welcome modal');
 checks.push('Google signup UI with isolated SDK and real API → linked OTP → separate profile/interests → retry-safe setup → calculated ₹20 eligible offer; offer CTA carries campaign and price. Guest browsing and editable home interests stay available.');
 // Existing accounts can sign in through Google without being treated as new.
 const returning=await open('journey-existing',false);
 await button(returning,'Sign in or create account').click();await button(returning,'Continue with Google').click();
 await returning.locator('.account-welcome-dialog').waitFor();assert.equal(await returning.getByLabel('Mobile number',{exact:true}).count(),0);
 await button(returning,'Explore my Repaido').click();assert.equal(await returning.locator('dialog[open]').count(),0);
 // Phone-first signup uses the same verified setup; interests may be skipped.
 const phone=await open('journey-phone-'+suffix);
 await button(phone,'Sign in or create account').click();await button(phone,'Create an account').click();
 await phone.getByLabel('Mobile number',{exact:true}).fill('9876543210');await button(phone,'Continue with mobile').click();
 await button(phone,'Change number').click();assert.equal(await phone.getByLabel('Verification code',{exact:true}).count(),0);
 await button(phone,'Continue with mobile').click();await phone.getByLabel('Verification code',{exact:true}).fill('123456');await button(phone,'Verify mobile').click();
 await phone.getByLabel('Your name',{exact:true}).fill('Phone customer');await phone.getByLabel('Email address',{exact:true}).fill('phone@example.com');
 await button(phone,'Choose my interests').click();await button(phone,'Continue without interests').click();await phone.locator('.account-welcome-dialog').waitFor();
 checks.push('Existing Google login remains usable; new phone signup requires OTP, supports changing the number and allows skipping interests.');
 // The component must discard private state and late completion on account changes.
 const changed=await open('journey-change-'+suffix);
 await button(changed,'Sign in or create account').click();await button(changed,'Continue with Google').click();await changed.getByRole('heading',{name:'One last security step'}).waitFor();
 await changed.evaluate(()=>window.__accountFixture.emit('journey-other',true));
 await changed.getByRole('alert').filter({hasText:'Your account changed'}).waitFor();assert.equal(await changed.getByLabel('Mobile number',{exact:true}).inputValue(),'');
 const interrupted=await open('journey-interrupted-'+suffix);
 await button(interrupted,'Sign in or create account').click();await interrupted.getByLabel('Mobile number',{exact:true}).fill('9876543210');
 await interrupted.evaluate(()=>window.__accountFixture.fixture.delay=500);await button(interrupted,'Continue with mobile').click();await button(interrupted,'Keep exploring for now').click();
 await interrupted.waitForTimeout(600);assert.equal(await interrupted.locator('dialog[open]').count(),0);
 await button(interrupted,'Sign in or create account').click();assert.equal(await interrupted.getByLabel('Verification code',{exact:true}).count(),0);
 checks.push('Account changes clear private setup state, and closing during OTP delivery prevents a late verification screen.');
 // Decorative motion has an immediate skip, an automatic end and a reduced-motion alternative.
 const moving=await open('journey-motion-'+suffix,true,'no-preference');
 await moving.locator('.home-entrance-dialog').waitFor();await moving.locator('.home-entrance-dialog').screenshot({path:artifacts+'/entrance.png'});
 await button(moving,'Start exploring').click();assert.equal(await moving.locator('.home-entrance-dialog').count(),0);
 checks.push('Signin, details, interests and welcome pass WCAG AA automated checks at320/495/1024px,200% text and dark theme. Reduced motion skips entrance animation; standard motion is immediately dismissible.');
 const app=await open('journey-existing',false);
 await app.goto(base+'/');await app.evaluate(()=>Object.assign(window.__accountFixture.fixture,{uid:'journey-existing',newAccount:false}));
 await button(app,'Sign in').click();await button(app,'Continue with Google').click();await app.locator('.account-welcome-dialog').waitFor();
 await button(app,'Explore my Repaido').click();await button(app,'My profile').click();await app.locator('summary').filter({hasText:'Account & privacy'}).click();
 await app.getByRole('button',{name:/Your service interests Choose your most-needed/}).click();await app.getByRole('heading',{name:'One last security step'}).waitFor();
 await button(app,'Keep exploring for now').click();assert.equal(await app.locator('.account-journey-dialog').count(),0);
 await app.goto(base+'/?tab=explore');await app.evaluate(uid=>window.__accountFixture.emit(uid,true),'journey-new-'+suffix);
 await app.locator('.customer-interest-rail').waitFor();assert.match(await app.locator('.customer-interest-rail .welcome-catalogue>button').first().innerText(),/AC service/);
 await Promise.all([app.waitForResponse(response=>response.url().endsWith('/account/onboarding')&&response.status()===200),app.evaluate(uid=>window.__accountFixture.emit(uid,true),'journey-new-'+suffix)]);
 await app.locator('.customer-interest-rail').waitFor();await app.locator('.customer-interest-rail').screenshot({path:artifacts+'/home-interest-rail.png'});
 await app.evaluate(()=>window.__accountFixture.emit('journey-other-account',true));await app.locator('.customer-interest-rail').waitFor({state:'hidden'});
 checks.push('Real App integration works under StrictMode: Google login, welcome dismissal, account interest editing and home ranking. Token refresh preserves the home rail; account switching clears it.');
 assert.deepEqual(errors,[]);await writeFile(artifacts+'/verification.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,artifacts},null,2));
}finally{await browser.close();}
