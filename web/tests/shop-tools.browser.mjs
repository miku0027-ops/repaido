import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.SHOP_TOOLS_TEST_ORIGIN||'http://127.0.0.1:5193',out='/tmp/repaido-shop-tools-browser';
await mkdir(out,{recursive:true});
const actor=`const user={uid:'shop',getIdToken:async()=> 'shop'};export const auth={currentUser:user,authStateReady:async()=>{},onIdTokenChanged(next){const fn=typeof next==='function'?next:next.next.bind(next);queueMicrotask(()=>fn(user));return()=>{};}};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
const entry={id:'sale:cap35',source_kind:'retail',source_id:'sale',amount_paise:5000,status:'paid',transfer_status:'processed',provider_id:'pout_fixture',payment_reference:'pay_fixture',invoice_id:null,invoice_status:null,flags:[]};
const requests=[],errors=[],checks=[];let commits=0;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:467,height:850},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/src/firebase.ts')return route.fulfill({contentType:'text/javascript',body:actor});
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let payload;try{payload=request.postDataJSON();}catch{}requests.push({path:url.pathname,method:request.method(),payload});
  let data={},status=200;
  if(url.pathname.endsWith('/stock-alerts'))data={items:[{id:'cap35',name:'Capacitor 35uF',sku:'CAP35',stock:1,reserved:3,low_stock:2,stock_confirmed_at:0,reasons:['low_stock','stock_confirmation_due']}],scanned:1,next_cursor:null,as_of:Date.now()/1000,note:'Alerts use available stock after reservations.'};
  else if(url.pathname.endsWith('/statement'))data={shop_id:'shop1',shop_name:'Fixture shop',entries:[entry],next_cursor:null,as_of:Date.now()/1000,bank:{status:'verified',last4:'1234'},page_totals:{recorded_paise:5000,confirmed_paid_paise:5000,review_count:0},csv_text:'id,amount_paise\nsale:cap35,5000\n',note:'Amounts are recorded allocations, not profit.'};
  else if(url.pathname.endsWith('/response-report'))data={sample_size:1,accepted_count:1,measured_acceptances:1,median_accept_seconds:60,pending_count:0,expired_pending_count:0,cancelled_count:0,next_cursor:null,note:'Uses recorded order timestamps.'};
  else if(url.pathname.endsWith('/inventory/preview'))data={shop_id:'shop1',shop_version:1,rows:[{line:2,product_id:'cap35',name:'Capacitor 35uF',action:'update',old_on_hand:4,on_hand:10,available:7,reserved:3,old_price_paise:5000,price_paise:6000,errors:payload.csv_text.includes('INVALID')?[{code:'INVALID_FIELD',field:'on_hand',message:'Use a non-negative count.'}]:[]}],error_rows:payload.csv_text.includes('INVALID')?1:0,can_commit:!payload.csv_text.includes('INVALID'),preview_digest:payload.csv_text.includes('INVALID')?null:'a'.repeat(64),max_rows:25};
  else if(url.pathname.endsWith('/inventory/commit')){commits++;if(commits===1){status=503;data={detail:{message:'Connection interrupted. Retry this save.'}};}else data={count:1,import_id:'fixture-import-receipt'};}
  else if(url.pathname.includes('/documents/'))data={title:'Retail payment allocation',shop_name:'Fixture shop',entry,items:[{name:'Capacitor 35uF',quantity:1,total_paise:5000}],currency:'INR',note:'This is a saved allocation record. Obtain the supplier-issued tax invoice separately.'};
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/shop-tools-preview.html');await page.getByRole('heading',{name:'Payment statement',exact:true}).waitFor();
 for(const width of [320,467]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${out}/overview-${width}.png`,fullPage:true});}
 checks.push('Stock reminders, payment evidence and response report fit 320px and 467px');
 await page.getByLabel('CSV contents').fill('INVALID');await page.getByRole('button',{name:'Preview changes',exact:true}).click();await page.getByText('on_hand: Use a non-negative count.').waitFor();assert(await page.getByRole('button',{name:'Save 1 reviewed products'}).isDisabled());
 checks.push('Invalid preview gives a line error and blocks save');
 await page.getByLabel('CSV contents').fill('product_id,expected_version,name,sku,category,compatibility,price_paise,on_hand\ncap35,1,Capacitor 35uF,CAP35,AC parts,35uF 440V,6000,10\n');assert.equal(await page.getByRole('button',{name:'Save 1 reviewed products'}).count(),0);
 await page.getByRole('button',{name:'Preview changes',exact:true}).click();await page.getByText('Physical stock 4 →',{exact:false}).waitFor();await page.getByRole('button',{name:'Save 1 reviewed products'}).click();await page.getByRole('alert').filter({hasText:'Connection interrupted'}).waitFor();await page.getByRole('button',{name:'Save 1 reviewed products'}).click();await page.getByRole('status').filter({hasText:'1 products saved'}).waitFor();
 const calls=requests.filter(row=>row.path.endsWith('/inventory/commit'));assert.equal(calls.length,2);assert.equal(calls[0].payload.request_id,calls[1].payload.request_id);assert.equal(calls[1].payload.preview_digest,'a'.repeat(64));assert.equal(calls[1].payload.expected_shop_version,1);
 checks.push('Review precedes commit, changed CSV clears review, uncertain save retries the same idempotency key');
 await page.getByRole('button',{name:'View saved document',exact:true}).click();await page.getByRole('heading',{name:'Retail payment allocation',exact:true}).waitFor();await page.getByText('Payment: pay_fixture',{exact:true}).waitFor();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved record'}).click();const download=await downloading;assert.equal(download.suggestedFilename(),'repaido-payment-record.json');
 checks.push('Saved document shows the recorded payment reference and downloads the existing allocation');
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({checks,errors,network:'Browser uses explicit fixtures. Backend domain and authorization checks run separately.'},null,2));console.log(JSON.stringify({out,checks}));
}finally{await browser.close();}
