import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:5186';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const work=await mkdtemp('/tmp/repaido-ux-recovery-'),checks=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const width of [320,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  let catalogFails=true,commentsFail=true,olderCommentsFail=true,bookingWrites=0,queries=[];
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/@vite/client'){const response=await route.fetch();return route.fulfill({response,body:'class PreviewSocket {addEventListener(){} removeEventListener(){} send(){} close(){}}\n'+(await response.text()).replaceAll('new WebSocket(','new PreviewSocket(')});}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname.endsWith('/contractor/workspace'))return route.fulfill({json:{user_id:'ux-fixture',can_contract:true,profile:null,projects:[],tenders:[],server_time:Date.now()/1000}});
   if(url.pathname==='/api/catalog')return catalogFails?route.fulfill({status:503,json:{detail:'Catalogue offline'}}):route.fulfill({json:{services:[{id:'home-clean',name:'Home deep cleaning',category:'cleaning',price_paise:299900,included:['Floors'],excluded:['Parts']}]}});
   if(url.pathname.includes('/service-terms/'))return route.fulfill({json:{version:1,text:'Test scope'}});
   if(url.pathname.endsWith('/campaigns/selection'))return route.fulfill({json:{offer:null}});
   if(url.pathname.endsWith('/bookings')){bookingWrites++;return route.fulfill({status:503,json:{detail:'Booking unavailable. Please retry.'}});}
   if(url.pathname.includes('/comments/')){
    const older=!!url.searchParams.get('cursor');
    return commentsFail||older&&olderCommentsFail?route.fulfill({status:503,json:{detail:'Comments unavailable'}}):route.fulfill({json:{comments:[{id:older?'old':'c',authorId:'ux-fixture',text:older?'Earlier conversation':'Recovered conversation',createdAt:Date.now()}],members:[],nextCursor:older?null:'older'}});
   }
   if(url.pathname.endsWith('/work/jobs')){queries.push(url.searchParams.get('query'));return route.fulfill({json:{items:[],members:[],nextCursor:null,personalized:false,indexing:false}});}
   return route.fulfill({json:{}});
  });
  const open=async mode=>{await page.goto(origin+'/tests/ux-recovery-preview.html?mode='+mode);};
  await open('booking');
  await page.getByRole('button',{name:"Reload services"}).waitFor();
  assert.equal(await page.getByText('Loading services…',{exact:true}).count(),0,'Failed reads stop the loading message');
  catalogFails=false;await page.getByRole('button',{name:"Reload services"}).click();
  await page.getByRole('combobox').first().selectOption('home-clean');
  const date=page.getByLabel('Appointment date and time');
  await date.fill('2000-01-01T12:00');assert.equal(await date.evaluate(e=>e.validity.rangeUnderflow),true);
  await date.fill('2099-01-01T12:00');assert.equal(await date.evaluate(e=>e.validity.rangeOverflow),true);
  await date.fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
  await page.getByLabel('House number, street and landmark').fill('12 Test street, City centre');
  await page.getByText('Enter pin coordinates manually',{exact:true}).click();
  await page.getByLabel('Latitude',{exact:true}).fill('21.49');await page.getByLabel('Longitude',{exact:true}).fill('86.91');
  const phone=page.getByLabel('Contact number',{exact:true});await phone.fill('abcdefghij');
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:/^Request visit/}).click();
  assert.equal(bookingWrites,0);assert.equal(await phone.evaluate(e=>e.validity.customError),true);
  await phone.fill('+91 98765 43210');await page.getByRole('checkbox').check();await page.getByRole('button',{name:/^Request visit/}).click();
  await page.getByRole('alert').filter({hasText:'Booking unavailable'}).waitFor();
  assert.equal(bookingWrites,1);assert.equal(await page.getByRole('button',{name:"Reload services"}).count(),0);
  checks.push('Booking error recovery and date/phone validation at '+width);
  await open('contractor');await page.getByLabel('Project title').fill('Repair project');await page.getByRole('button',{name:"Save and continue"}).click();
  await page.getByText(/Your changes are saved/).waitFor();assert.equal(await page.getByLabel('Project title').isDisabled(),true);
  await page.getByRole('button',{name:"Reload page details"}).click();await page.getByRole('heading',{name:'Closed'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__uxCounts),{saves:1,refreshes:2});checks.push('Contractor refresh retry never repeats saved write at '+width);
  await open('comments');await page.getByRole('button',{name:'Retry comments'}).waitFor();
  await page.getByLabel('Your comment').fill('Keep my draft');commentsFail=false;await page.getByRole('button',{name:'Retry comments'}).click();
  await page.getByText('Recovered conversation').waitFor();assert.equal(await page.getByLabel('Your comment').inputValue(),'Keep my draft');
  await page.getByRole('button',{name:'Earlier comments'}).click();await page.getByRole('button',{name:'Retry comments'}).waitFor();olderCommentsFail=false;
  await page.getByRole('button',{name:'Retry comments'}).click();await page.getByText('Earlier conversation').waitFor();await page.getByText('Recovered conversation').waitFor();
  assert.equal(await page.getByLabel('Your comment').inputValue(),'Keep my draft');checks.push('Comments retry keeps draft and loaded history at '+width);
  await open('jobs');await page.getByRole('heading',{name:'My jobs',exact:true}).waitFor();
  await page.getByRole('searchbox').fill('no such job');await page.getByRole('button',{name:'Search jobs',exact:true}).click();
  await page.getByRole('button',{name:'Clear search & filters'}).click();await page.waitForFunction(()=>document.querySelector('input[type=search]').value==='');
  assert.equal(queries.includes('no such job'),true);checks.push('Job search empty state clears search and filters at '+width);
  await open('agent');await page.getByRole('button',{name:'Refresh task',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Task refresh interrupted'}).waitFor();
  await page.getByRole('button',{name:'Customer brief & PDF',exact:true}).click();await page.getByRole('dialog',{name:'Customer brief & PDF',exact:true}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Test repair',exact:true}).count(),1);
  checks.push('Agent refresh feedback and named brief dialog at '+width);
  await page.screenshot({path:work+'/agent-'+width+'.png'});
  await open('navigation');await page.getByRole('navigation',{name:'Worker navigation'}).waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.ops-bottom-nav button span').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1||n.getBoundingClientRect().height>parseFloat(getComputedStyle(n).lineHeight)+1)),false,'Normal-size agent labels stay whole');
  await page.screenshot({path:work+'/navigation-'+width+'.png'});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert.equal(await page.locator('.ops-bottom-nav button').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1)),false,'Large-text labels stay within their controls');
  checks.push('Readable agent navigation at '+width);
  await open('contractor-navigation');const contractorNav=page.getByRole('tablist',{name:'Contractor bottom navigation'});await contractorNav.waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await contractorNav.locator('button span').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1||n.getBoundingClientRect().height>parseFloat(getComputedStyle(n).lineHeight)*(n.textContent==='Work & market'?2:1)+1)),false,'Contractor labels wrap at words');
  await page.screenshot({path:work+'/contractor-navigation-'+width+'.png'});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await page.waitForFunction(()=>{const desk=document.querySelector('.contractor-app-desk'),nav=desk.querySelector('.contractor-bottom-nav');return parseFloat(getComputedStyle(desk).paddingBottom)>=nav.getBoundingClientRect().height+23;});
  assert.equal(await contractorNav.locator('button').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1)),false,'Contractor navigation fits enlarged text');
  checks.push('Readable contractor navigation with clearance for enlarged text at '+width);await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
}finally{await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();console.log(work);}
