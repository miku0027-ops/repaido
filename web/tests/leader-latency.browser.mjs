import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--disable-dev-shm-usage']});
const base=process.env.DISCOVERY_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const category={id:'cleaning',name:'Home Cleaning',count:1,leader:{id:'fixture-worker',name:'Reviewed fixture professional',role:'technician'}};
const requests=[],errors=[];let catalogFinished=false;
try{
 const page=await browser.newPage({viewport:{width:390,height:850}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/catalog'){
   await new Promise(resolve=>setTimeout(resolve,1200));catalogFinished=true;
   return route.fulfill({json:{services:[],categories:[]}});
  }
  if(url.pathname==='/api/operations/hiring/leaderboard'){
   const body=route.request().postDataJSON();requests.push(body);
   if(body.category==='home:maid')return route.fulfill({json:{professionals:[{id:'fixture-worker',name:'Reviewed fixture professional',categories:['cleaning'],home_services:['maid'],role:'technician',category_records:[]}],total:1,categories:[category]}});
   assert.equal(body.summary_only,true,'The cold overview must not download forty rich profiles');
   return route.fulfill({json:{professionals:[],total:body.city==='Balasore'?1:0,categories:body.city==='Balasore'?[category]:[]}});
  }
  if(url.pathname.startsWith('/api/'))throw Error('Unexpected API request '+url.pathname);
  return route.continue();
 });
 await page.goto(base+'/tests/discovery-preview.html');
 await page.getByRole('navigation',{name:'Category leaderboards'}).waitFor();
 assert.equal(catalogFinished,false,'Real leader results must render without waiting for service catalogue hydration');
 const coldRequests=requests.length;assert.equal(coldRequests,1);
 await page.goto(base+'/tests/leader-latency-preview.html');
 await page.getByRole('navigation',{name:'Category leaderboards'}).waitFor();
 assert.equal(requests.length,coldRequests+1,'Intent prefetch and mounted overview coalesce');
 await page.getByRole('button',{name:'Remount leaders',exact:true}).click();
 let snapshot=JSON.parse(await page.getByLabel('First commit snapshot').textContent());
 assert.equal(snapshot.leaders,1,'A warm remount must contain genuine leaders in its first commit, before effects');
 assert.equal(snapshot.status,'');assert.equal(requests.length,coldRequests+1,'Fresh remount must not request the same overview again');
 await page.getByRole('button',{name:'Change city',exact:true}).click();
 snapshot=JSON.parse(await page.getByLabel('First commit snapshot').textContent());
 assert.equal(snapshot.city,'Bhadrak');assert.equal(snapshot.leaders,0,'Prior city leaders must never flash in the first commit');
 await page.getByText('No matching professionals are listed here yet.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Change city',exact:true}).click();
 await page.getByRole('button',{name:'Maid leaderboard',exact:true}).click();
 await page.locator('.catalog-professional').getByText('Reviewed fixture professional',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('Summary-only cold request, leaders before slow catalogue, intent request coalescing, synchronous warm first commit, city isolation and approved Home association passed.');
}finally{await browser.close();}
