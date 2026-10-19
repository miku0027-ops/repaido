import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.CONTRACTS_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const authFixture=`export const auth={currentUser:null,authStateReady:async()=>{},onAuthStateChanged(callback){queueMicrotask(()=>callback(null));return()=>{};}};export const app={};export const db={};export const analytics=null;`;
const card=(id,title)=>({id,source:'contract',title,description:'Electrical installation',city:'Balasore',summaryOnly:true,budgetPaise:900000,action:{route:'custom_contracts'}});
const first=card('first','First city requirement'),late=card('late','Late previous page'),next=card('next','New city requirement'),fresh=card('fresh','Refreshed requirement');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];
async function open(handler){
 const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('repaido.token','first'));
 await context.route('**/src/firebase.ts',route=>route.fulfill({contentType:'text/javascript',body:authFixture}));
 await context.route('**/api/repaidians/opportunities**',handler);
 await context.routeWebSocket('**',socket=>socket.close());
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/contract-requirements-preview.html');
 return page;
}
const reply=(route,items,nextCursor=null,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({items,nextCursor})});
try{
 // A page requested for the previous city must never join the new city's list.
 let releaseOld,oldRequested=false;
 const cities=await open(async route=>{const url=new URL(route.request().url());if(url.searchParams.get('cursor')){oldRequested=true;await new Promise(resolve=>releaseOld=resolve);await reply(route,[late]);}else await reply(route,url.searchParams.get('city')==='Cuttack'?[next]:[first],url.searchParams.get('city')==='Cuttack'?null:'old-page');});
 await cities.getByRole('heading',{name:first.title,exact:true}).waitFor();await cities.getByRole('button',{name:'More requirements',exact:true}).click();
 await cities.waitForFunction(()=>document.querySelector('.contract-discovery').getAttribute('aria-busy')==='true');assert(oldRequested);
 await cities.getByRole('button',{name:'Switch city',exact:true}).click();await cities.getByRole('heading',{name:next.title,exact:true}).waitFor();releaseOld();await cities.waitForTimeout(150);
 assert.equal(await cities.getByRole('heading',{name:late.title,exact:true}).count(),0);assert.equal(await cities.getByRole('heading',{name:first.title,exact:true}).count(),0);await cities.context().close();
 // A visible list remains stable while a manual refresh is pending.
 let releaseRefresh,requests=0;
 const refresh=await open(async route=>{requests++;if(requests>1)await new Promise(resolve=>releaseRefresh=resolve);await reply(route,requests===1?[first]:[fresh]);});
 await refresh.getByRole('heading',{name:first.title,exact:true}).waitFor();await refresh.getByRole('button',{name:'Refresh contract requirements',exact:true}).click();
 await refresh.waitForFunction(()=>document.querySelector('.contract-discovery')?.getAttribute('aria-busy')==='true');assert.equal(await refresh.getByRole('heading',{name:first.title,exact:true}).count(),1);releaseRefresh();await refresh.getByRole('heading',{name:fresh.title,exact:true}).waitFor();await refresh.context().close();
 // Pagination and visibility refresh share a lock; an access loss retires all cards.
 let releasePage,pagePending=false,count=0;
 const access=await open(async route=>{count++;const url=new URL(route.request().url());if(url.searchParams.get('cursor')){pagePending=true;await new Promise(resolve=>releasePage=resolve);await reply(route,[],null,403);}else await reply(route,[first],'more');});
 await access.getByRole('heading',{name:first.title,exact:true}).waitFor();await access.getByRole('button',{name:'More requirements',exact:true}).click();await access.waitForFunction(()=>document.querySelector('.contract-discovery')?.getAttribute('aria-busy')==='true');assert(pagePending);
 await access.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await access.waitForTimeout(100);assert.equal(count,2,'Refresh overlapped pending pagination');releasePage();await access.getByRole('alert').waitFor();assert.equal(await access.getByRole('heading',{name:first.title,exact:true}).count(),0);await access.context().close();
 // Account changes immediately retire the old view while the new request waits.
 let releaseAccount;
 const accounts=await open(async route=>{if(route.request().headers().authorization==='Bearer second'){await new Promise(resolve=>releaseAccount=resolve);await reply(route,[next]);}else await reply(route,[first]);});
 await accounts.getByRole('heading',{name:first.title,exact:true}).waitFor();await accounts.getByRole('button',{name:'Switch account',exact:true}).click();assert.equal(await accounts.getByRole('heading',{name:first.title,exact:true}).count(),0);await accounts.waitForTimeout(100);releaseAccount();await accounts.getByRole('heading',{name:next.title,exact:true}).waitFor();
 await accounts.addScriptTag({path:resolve(web,'node_modules/axe-core/axe.min.js')});
 for(const width of [320,390,768])for(const theme of ['light','dark'])for(const scale of [100,200]){await accounts.setViewportSize({width,height:900});await accounts.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});assert.equal(await accounts.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const result=await accounts.evaluate(async()=>window.axe.run('.contract-discovery',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(result.violations.map(item=>item.id),[]);}
 await accounts.context().close();assert.deepEqual(errors,[]);
 console.log('PASS: stale city pages, stable manual refresh, serialized polling/pagination, access revocation, account isolation, 320–768px/200%/light-dark AA.');
}finally{await browser.close();}
