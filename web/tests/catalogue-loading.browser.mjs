import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Exercise the real customer app, with catalogue fixtures only at the API boundary.
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:5186';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Use a local preview');
const output=await mkdtemp(resolve(tmpdir(),'repaido-catalogue-loading-'));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--disable-dev-shm-usage']});
const errors=[],unexpectedRequests=[],variants=[],sidebarChecks=[];
const fixture={id:'catalogue-retry-fixture',name:'Fixture live inspection',category:'plumber',description:'Returned only by this isolated catalogue fixture.',price_paise:19900,duration_minutes:45,included:['Listed inspection scope'],excluded:['Replacement parts']};
let mode='failure',release;
let gate=new Promise(resolve=>{release=resolve;});
let catalogueRequests=0;
try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/@vite/client'){
      const response=await route.fetch();
      return route.fulfill({response,body:'class PreviewSocket{addEventListener(){} removeEventListener(){} send(){} close(){}}\n'+(await response.text()).replaceAll('new WebSocket(', 'new PreviewSocket(')});
    }
    if(url.pathname==='/api/catalog'){
      catalogueRequests++;
      const requestMode=mode,requestGate=gate;
      if(requestGate)await requestGate;
      return requestMode==='failure'?route.fulfill({status:503,json:{detail:'Isolated catalogue outage'}}):route.fulfill({json:{categories:[{id:'plumber',name:'Plumbing'}],services:requestMode==='empty'?[]:[fixture]}});
    }
    if(url.pathname==='/api/operations/campaigns/feed')return route.fulfill({json:{cards:[],rotation_seconds:60}});
    if(url.pathname==='/api/operations/discovery/feed')return route.fulfill({json:{cards:[],personalised:false,covered:false,basis:'No fixture suggestions'}});
    if(url.pathname==='/api/operations/hiring/leaderboard')return route.fulfill({json:{professionals:[],categories:[],total:0}});
    if(url.pathname.startsWith('/api/')){
      unexpectedRequests.push(url.pathname);
      return route.fulfill({status:503,json:{detail:'No fixture for this request'}});
    }
    return route.continue();
  });
  const page=await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/?tab=explore');
  const notice=page.locator('.catalogue-state');
  await notice.getByText('Loading live services…',{exact:true}).waitFor();
  assert.equal(await notice.getAttribute('role'),'status');
  assert.equal(await page.locator('.service-preview-accordion,.uc-service-card').count(),0,'Pending requests must not fabricate catalogue inventory');
  release();gate=null;
  await notice.getByRole('button',{name:'Retry loading services',exact:true}).waitFor();
  assert.equal(await notice.getAttribute('role'),'alert');
  await page.addScriptTag({path:resolve(dirname(fileURLToPath(import.meta.url)),'../node_modules/axe-core/axe.min.js')});
  const navigate=async tab=>{
    const desktop=(await page.viewportSize()).width>=1024;
    const label=desktop?({Services:'All Services',Bookings:'My Bookings'}[tab]||tab):tab;
    await page.locator(desktop?'.desktop-sidebar-nav':'.android-bottom-nav').getByRole('button',{name:label,exact:true}).click();
  };
  for(const tab of ['Explore','Services']){
    await navigate(tab);
    for(const width of [320,1440])for(const text of [100,200])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:844});
      await page.evaluate(({text,theme})=>{document.documentElement.style.fontSize=text+'%';document.documentElement.dataset.theme=theme;},{text,theme});
      await notice.scrollIntoViewIfNeeded();
      const layout=await notice.evaluate(node=>({overflow:node.scrollWidth>node.clientWidth+1,documentOverflow:document.documentElement.scrollWidth>innerWidth+1,targetHeight:node.querySelector('button').getBoundingClientRect().height}));
      assert.equal(layout.overflow,false,`${tab} ${width}/${text}/${theme}: notice overflow`);
      assert.equal(layout.documentOverflow,false,`${tab} ${width}/${text}/${theme}: document overflow`);
      assert(layout.targetHeight>=44,'Retry must retain a usable touch target');
      const violations=await page.evaluate(async()=>(await window.axe.run('.catalogue-state',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
      assert.deepEqual(violations,[],`${tab} ${width}/${text}/${theme}: accessibility`);
      assert.equal(await page.locator('.service-preview-accordion,.uc-service-card').count(),0,'Failed requests must not substitute seed services');
      variants.push({tab,width,text,theme,...layout});
      if(width===1440){
        const sidebar=page.locator('.desktop-sidebar-nav');
        const geometry=await sidebar.evaluate(node=>({height:node.clientHeight,scrollHeight:node.scrollHeight,buttons:[...node.querySelectorAll(':scope > button')].map(button=>{const r=button.getBoundingClientRect();return{label:button.textContent.trim(),top:r.top,bottom:r.bottom,height:button.clientHeight,contentHeight:button.scrollHeight};})}));
        sidebarChecks.push({tab,text,theme,...geometry});
        for(const [i,button] of geometry.buttons.entries()){
          if(i)assert(geometry.buttons[i-1].bottom<=button.top+1,'Sidebar button bounds overlap: '+button.label);
          assert(button.contentHeight<=button.height+1,'Sidebar label overflows its button: '+button.label);
        }
        await sidebar.getByRole('button',{name:'Notifications',exact:true}).scrollIntoViewIfNeeded();
        assert(await sidebar.getByRole('button',{name:'Notifications',exact:true}).evaluate(button=>{const r=button.getBoundingClientRect(),s=button.closest('aside').getBoundingClientRect();return r.top>=s.top-1&&r.bottom<=Math.min(s.bottom,innerHeight)+1;}),'Remaining sidebar links must be reachable by scrolling');
        if(text===200)assert(geometry.scrollHeight>geometry.height,'Large labels should use the sidebar scroll area');
      }
    }
  }
  // Keep enlarged text active while using desktop navigation; no click workaround.
  await navigate('Bookings');
  await page.getByRole('heading',{name:'Sign in to view your bookings',exact:true}).waitFor();
  await navigate('Services');
  await notice.getByRole('button',{name:'Retry loading services',exact:true}).waitFor();
  await page.screenshot({path:output+'/desktop-sidebar-large-text.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{document.documentElement.style.fontSize='100%';document.documentElement.dataset.theme='light';});
  await page.screenshot({path:output+'/catalogue-error-mobile.png',fullPage:true});
  // The catalogue error belongs to its screen and must not leak into sign-in.
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const auth=page.getByRole('dialog');
  await auth.waitFor();
  assert.equal(await auth.getByText('Service prices could not load. Please check your connection and retry.',{exact:true}).count(),0);
  await page.keyboard.press('Escape');
  const beforeRetry=catalogueRequests;
  mode='success';gate=new Promise(resolve=>{release=resolve;});
  await notice.getByRole('button',{name:'Retry loading services',exact:true}).click();
  await notice.getByText('Loading live services…',{exact:true}).waitFor();
  assert.equal(await page.locator('.uc-service-card').count(),0);
  release();gate=null;
  await page.getByRole('heading',{name:fixture.name,exact:true}).waitFor();
  assert(catalogueRequests>beforeRetry,'Retry must issue a new catalogue request');
  assert.equal(await notice.count(),0,'Successful recovery must clear the error');
  assert.equal(await page.locator('.uc-service-card').count(),1,'Only the server-returned service should appear');
  await navigate('Explore');
  await page.locator('.service-preview-accordion').filter({hasText:fixture.name}).waitFor();
  assert.equal(await page.locator('.service-preview-accordion').count(),1,'Home must share the recovered live catalogue');
  await page.screenshot({path:output+'/catalogue-recovered-mobile.png',fullPage:true});
  // An empty success is a real empty catalogue rather than an outage or a fallback.
  mode='empty';
  await page.goto(origin+'/?tab=explore');
  await notice.getByText('No services are currently listed.',{exact:true}).waitFor();
  assert.equal(await notice.getAttribute('role'),'status');
  assert.equal(await page.locator('.service-preview-accordion,.uc-service-card').count(),0);
  await navigate('Services');
  await notice.getByText('No services are currently listed.',{exact:true}).waitFor();
  mode='success';
  await notice.getByRole('button',{name:'Refresh services',exact:true}).click();
  await page.getByRole('heading',{name:fixture.name,exact:true}).waitFor();
  assert.equal(await notice.count(),0);
  assert.deepEqual(errors,[]);
  assert.deepEqual(unexpectedRequests,[]);
  await writeFile(output+'/report.json',JSON.stringify({passed:true,catalogueRequests,variants,sidebarChecks,errors,unexpectedRequests},null,2));
  console.log(JSON.stringify({passed:true,checks:variants.length,catalogueRequests,report:output+'/report.json'}));
}catch(error){
  await writeFile(output+'/report.json',JSON.stringify({passed:false,error:String(error),catalogueRequests,variants,sidebarChecks,errors,unexpectedRequests},null,2));
  throw error;
}finally{await browser.close();}
