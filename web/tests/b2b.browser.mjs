import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Real isolated API/store and real product/RFQ/quote persistence. The only auth
// fixture adds verified phone claims after the actual local session is verified.
// API responses are forwarded unchanged; no products or success states are mocked.
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend');
const work=await mkdtemp(resolve(tmpdir(),'b2b-e2e-')),db=resolve(work,'wholesale.db');
const python=process.env.B2B_TEST_PYTHON||resolve(backend,'.venv/bin/python');
const port=Number(process.env.B2B_TEST_PORT||8027),apiOrigin='http://127.0.0.1:'+port;
const vitePort=Number(process.env.B2B_PREVIEW_PORT||5191),origin=process.env.B2B_PREVIEW_ORIGIN||'http://127.0.0.1:'+vitePort;
let server,vite,browser,serverLog='',viteLog='',succeeded=false;
const errors=[],releaseReads=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fixture(kind,id,body){
  const code='import json,os,sys\nos.environ["REPAIDO_DB"]=sys.argv[1]\nos.environ["REPAIDO_STORAGE"]="sqlite"\nimport main\nmain.operations_store.run(lambda u:u.put(sys.argv[2],sys.argv[3],json.loads(sys.argv[4])))';
  const result=spawnSync(python,['-c',code,db,kind,id,JSON.stringify(body)],{cwd:backend,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
async function api(path,account,method='GET',body,expected=200){
  const response=await fetch(apiOrigin+path,{method,headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>({}));assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(data));return data;
}
async function register(name,suffix=''){return api('/auth/register',null,'POST',{name,email:name.toLowerCase().replaceAll(' ','.')+suffix+'@wholesale.test',password:'isolated-test-password'},201);}
async function ready(url,process,log){
  for(let attempt=0;attempt<100;attempt++){
    if(process.exitCode!==null)throw Error('Test service could not start: '+log());
    try{if((await fetch(url)).ok)return;}catch{}
    await pause(150);
  }throw Error('Test service not ready: '+log());
}
async function newPage(account,{mode='customer',shop='wholesale-shop',width=390,failCatalog=false,sharedContact=false}={}){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce',acceptDownloads:true});
  await context.addInitScript(token=>{
    if(token)localStorage.setItem('repaido.token',token);
    localStorage.setItem('repaido_b2b_listings_v1',JSON.stringify([{id:'old-local-mock',title:'OLD BROWSER SAMPLE MUST NOT APPEAR',status:'active'}]));
    localStorage.setItem('repaido_b2b_rfqs_v1',JSON.stringify([{id:'old-local-rfq',customerName:'Old sample buyer'}]));
  },account?.token||'');
  await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    const response=await route.fetch({url:apiOrigin+url.pathname+url.search});await route.fulfill({response});
  });
  if(failCatalog)await context.route('**/api/operations/b2b/listings**',route=>route.abort('connectionreset'));
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/tests/b2b-preview.html?'+new URLSearchParams({mode,shop,sharedContact:sharedContact?'1':'0'}));
  await page.getByRole('heading',{name:'Wholesale verification'}).waitFor();return page;
}
async function layout(page){
  const issues=await page.evaluate(()=>{
    const issues=[];
    if(document.documentElement.scrollWidth>innerWidth+1)issues.push('Document exceeds phone width.');
    for(const node of document.querySelectorAll('.b2b-hub-container,.shop-b2b-panel,.shop-b2b-listing,.b2b-product-card,.b2b-request-card,.b2b-form-modal,.b2b-detail-modal,.b2b-quotation-modal')){
      if(!node.getClientRects().length)continue;
      if(node.scrollWidth>node.clientWidth+1)issues.push('Content overflow: '+node.className);
    }
    for(const node of document.querySelectorAll('button,input:not([type="checkbox"]),select,textarea,summary')){
      if(!node.getClientRects().length)continue;
      const rect=node.getBoundingClientRect();
      if(rect.height<43)issues.push('Target below 44px: '+(node.getAttribute('aria-label')||node.textContent||node.name));
    }return issues;
  });assert.deepEqual(issues,[]);
}
async function audit(page){
  await page.addScriptTag({path:require.resolve('axe-core')});
  const result=await page.evaluate(()=>window.axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  assert.deepEqual(result.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
  const enhanced=await page.evaluate(()=>window.axe.run(document.querySelector('main'),{runOnly:{type:'rule',values:['color-contrast-enhanced']},rules:{'color-contrast-enhanced':{enabled:true}}}));
  assert.deepEqual(enhanced.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),[],'Wholesale text meets enhanced contrast.');
}
async function doubleText(page){
  // Include fixed-pixel component text, as a browser text-resize preference does.
  await page.evaluate(()=>{
    const elements=[...document.querySelectorAll('main h1,main h2,main h3,main h4,main p,main span,main small,main strong,main dt,main dd,main label,main button,main input,main select,main textarea,main summary,main legend')];
    const sizes=elements.map(node=>[node,parseFloat(getComputedStyle(node).fontSize)]);
    for(const [node,size] of sizes)node.style.fontSize=size*2+'px';
  });
}
async function fillRequest(page,quantity=25){
  const form=page.getByRole('dialog',{name:'Request quotation',exact:true});await form.waitFor();
  await form.getByLabel('Quantity (rolls)',{exact:true}).fill(String(quantity));
  await form.getByLabel('Contact mobile',{exact:true}).fill('+919876543210');
  await form.getByLabel('Delivery address',{exact:true}).fill('Unit 42, Isolated Industrial Test Area');
  await form.getByLabel('Delivery city',{exact:true}).fill('Balasore');
  await form.getByLabel('Delivery PIN code',{exact:true}).fill('756001');
  await form.getByLabel('Share these contact and delivery details with this supplier for this inquiry.',{exact:true}).check();
  return form;
}
async function loadAllShopListings(page){
  // A saved form closes before its list refresh finishes. Wait for that refresh
  // before deciding whether the next cursor is available.
  await page.waitForFunction(()=>{const refresh=document.querySelector('.shop-b2b-panel .business-page-header button');return refresh&&!refresh.disabled;});
  for(let n=0;n<10;n++){
    const more=page.getByRole('button',{name:'Load more listings',exact:true});if(!await more.count())return;
    const count=await page.locator('.shop-b2b-listing').count();
    const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/b2b/listings'&&new URL(response.url()).searchParams.has('cursor'));
    await more.click();const body=await(await loaded).json();
    await page.waitForFunction(({count,cursor})=>document.querySelectorAll('.shop-b2b-listing').length===count&&!!document.querySelector('.b2b-load-more')===!!cursor,{count:count+body.listings.length,cursor:body.next_cursor});
  }throw Error('Wholesale fixture pagination did not finish.');
}
const listingBody=(title='Pure Copper Refrigeration Coil',category='hvac')=>({request_id:randomUUID(),shop_id:'wholesale-shop',title,category,part_number:'COP-TUBE-50FT',hsn_code:'74112100',unit:'Rolls',moq:10,base_price_paise:145075,mrp_paise:235099,bulk_slabs:[{min_qty:10,max_qty:24,price_paise:145075,discount_label:'Wholesale'},{min_qty:25,max_qty:null,price_paise:132050,discount_label:'Bulk'}],stock:300,lead_time_days:2,supply_capacity:'300 Rolls / Month',description:'Actual isolated product for compatibility and project procurement checks.',specifications:{OD:'1/2 inch',Wall:'0.8 mm'},image:null});

try{
  const env={...process.env,REPAIDO_DB:db,REPAIDO_STORAGE:'sqlite',REPAIDO_COMMUNITY_BUCKET:'',REPAIDO_KYC_BUCKET:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''};
  // External object storage is replaced by actual files in this test directory.
  // Upload validation, shop ownership, binding and public media routes stay real.
  env.B2B_TEST_MEDIA_DIR=resolve(work,'objects');
  const serverCode='import main,uvicorn,b2b,os\nfrom fastapi import Header\nfrom pathlib import Path\noriginal=main.current_user\ndef verified(authorization: str=Header(default="")):\n user=original(authorization)\n claim=main.operations_store.run(lambda u:u.get("e2e_verified_phone",user["id"]))\n return {**user,**({"phone":claim["phone"],"phone_verified":True,"phone_authenticated":True} if claim else {})}\ndef upload(name,data):\n fail=main.operations_store.run(lambda u:u.get("e2e_storage_failure","b2b"))\n if fail and fail.get("active"):raise RuntimeError("Isolated object storage unavailable")\n path=Path(os.environ["B2B_TEST_MEDIA_DIR"])/name\n path.parent.mkdir(parents=True,exist_ok=True)\n path.write_bytes(data)\nb2b.upload_object=upload\nb2b.download_object=lambda name:(Path(os.environ["B2B_TEST_MEDIA_DIR"])/name).read_bytes()\nmain.app.dependency_overrides[original]=verified\nuvicorn.run(main.app,host="127.0.0.1",port='+port+')';
  server=spawn(python,['-c',serverCode],{cwd:backend,env,stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>serverLog+=chunk.toString());
  await ready(apiOrigin+'/health',server,()=>serverLog);
  if(!process.env.B2B_PREVIEW_ORIGIN){
    // Other team-owned files can change during the run; they must not reload an
    // unrelated open form and invalidate this lifecycle's browser evidence.
    const viteCode='const {createServer}=await import('+JSON.stringify(resolve(web,'node_modules/vite/dist/node/index.js'))+');const server=await createServer({root:'+JSON.stringify(web)+',configFile:'+JSON.stringify(resolve(web,'vite.config.ts'))+',server:{host:"127.0.0.1",port:'+vitePort+',strictPort:true,hmr:false,watch:null}});await server.listen();server.printUrls();';
    vite=spawn(process.execPath,['--input-type=module','-e',viteCode],{cwd:web,env:process.env,stdio:['ignore','pipe','pipe']});
    for(const stream of [vite.stdout,vite.stderr])stream.on('data',chunk=>viteLog+=chunk.toString());
    await ready(origin+'/tests/b2b-preview.html',vite,()=>viteLog);
  }
  const owner=await register('Wholesale Supplier'),buyer=await register('Project Buyer'),outsider=await register('Unrelated Buyer');
  fixture('e2e_verified_phone',owner.user.id,{phone:'+919876543210'});
  fixture('shops','wholesale-shop',{id:'wholesale-shop',owner_id:owner.user.id,name:'Actual Isolated Supply',status:'approved',city:'Balasore',address:'PRIVATE Supplier Plot 1',phone:'+919876543210',email:owner.user.email});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
  const guest=await newPage(null);
  await guest.getByRole('heading',{name:'Wholesale listings are on the way'}).waitFor();
  assert.equal(await guest.getByText('OLD BROWSER SAMPLE MUST NOT APPEAR').count(),0);
  // The compact catalogue has no checkout action; agreement terms are checked in the quotation flow below.
  assert.equal(await guest.getByRole('button',{name:/checkout|pay now/i}).count(),0);
  await guest.getByRole('tab',{name:'My requests',exact:true}).click();
  await guest.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  assert.equal(await guest.locator('.b2b-request-card').count(),0);await layout(guest);await guest.context().close();

  const product=(await api('/operations/b2b/listings',owner,'POST',listingBody())).listing;
  for(let n=0;n<21;n++)await api('/operations/b2b/listings',owner,'POST',listingBody('Fastener Project Bundle '+String(n).padStart(2,'0'),'hardware'));
  const publicPage=await api('/operations/b2b/listings',null);
  assert.equal(publicPage.listings.length,20);assert.ok(publicPage.next_cursor);
  assert.equal('phone' in publicPage.listings[0],false);assert.equal('address' in publicPage.listings[0],false);assert.equal('owner_id' in publicPage.listings[0],false);
  await api('/operations/b2b/rfq',null,'GET',undefined,401);
  await api('/operations/b2b/listings?shop_id=wholesale-shop',outsider,'GET',undefined,403);
  const customer=await newPage(buyer);
  await customer.locator('.b2b-product-card').first().waitFor();
  assert.equal(await customer.locator('.b2b-product-card').count(),20);
  await customer.getByRole('button',{name:'Load more listings',exact:true}).click();
  await customer.waitForFunction(()=>document.querySelectorAll('.b2b-product-card').length===22);
  const search=customer.getByRole('searchbox',{name:'Search wholesale listings',exact:true});
  const supplierSearch=customer.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/b2b/listings'&&new URL(response.url()).searchParams.get('search')==='Actual Isolated Supply');
  await search.fill('Actual Isolated Supply');assert.equal((await(await supplierSearch).json()).listings.length,20);
  await customer.waitForFunction(()=>document.querySelectorAll('.b2b-product-card').length===20);
  assert.match(await customer.locator('.b2b-product-card').first().innerText(),/Actual Isolated Supply/);
  await customer.getByRole('button',{name:'Electrical',exact:true}).click();
  await customer.getByRole('heading',{name:'No matching wholesale listings'}).waitFor();
  await customer.getByRole('button',{name:'Clear filters',exact:true}).click();
  await search.fill('Pure Copper');
  await customer.getByRole('heading',{name:product.title,exact:true}).waitFor();
  assert.equal(await customer.locator('.b2b-product-card').count(),1);
  await customer.getByRole('button',{name:'View wholesale details for '+product.title,exact:true}).click();
  const detail=customer.getByRole('dialog',{name:product.title,exact:true});await detail.waitFor();
  assert.match(await detail.innerText(),/0.8 mm/);assert.match(await detail.innerText(),/₹1,320.50/);
  await layout(customer);await detail.getByRole('button',{name:'Request quotation',exact:true}).click();
  const request=await fillRequest(customer);
  await request.getByLabel('Target unit price (₹, optional)',{exact:true}).fill('1299.75');
  // Lose only the response after the server saves the RFQ. Retrying the form must
  // preserve its request ID and retrieve the same saved row instead of duplicating.
  let lostResponse=true;const lostBodies=[];
  const loseOnce=async route=>{
    if(route.request().method()!=='POST')return route.fallback();
    lostBodies.push(route.request().postDataJSON());
    const url=new URL(route.request().url()),response=await route.fetch({url:apiOrigin+url.pathname+url.search});
    assert.equal(response.status(),200);
    if(lostResponse){lostResponse=false;return route.abort('connectionreset');}
    await route.fulfill({response});
  };
  await customer.context().route('**/api/operations/b2b/rfq',loseOnce);
  await request.getByRole('button',{name:'Send quotation request',exact:true}).click();
  await request.locator('[role="alert"]').waitFor();
  assert.equal(await request.getByLabel('Delivery address',{exact:true}).inputValue(),'Unit 42, Isolated Industrial Test Area');
  const savedAfterLoss=await api('/operations/b2b/rfq',buyer);assert.equal(savedAfterLoss.rfqs.length,1);
  await request.getByRole('button',{name:'Send quotation request',exact:true}).click();
  await customer.getByRole('heading',{name:'Your buying conversations',exact:true}).waitFor();
  await request.waitFor({state:'hidden'});await customer.context().unroute('**/api/operations/b2b/rfq',loseOnce);
  const saved=await api('/operations/b2b/rfq',buyer);assert.equal(saved.rfqs.length,1);assert.equal(saved.rfqs[0].id,savedAfterLoss.rfqs[0].id);assert.ok(lostBodies[0].request_id);assert.equal(lostBodies[1].request_id,lostBodies[0].request_id);
  const inquiry=saved.rfqs[0];assert.equal(inquiry.listed_rate_paise,132050);assert.equal(inquiry.target_price_paise,129975);assert.equal(inquiry.payment_status,'not_collected');
  assert.equal((await api('/operations/b2b/rfq',outsider)).rfqs.length,0);
  await api('/operations/b2b/rfq/'+inquiry.id,outsider,'GET',undefined,404);
  await api('/operations/b2b/quotation/missing-quote/pdf',buyer,'GET',undefined,404);
  console.log('PASS: real bounded wholesale discovery, private RFQ and uncertain-response idempotent retry.');

  const supplier=await newPage(owner,{mode:'shop'});
  await supplier.getByRole('heading',{name:'Your wholesale desk',exact:true}).waitFor();
  await supplier.locator('.shop-b2b-listing').first().waitFor();
  const titleSize=page=>page.locator('.business-page-header h1').first().evaluate(node=>getComputedStyle(node).fontSize);
  assert.equal(await titleSize(supplier),await titleSize(customer),'Shared business header typography stays consistent inside the legacy partner workspace.');
  await supplier.getByRole('button',{name:'Add wholesale listing',exact:true}).click();
  const add=supplier.getByRole('dialog',{name:'Add wholesale listing',exact:true});await add.waitFor();
  await add.getByLabel('Product title',{exact:true}).fill('Actual Warehouse Wiring Kit');
  await add.getByRole('combobox',{name:/^Category/}).selectOption('electrical');await add.getByRole('combobox',{name:/^Unit/}).selectOption('Pieces');
  await add.getByLabel('Minimum quantity',{exact:true}).fill('5');await add.getByLabel('Listed stock',{exact:true}).fill('80');
  await add.getByLabel('Base unit price (₹)',{exact:true}).fill('149.99');
  await add.getByLabel('Dispatch estimate (days)',{exact:true}).fill('3');await add.getByLabel('Product description',{exact:true}).fill('Actual wiring components with documented compatibility for isolated testing.');
  await add.getByRole('button',{name:'Add price range',exact:true}).click();
  await add.getByLabel('From quantity',{exact:true}).fill('20');await add.getByLabel('Unit rate (₹)',{exact:true}).fill('139.99');
  const photo=resolve(work,'warehouse-photo.jpg');
  const picture=spawnSync(python,['-c','from PIL import Image\nimport sys\nImage.new("RGB",(400,300),(11,42,91)).save(sys.argv[1],"JPEG")',photo],{encoding:'utf8'});assert.equal(picture.status,0,picture.stderr);
  await add.getByLabel('Actual product photo (JPG/PNG, up to 5 MB)',{exact:true}).setInputFiles(photo);
  await add.getByLabel('These product details, stock and rates are accurate and supplied by my shop.',{exact:true}).check();
  fixture('e2e_storage_failure','b2b',{active:true});
  await add.getByRole('button',{name:'Save wholesale listing',exact:true}).click();await add.getByRole('alert').waitFor();
  assert.match(await add.getByRole('alert').innerText(),/storage is unavailable/i);
  assert.equal(await add.getByLabel('Product title',{exact:true}).inputValue(),'Actual Warehouse Wiring Kit');
  assert.equal((await api('/operations/b2b/listings?search=Actual%20Warehouse',null)).listings.length,0,'Upload failure cannot fabricate a published listing.');
  fixture('e2e_storage_failure','b2b',{active:false});
  await add.getByRole('button',{name:'Save wholesale listing',exact:true}).click();await add.waitFor({state:'hidden'});
  const created=(await api('/operations/b2b/listings?search=Actual%20Warehouse',null)).listings;assert.equal(created.length,1);
  assert.equal(created[0].base_price_paise,14999);assert.equal(created[0].mrp_paise,null,'An omitted MRP stays absent instead of being fabricated for a discount.');assert.equal(created[0].bulk_slabs[0].price_paise,13999);assert.match(created[0].image,/\/api\/operations\/b2b\/photos\//);
  const publishedPhoto=await fetch(apiOrigin+created[0].image);assert.equal(publishedPhoto.status,200);assert.equal(publishedPhoto.headers.get('content-type'),'image/jpeg');assert.ok((await publishedPhoto.arrayBuffer()).byteLength>100);
  await loadAllShopListings(supplier);
  const sellerProduct=supplier.locator('.shop-b2b-listing').filter({has:supplier.getByRole('heading',{name:product.title,exact:true})});
  await sellerProduct.getByRole('button',{name:'Edit listing',exact:true}).click();
  const edit=supplier.getByRole('dialog',{name:'Edit wholesale listing',exact:true});await edit.waitFor();
  await edit.getByLabel('Base unit price (₹)',{exact:true}).fill('1451.75');
  await edit.getByLabel('These product details, stock and rates are accurate and supplied by my shop.',{exact:true}).check();
  await edit.getByRole('button',{name:'Save wholesale listing',exact:true}).click();await edit.waitFor({state:'hidden'});
  assert.equal((await api('/operations/b2b/listings/'+product.id,null)).listing.base_price_paise,145175);
  await loadAllShopListings(supplier);await sellerProduct.getByRole('button',{name:'Pause',exact:true}).click();
  await supplier.getByText('Listing paused. It is hidden from public results.',{exact:true}).waitFor();
  await api('/operations/b2b/listings/'+product.id,null,'GET',undefined,404);
  await loadAllShopListings(supplier);await sellerProduct.getByRole('button',{name:'Publish',exact:true}).click();
  await supplier.getByText('Listing published to the wholesale catalogue.',{exact:true}).waitFor();
  assert.equal((await api('/operations/b2b/listings/'+product.id,null)).listing.status,'active');
  await supplier.getByRole('tab',{name:/^Buyer requests/}).click();
  const supplierRequest=supplier.locator('.b2b-request-card').filter({has:supplier.getByRole('heading',{name:product.title,exact:true})});
  assert.equal(await supplierRequest.locator('h2').evaluate(node=>getComputedStyle(node).fontSize),await customer.locator('.b2b-request-card h2').first().evaluate(node=>getComputedStyle(node).fontSize),'Supplier and customer inquiry cards use the same design-system title scale.');
  await supplierRequest.getByText('Buyer requirements and contact',{exact:true}).click();assert.match(await supplierRequest.innerText(),/Unit 42, Isolated Industrial Test Area/);
  await mkdir(resolve(web,'test-results'),{recursive:true});
  await supplier.screenshot({path:resolve(web,'test-results/b2b-supplier-requests.png'),fullPage:true});
  await supplierRequest.getByRole('button',{name:'Issue quotation',exact:true}).click();
  const issue=supplier.getByRole('dialog',{name:'Issue quotation',exact:true});await issue.waitFor();
  await issue.getByLabel('Offered unit rate (₹)',{exact:true}).fill('1280.25');await issue.getByLabel('GST rate (%)',{exact:true}).fill('18');await issue.getByLabel('Freight charge (₹)',{exact:true}).fill('650.25');
  await issue.getByLabel('Valid for (days)',{exact:true}).fill('15');await issue.getByLabel('Payment terms',{exact:true}).fill('Payment arranged directly with the supplier after agreeing terms.');
  await issue.getByLabel('Delivery timeline',{exact:true}).fill('Dispatch estimated within 2 business days after supplier confirmation.');
  await issue.getByLabel('Warranty and returns',{exact:true}).fill('Supplier declares a 12-month repair warranty with stated exclusions.');
  await issue.getByLabel('Authorized signatory',{exact:true}).fill(owner.user.name);await issue.getByLabel('Designation',{exact:true}).fill('Owner');
  await issue.getByLabel('I am authorized to issue these terms for this shop and confirm the price and tax breakdown.',{exact:true}).check();
  assert.match(await issue.locator('.b2b-total-preview').innerText(),/₹38,417.63/);
  await issue.getByRole('button',{name:'Send saved quotation',exact:true}).click();await issue.waitFor({state:'hidden'});
  const supplierQuote=await api('/operations/b2b/rfq/'+inquiry.id,owner);assert.equal(supplierQuote.rfq.status,'quoted');
  const quotation=supplierQuote.rfq.quotation;assert.equal(quotation.taxable_paise,3200625);assert.equal(quotation.gst_paise,576113);assert.equal(quotation.grand_total_paise,3841763);
  await supplier.screenshot({path:resolve(web,'test-results/b2b-quotation.png')});
  await supplier.getByRole('dialog',{name:'Supplier quotation',exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click();
  await customer.getByRole('button',{name:'Refresh',exact:true}).click();await customer.getByText('Quotation ready',{exact:true}).waitFor();
  await customer.getByRole('button',{name:'View quotation',exact:true}).click();
  let customerQuote=customer.getByRole('dialog',{name:/quotation/i});await customerQuote.waitFor();
  assert.match(await customerQuote.innerText(),/₹38,417.63/);assert.match(await customerQuote.innerText(),/Project Buyer/);
  const refreshedQuote=(await api('/operations/b2b/quotation',owner,'POST',{request_id:randomUUID(),rfq_id:inquiry.id,offered_rate_paise:128100,quantity:25,gst_bps:1800,freight_charges_paise:65025,payment_terms:quotation.payment_terms,delivery_timeline:quotation.delivery_timeline,warranty_terms:quotation.warranty_terms,validity_days:15,authorized_signatory:owner.user.name,signatory_designation:'Owner'})).quotation;
  await customerQuote.getByLabel('I have reviewed this supplier’s total, delivery, payment and warranty terms.',{exact:true}).check();
  await customerQuote.getByRole('button',{name:'Accept quotation',exact:true}).click();
  await customerQuote.getByRole('alert').waitFor();assert.match(await customerQuote.getByRole('alert').innerText(),/latest saved quotation/i);
  assert.equal((await api('/operations/b2b/rfq/'+inquiry.id,buyer)).rfq.status,'quoted','A stale quotation cannot silently accept a newer price.');
  await customerQuote.getByRole('button',{name:'Close dialog',exact:true}).click();await customer.getByRole('button',{name:'Refresh',exact:true}).click();
  await customer.getByText('₹38,439.75',{exact:true}).waitFor();
  await customer.getByRole('button',{name:'View quotation',exact:true}).click();customerQuote=customer.getByRole('dialog',{name:/quotation/i});await customerQuote.waitFor();
  assert.match(await customerQuote.innerText(),new RegExp(refreshedQuote.quote_number));
  const downloadEvent=customer.waitForEvent('download');await customerQuote.getByRole('button',{name:/Download.*PDF/i}).click();const download=await downloadEvent;
  const document=resolve(work,'quotation.pdf');await download.saveAs(document);assert.ok((await readFile(document)).subarray(0,5).equals(Buffer.from('%PDF-')));
  const extracted=spawnSync('pdftotext',[document,'-'],{encoding:'utf8'});assert.equal(extracted.status,0,extracted.stderr);assert.match(extracted.stdout,new RegExp(refreshedQuote.quote_number));assert.match(extracted.stdout,/Project Buyer/);assert.match(extracted.stdout,/not a tax invoice/);
  await api('/operations/b2b/quotation/'+refreshedQuote.quote_number+'/pdf',outsider,'GET',undefined,404);
  await customerQuote.getByLabel('I have reviewed this supplier’s total, delivery, payment and warranty terms.',{exact:true}).check();
  await customerQuote.getByRole('button',{name:'Accept quotation',exact:true}).click();await customerQuote.getByText(/Acceptance recorded/).first().waitFor();
  assert.equal((await api('/operations/b2b/rfq/'+inquiry.id,buyer)).rfq.status,'accepted');assert.equal((await api('/operations/b2b/listings/'+product.id,null)).listing.stock,300);
  assert.match(await customerQuote.innerText(),/No payment|does not collect/i);
  console.log('PASS: supplier photo failure/retry, persisted listing edit/pause/publish, canonical quotation, private PDF, stale-price rejection and accepted agreement.');

  await customerQuote.getByRole('button',{name:'Close dialog',exact:true}).click();
  const declineRfq=(await api('/operations/b2b/rfq',buyer,'POST',{request_id:randomUUID(),listing_id:product.id,customer_name:buyer.user.name,customer_phone:'+919876543210',customer_email:buyer.user.email,delivery_address:'Another actual isolated project delivery address',delivery_city:'Balasore',delivery_pincode:'756001',quantity_requested:26,notes:'Second distinct request for decline testing'})).rfq;
  await api('/operations/b2b/quotation',owner,'POST',{request_id:randomUUID(),rfq_id:declineRfq.id,offered_rate_paise:128100,quantity:26,gst_bps:1800,freight_charges_paise:65025,payment_terms:quotation.payment_terms,delivery_timeline:quotation.delivery_timeline,warranty_terms:quotation.warranty_terms,validity_days:15,authorized_signatory:owner.user.name,signatory_designation:'Owner'});
  await customer.getByRole('button',{name:'Refresh',exact:true}).click();
  const declineCard=customer.locator('.b2b-request-card').filter({hasText:'26 rolls'});await declineCard.getByRole('button',{name:'View quotation',exact:true}).click();
  const declineModal=customer.getByRole('dialog',{name:'Supplier quotation',exact:true});await declineModal.waitFor();
  await declineModal.getByRole('button',{name:'Decline quotation',exact:true}).click();await declineModal.getByText('Quotation declined. Your decision was saved.',{exact:true}).waitFor();
  assert.equal((await api('/operations/b2b/rfq/'+declineRfq.id,buyer)).rfq.status,'declined');await declineModal.getByRole('button',{name:'Close dialog',exact:true}).click();
  await layout(customer);await audit(customer);

  const sameContact=await register(buyer.user.name,'.other');
  const switched=await newPage(buyer,{sharedContact:true});
  await switched.getByRole('tab',{name:'My requests',exact:true}).click();await switched.locator('.b2b-request-card').first().waitFor();
  assert.equal(await switched.locator('.b2b-request-card').count(),2);
  let release,captured,finished;
  const barrier=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{captured=resolve;}),done=new Promise(resolve=>{finished=resolve;});
  releaseReads.push(release);
  const delayOld=async route=>{
    if(route.request().headers().authorization!=='Bearer '+buyer.token)return route.fallback();
    const url=new URL(route.request().url()),response=await route.fetch({url:apiOrigin+url.pathname+url.search});
    const old=await response.json();assert.equal(old.rfqs.length,2);captured();await barrier;
    await route.fulfill({response});finished();
  };
  await switched.context().route('**/api/operations/b2b/rfq**',delayOld);
  await switched.getByRole('button',{name:'Refresh',exact:true}).click();await reached;
  await switched.getByRole('button',{name:'View quotation',exact:true}).first().click();
  await switched.getByRole('dialog',{name:'Supplier quotation',exact:true}).waitFor();
  const nextAccount=switched.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/b2b/rfq'&&response.request().headers().authorization==='Bearer '+sameContact.token);
  await switched.evaluate(token=>{
    localStorage.setItem('repaido.token',token);
    window.dispatchEvent(new Event('repaido:identity-changed'));
    window.dispatchEvent(new Event('b2b-preview-account'));
  },sameContact.token);
  assert.deepEqual((await(await nextAccount).json()).rfqs,[]);
  await switched.getByRole('heading',{name:'Your first quote starts here',exact:true}).waitFor();
  await switched.getByRole('dialog',{name:'Supplier quotation',exact:true}).waitFor({state:'hidden'});
  release();await done;await switched.context().unroute('**/api/operations/b2b/rfq**',delayOld);await pause(100);
  assert.equal(await switched.locator('.b2b-request-card').count(),0);
  assert.equal(await switched.getByText('Unit 42, Isolated Industrial Test Area').count(),0);
  assert.equal(await switched.getByText('Another actual isolated project delivery address').count(),0);
  await switched.context().close();
  console.log('PASS: same-contact account switch clears an open private quote and rejects a delayed prior-account RFQ response.');

  await supplier.getByRole('tab',{name:'Wholesale listings',exact:true}).click();await loadAllShopListings(supplier);
  const createdCard=supplier.locator('.shop-b2b-listing').filter({has:supplier.getByRole('heading',{name:'Actual Warehouse Wiring Kit',exact:true})});
  await createdCard.getByRole('button',{name:'Archive',exact:true}).click();
  const archive=supplier.getByRole('dialog',{name:'Archive wholesale listing',exact:true});await archive.getByRole('button',{name:'Confirm archive',exact:true}).click();await archive.waitFor({state:'hidden'});
  await api('/operations/b2b/listings/'+created[0].id,null,'GET',undefined,404);
  assert.equal((await fetch(apiOrigin+created[0].image)).status,404,'An archived product photo is no longer exposed as a public listing image.');
  const deniedShop=await newPage(outsider,{mode:'shop'});await deniedShop.getByRole('alert').waitFor();
  assert.equal(await deniedShop.getByText('Unit 42, Isolated Industrial Test Area').count(),0);assert.equal(await deniedShop.locator('.b2b-request-card').count(),0);await deniedShop.context().close();

  const failed=await newPage(buyer,{failCatalog:true});await failed.getByRole('button',{name:'Retry listings',exact:true}).waitFor();
  assert.equal(await failed.locator('.b2b-product-card').count(),0);assert.equal(await failed.getByText('Wholesale listings are on the way').count(),0,'A connection failure is not shown as a real empty catalogue.');
  await failed.context().unroute('**/api/operations/b2b/listings**');await failed.getByRole('button',{name:'Retry listings',exact:true}).click();await failed.locator('.b2b-product-card').first().waitFor();await failed.context().close();

  for(const width of [320,390,430,524,1280]){
    const phone=await newPage(buyer,{width});await phone.locator('.b2b-product-card').first().waitFor();
    await layout(phone);
    await phone.getByRole('searchbox',{name:'Search wholesale listings',exact:true}).fill('Pure Copper');await phone.getByRole('heading',{name:product.title,exact:true}).waitFor();
    await phone.getByRole('button',{name:'View wholesale details for '+product.title,exact:true}).click();
    const phoneDetail=phone.getByRole('dialog',{name:product.title,exact:true});await phoneDetail.waitFor();await layout(phone);
    await phoneDetail.getByRole('button',{name:'Close dialog',exact:true}).click();
    if(width===390){await audit(phone);await mkdir(resolve(web,'test-results'),{recursive:true});await phone.screenshot({path:resolve(web,'test-results/b2b-phone.png'),fullPage:true});}
    await phone.evaluate(()=>{document.documentElement.dataset.theme='dark';});await layout(phone);if(width===390)await audit(phone);
    await doubleText(phone);await layout(phone);
    await phone.context().close();
  }
  await supplier.evaluate(()=>{document.documentElement.dataset.theme='dark';});await layout(supplier);await audit(supplier);await doubleText(supplier);await layout(supplier);
  console.log('PASS: real decline/archive, denied workspace privacy, connection error/retry, mobile and desktop layouts, 200% text, dark theme and WCAG/enhanced contrast.');

  assert.deepEqual(errors,[]);succeeded=true;
}catch(error){
  if(browser)for(const context of browser.contexts())for(const page of context.pages()){
    const index=browser.contexts().indexOf(context)+'-'+context.pages().indexOf(page);
    await writeFile(resolve(work,'failure-'+index+'.html'),await page.content()).catch(()=>{});
    await page.screenshot({path:resolve(work,'failure-'+index+'.png'),fullPage:true}).catch(()=>{});
  }
  await writeFile(resolve(work,'backend.log'),serverLog);await writeFile(resolve(work,'vite.log'),viteLog);
  console.error('B2B browser artifacts:',work);throw error;
}finally{
  for(const release of releaseReads)release();
  await browser?.close();server?.kill('SIGTERM');vite?.kill('SIGTERM');
  if(succeeded)await rm(work,{recursive:true,force:true});
}
