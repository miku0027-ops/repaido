import {feedbackImports} from './feedback-module.mjs';
import assert from 'node:assert/strict';
import {beforeEach,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {slabRatePaise,quotationTotals} from '../src/services/b2bMath.mjs';

// Actual service code; only transport, Firebase identity and loading presentation
// are injected. Account scope, payload conversion, shared pricing and errors run.
const sources=await Promise.all(['api.ts','operations.ts','b2bService.ts'].map(name=>readFile(new URL('../src/services/'+name,import.meta.url),'utf8')));
const compile=source=>feedbackImports(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const moduleUrl=(source,revision)=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+revision;
const authImport=/^import \{ auth \} from ['"]\.\.\/firebase['"];?$/m;
const loadingImport=/^import \{\s*beginLoading\s*\} from ['"]\.\/loading['"];?$/m;
const values=new Map();
let service,calls,revision=0;
const ok=body=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
const listing={id:'native-listing',shop_id:'native-shop',shop_name:'Actual shop',distributor_name:'Actual supplier',city:'Balasore',address:'Supplier address',title:'Copper coil',category:'hvac',part_number:'COP-50',hsn_code:'74112100',unit:'Rolls',moq:10,base_price_paise:145075,mrp_paise:235099,bulk_slabs:[{min_qty:10,max_qty:24,price_paise:145075,discount_label:'Standard'},{min_qty:25,max_qty:null,price_paise:132050,discount_label:'Bulk'}],stock:50,lead_time_days:2,supply_capacity:'50 Rolls',description:'Specified copper tube.',specifications:{OD:'1/2 inch'},image:'',status:'active',verified_distributor:false,created_at:1700000000,updated_at:1700000010,version:3};
const quote={quote_number:'SERVER-QUOTE-01',rfq_id:'rfq1',shop_id:'native-shop',shop_name:'Actual shop',customer_name:'Actual buyer',item_title:'Copper coil',unit:'Rolls',quantity:25,offered_rate_paise:132050,taxable_paise:3301250,gst_bps:1800,gst_paise:594225,freight_charges_paise:65025,grand_total_paise:3960500,validity_days:15,valid_until:1702000000,created_at:1700000050,status:'quoted',server_now:1700000060,payment_terms:'Terms agreed with supplier',delivery_timeline:'2 days',warranty_terms:'Supplier terms',authorized_signatory:'Supplier owner'};
const rfq={id:'rfq1',listing_id:'native-listing',item_title:'Copper coil',category:'hvac',unit:'Rolls',shop_id:'native-shop',shop_name:'Actual shop',customer_name:'Actual buyer',customer_phone:'+919876543210',customer_email:'buyer@test.example',delivery_address:'Actual address',delivery_city:'Balasore',delivery_pincode:'756001',quantity_requested:25,target_price_paise:129975,urgency:'within_7_days',notes:'Native RFQ',status:'quoted',created_at:1700000000,updated_at:1700000010,version:2,quotation:quote};
beforeEach(async()=>{
  calls=[];values.clear();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
  globalThis.window=new EventTarget();
  globalThis.__b2bAuth={currentUser:null,authStateReady:async()=>{}};
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({listings:[],rfqs:[]});};
  const apiCode=compile(sources[0]).replace(loadingImport,'const beginLoading=()=>()=>{};').replace(/import\.meta\.env\.VITE_API_BASE_URL/g,"''").replace(/import\.meta\.env\.DEV/g,'true');
  const apiUrl=moduleUrl(apiCode,++revision);
  const operationCode=compile(sources[1]).replace(authImport,'const auth=globalThis.__b2bAuth;').replace(loadingImport,'const beginLoading=()=>()=>{};')
    .replace(/from ['"]\.\/api['"]/g,'from '+JSON.stringify(apiUrl))
    .replace(/from ['"]\.\/(readCache|deviceLocation)\.mjs['"]/g,(_,name)=>'from '+JSON.stringify(new URL('../src/services/'+name+'.mjs',import.meta.url).href));
  const operationUrl=moduleUrl(operationCode,revision);
  const code=compile(sources[2]).replace(authImport,'const auth=globalThis.__b2bAuth;')
    .replace(/from ['"]\.\/api['"]/g,'from '+JSON.stringify(apiUrl)).replace(/from ['"]\.\/operations['"]/g,'from '+JSON.stringify(operationUrl));
  service=await import(moduleUrl(code,revision));
});

test('wholesale browse uses real bounded server pages and explicit public policy',async()=>{
  values.set('repaido_b2b_listings_v1',JSON.stringify([{id:'old-mock',title:'Old sample'}]));
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok(path.includes('/policy')?{payments_ready:false,escrow_available:false,acceptance_note:'Acceptance does not collect a payment.',price_note:'Final supplier quotation.'}:{listings:[listing],next_cursor:'opaque/next'});};
  const page=await service.b2bService.getB2BListings({cursor:'opaque & cursor'});
  const url=new URL(calls[0].path,'https://repaido.test');
  assert.equal(url.pathname,'/api/operations/b2b/listings');assert.equal(url.searchParams.get('cursor'),'opaque & cursor');
  assert.equal(calls[0].init.headers,undefined,'Catalogue requests do not expose buyer credentials.');
  assert.deepEqual(page.items.map(item=>item.id),['native-listing']);assert.equal(page.nextCursor,'opaque/next');
  assert.equal(page.items[0].basePrice,1450.75);assert.equal(page.items[0].bulkSlabs[1].pricePerUnit,1320.5);assert.equal(page.items[0].verifiedDistributor,false);
  assert.equal(service.listingFromServer({...listing,mrp_paise:null}).mrp,undefined,'An undeclared MRP never becomes a fictitious discount or comparison price.');
  assert.equal(page.items[0].createdAt,1700000000000);assert.equal(page.items[0].version,3);
  assert.deepEqual(await service.b2bService.getPolicy(),{paymentsReady:false,escrowAvailable:false,acceptanceNote:'Acceptance does not collect a payment.',priceNote:'Final supplier quotation.'});
  assert.equal(values.size,1,'Old local sample records never seed a saved catalogue.');
  await service.b2bService.getB2BListings({search:'coils & tubes',category:'hvac'});
  const filtered=new URL(calls.at(-1).path,'https://repaido.test');assert.equal(filtered.searchParams.get('search'),'coils & tubes');assert.equal(filtered.searchParams.get('category'),'hvac');
});

test('buyer and shop inquiries derive identity from signed credentials',async()=>{
  await assert.rejects(service.b2bService.getCustomerRFQs(),/Sign in/);assert.equal(calls.length,0);
  values.set('repaido.token','local-session');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({rfqs:[rfq],next_cursor:null});};
  const inquiries=await service.b2bService.getCustomerRFQs();
  assert.equal(calls[0].path,'/api/operations/b2b/rfq');assert.equal(calls[0].init.headers.Authorization,'Bearer local-session');
  assert.equal(inquiries.items[0].targetPricePerUnit,1299.75);assert.equal(inquiries.items[0].quotation.grandTotal,39605);
  assert.equal(inquiries.items[0].quotation.gstRate,0.18);assert.equal(inquiries.items[0].quotation.validUntilMs,1702000000000);
  globalThis.__b2bAuth.currentUser={uid:'verified-owner',getIdToken:async()=>'fresh-phone-session'};
  await service.b2bService.getShopRFQs('shop/a & crew');
  const url=new URL(calls.at(-1).path,'https://repaido.test');assert.equal(url.searchParams.get('shop_id'),'shop/a & crew');
  assert.equal(calls.at(-1).init.headers.Authorization,'Bearer fresh-phone-session');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({listings:[listing]});};
  await service.b2bService.getB2BListings({shopId:'shop/a & crew'});
  assert.equal(calls.at(-1).init.headers.Authorization,'Bearer fresh-phone-session');
});

test('RFQ draft sends money in paise and leaves listing, shop and buyer IDs to the server',async()=>{
  values.set('repaido.token','buyer-session');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({rfq});};
  const draft={requestId:'stable-request-123456',listingId:'native-listing',customerName:'Buyer',customerPhone:'+919876543210',customerEmail:'buyer@test.example',deliveryAddress:'Actual delivery address',deliveryCity:'Balasore',deliveryPincode:'756001',quantityRequested:25,targetPricePerUnit:1299.75,urgency:'within_7_days',notes:'Actual request',ownerId:'forged',shopId:'forged',itemTitle:'forged'};
  await service.b2bService.createRFQ(draft);const body=JSON.parse(calls[0].init.body);
  assert.equal(calls[0].path,'/api/operations/b2b/rfq');assert.equal(calls[0].init.method,'POST');
  assert.equal(body.request_id,draft.requestId);assert.equal(body.target_price_paise,129975);assert.equal(body.listing_id,'native-listing');
  for(const key of ['owner_id','customer_id','shop_id','shop_name','item_title','category','hsn_code','unit'])assert.equal(key in body,false,key+' is resolved by the server.');
  assert.deepEqual([...values.keys()],['repaido.token'],'A successful inquiry is never persisted as a browser-only record.');
});

test('listing and quotation commands preserve version and stable request IDs without invented badges or totals',async()=>{
  values.set('repaido.token','owner-session');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok(path.includes('/quotation')?{quotation:quote}:{listing});};
  await service.b2bService.saveB2BListing({requestId:'create-listing-123456',shopId:'native-shop',title:'Copper coil',category:'hvac',partNumber:'COP-50',hsnCode:'74112100',unit:'Rolls',moq:10,basePrice:1450.75,mrp:2350.99,bulkSlabs:[{minQty:25,pricePerUnit:1320.5,discountLabel:'Bulk'}],stock:50,leadTimeDays:2,supplyCapacity:'50 Rolls',description:'Actual specification',specifications:{OD:'1/2 inch'},image:'',expectedVersion:3,shopName:'Forged shop',verifiedDistributor:true},'listing/a');
  const listingCommand=JSON.parse(calls.at(-1).init.body);assert.equal(calls.at(-1).path,'/api/operations/b2b/listings/listing%2Fa');
  assert.equal(listingCommand.expected_version,3);assert.equal(listingCommand.base_price_paise,145075);assert.equal(listingCommand.bulk_slabs[0].price_paise,132050);
  for(const key of ['shop_name','distributor_name','verified_distributor','prime','owner_id'])assert.equal(key in listingCommand,false);
  await service.b2bService.generateQuotation('rfq1',{requestId:'quote-command-123456',expectedVersion:2,quantity:25,offeredRate:1320.5,gstRate:0.18,freightCharges:650.25,paymentTerms:'Agreed supplier payment terms',deliveryTimeline:'2 days',warrantyTerms:'Stated warranty',validityDays:15,authorizedSignatory:'Supplier owner',signatoryDesignation:'Owner',grandTotal:1,quoteNumber:'FORGED'});
  const quoteCommand=JSON.parse(calls.at(-1).init.body);assert.equal(quoteCommand.gst_bps,1800);assert.equal(quoteCommand.offered_rate_paise,132050);assert.equal(quoteCommand.freight_charges_paise,65025);assert.equal(quoteCommand.request_id,'quote-command-123456');
  for(const key of ['quote_number','grand_total_paise','taxable_paise','gst_paise','shop_id','customer_id'])assert.equal(key in quoteCommand,false);
  await service.b2bService.setListingStatus(service.listingFromServer(listing),'paused');assert.deepEqual(JSON.parse(calls.at(-1).init.body),{status:'paused',expected_version:3});
});

test('quotation decisions send the saved quote reference and expose authorization/version failures',async()=>{
  values.set('repaido.token','buyer-session');let changed=0;window.addEventListener('repaido:operations-updated',()=>changed++);
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return new Response(JSON.stringify({detail:{code:'VERSION_CONFLICT',message:'This quotation changed. Refresh it.'}}),{status:409});};
  const saved=service.rfqFromServer(rfq);
  await assert.rejects(service.b2bService.decideQuotation(saved,'accept'),/quotation changed/);
  assert.equal(changed,0,'A rejected decision cannot report success.');
  assert.equal(calls[0].path,'/api/operations/b2b/rfq/rfq1/decision');assert.equal(JSON.parse(calls[0].init.body).quote_number,'SERVER-QUOTE-01');assert.equal(JSON.parse(calls[0].init.body).action,'accept');
  globalThis.fetch=async()=>ok({rfq:{...rfq,status:'accepted'}});
  assert.equal((await service.b2bService.decideQuotation(saved,'accept')).status,'accepted');assert.equal(changed,1);
  await assert.rejects(service.b2bService.decideQuotation({...saved,quotation:undefined},'accept'),/No quotation/);
});

test('failed reads remain actionable and pending private data cannot cross accounts',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{message:'Wholesale service temporarily unavailable.'}}),{status:503});
  await assert.rejects(service.b2bService.getB2BListings(),/temporarily unavailable/);
  globalThis.fetch=async()=>ok({listings:[],next_cursor:null});assert.deepEqual(await service.b2bService.getB2BListings(),{items:[],nextCursor:null});
  values.set('repaido.token','account-a');let finish,started;const entered=new Promise(resolve=>{started=resolve;});
  globalThis.fetch=async(path,init)=>{calls.push({path,init});started();return new Promise(resolve=>{finish=resolve;});};
  const pending=service.b2bService.getCustomerRFQs();await entered;values.set('repaido.token','account-b');finish(ok({rfqs:[rfq]}));
  await assert.rejects(pending,/account changed/);
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({rfqs:[]});};
  assert.deepEqual(await service.b2bService.getCustomerRFQs(),{items:[],nextCursor:null});assert.equal(calls.at(-1).init.headers.Authorization,'Bearer account-b');
});

test('product uploads require a signed account and a confirmed saved media reference',async()=>{
  const file=new File(['actual-image-bytes'],'coil.jpg',{type:'image/jpeg'});
  await assert.rejects(service.b2bService.uploadPhoto(file,'shop/a'),/Sign in/);assert.equal(calls.length,0);
  values.set('repaido.token','owner-session');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({image_url:'/api/operations/b2b/photos/saved'});};
  assert.equal(await service.b2bService.uploadPhoto(file,'shop/a'),'/api/operations/b2b/photos/saved');assert.equal(calls[0].init.body,file);assert.equal(calls[0].init.headers.Authorization,'Bearer owner-session');
  assert.equal(new URL(calls[0].path,'https://repaido.test').searchParams.get('shop_id'),'shop/a');
  assert.equal(calls[0].init.headers['Content-Type'],'image/jpeg');
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{message:'Photo was rejected.'}}),{status:422});
  await assert.rejects(service.b2bService.uploadPhoto(file,'shop/a'),/Photo was rejected/);
  globalThis.fetch=async()=>ok({});await assert.rejects(service.b2bService.uploadPhoto(file,'shop/a'),/did not confirm/);
});

test('private quotation downloads require a confirmed PDF and propagate missing or denied documents',async()=>{
  await assert.rejects(service.b2bService.downloadQuotation('saved/quote'),/Sign in/);assert.equal(calls.length,0);
  values.set('repaido.token','buyer-session');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return new Response(JSON.stringify({detail:{message:'Saved quotation not found.'}}),{status:404});};
  await assert.rejects(service.b2bService.downloadQuotation('saved/quote'),/not found/);
  assert.equal(calls[0].path,'/api/operations/b2b/quotation/saved%2Fquote/pdf');assert.equal(calls[0].init.headers.Authorization,'Bearer buyer-session');
  globalThis.fetch=async()=>ok({});await assert.rejects(service.b2bService.downloadQuotation('saved/quote'),/not confirmed/);
  let downloaded;
  globalThis.document={createElement:()=>({click(){downloaded=this.download;},remove(){}}),body:{append(){}}};
  window.setTimeout=fn=>{fn();return 0;};
  globalThis.fetch=async()=>new Response('%PDF-actual-saved-test',{headers:{'Content-Type':'application/pdf'}});
  await service.b2bService.downloadQuotation('SERVER-QUOTE-01');assert.equal(downloaded,'SERVER-QUOTE-01.pdf');
});

test('pending private PDFs and product uploads reject results from a previous account',async()=>{
  const delayed=()=>{
    let finish,started;const entered=new Promise(resolve=>{started=resolve;});
    globalThis.fetch=async(path,init)=>{calls.push({path,init});started();return new Promise(resolve=>{finish=resolve;});};
    return {entered,finish:response=>finish(response)};
  };
  values.set('repaido.token','account-a');
  let response=delayed();const pdf=service.b2bService.downloadQuotation('private-quote');await response.entered;
  values.set('repaido.token','account-b');response.finish(new Response('%PDF-private',{headers:{'Content-Type':'application/pdf'}}));
  await assert.rejects(pdf,/account changed/);
  values.set('repaido.token','account-a');response=delayed();
  const photo=service.b2bService.uploadPhoto(new File(['photo'],'site.jpg',{type:'image/jpeg'}),'shop-a');await response.entered;
  values.set('repaido.token','account-b');response.finish(ok({image_url:'/api/operations/b2b/photos/private-a'}));
  await assert.rejects(photo,/account changed/);
  let tokenReady;const token=new Promise(resolve=>{tokenReady=resolve;});
  globalThis.__b2bAuth.currentUser={uid:'firebase-a',getIdToken:()=>token};
  const before=calls.length,pending=service.b2bService.downloadQuotation('private-quote');
  await new Promise(resolve=>setTimeout(resolve,0));
  globalThis.__b2bAuth.currentUser={uid:'firebase-b',getIdToken:async()=>'token-b'};tokenReady('token-a');
  await assert.rejects(pending,/account changed/);assert.equal(calls.length,before,'A stale token lookup cannot start a private download.');
});

test('actual quantity and GST previews use paise at tier boundaries without claiming a saved price',()=>{
  const item=service.listingFromServer(listing);
  assert.equal(slabRatePaise(item,24),145075);assert.equal(slabRatePaise(item,25),132050);assert.equal(slabRatePaise(item,100),132050);
  assert.deepEqual(quotationTotals(25,132050,1800,65025),{taxablePaise:3301250,gstPaise:594225,freightPaise:65025,totalPaise:3960500});
  assert.deepEqual(quotationTotals(1,105,1000,0),{taxablePaise:105,gstPaise:11,freightPaise:0,totalPaise:116},'GST half-paise rounds up in the shared production calculation.');
});
