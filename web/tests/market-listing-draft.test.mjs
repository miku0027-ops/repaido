import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/services/marketListingDraft.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const market=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const storage=new Map();let account=0;
beforeEach(()=>{account++;storage.clear();globalThis.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};});
function valid(){const draft=market.freshListingDraft();Object.assign(draft.fields,{name:'Samsung Galaxy M34',brand:'Samsung',value:'8000',purchase:'20000',age:'18',year:'2024',condition:'Working well, small scratch. Charger included.',warranty:'No warranty',reason:'Upgrading my phone',city:'Balasore',desired_type:'computer',desired_product:'Working laptop'});draft.pin={lat:21.4934,lng:86.9135};draft.consent=true;return draft;}
test('validation requires truthful photo, confirmed pin and consent while preserving exchange constraints',()=>{
 const draft=valid();assert.deepEqual(market.listingErrors(draft,'second_hand',true,2026),{});
 draft.pin=null;draft.consent=false;const errors=market.listingErrors(draft,'second_hand',false,2026);assert.ok(errors.pin);assert.ok(errors.photo);assert.ok(errors.consent);
 draft.fields.desired_product='';assert.ok(market.listingErrors(draft,'exchange',true,2026).desired_product);assert.equal(market.listingErrors(draft,'second_hand',true,2026).desired_product,undefined);
 for(const [field,value] of [['value','99'],['purchase','0'],['age','1.5'],['year','2027'],['condition','short'],['warranty',''],['reason','a'],['city','x']]){const candidate=valid();candidate.fields[field]=value;assert.ok(market.listingErrors(candidate,'second_hand',true,2026)[field],field);}
});
test('strict pins drop metadata and reject nonfinite, string and out-of-bounds coordinates',()=>{
 assert.deepEqual(market.strictListingPin({lat:0,lng:180,accuracy:10,address:'ignored'}),{lat:0,lng:180});
 for(const pin of [null,{lat:NaN,lng:1},{lat:91,lng:1},{lat:1,lng:181},{lat:'21',lng:86},{lat:1,lng:Infinity}])assert.equal(market.strictListingPin(pin),null);
});
test('photo selection permits only nonempty JPEG and PNG up to 5 MiB',()=>{
 for(const type of ['image/jpeg','image/png'])assert.equal(market.photoSelectionError({type,size:5*1024*1024}),'');
 for(const file of [{type:'image/webp',size:10},{type:'image/png',size:0},{type:'image/jpeg',size:5*1024*1024+1}])assert.match(market.photoSelectionError(file),/JPG or PNG/);
});
test('payload matches the API shape and uses whole-paise prices and coordinates only',()=>{
 const draft=valid(),payload=market.listingPayload(draft,'second_hand','owned-photo');
 assert.equal(payload.value_paise,800000);assert.equal(payload.purchase_paise,2000000);assert.equal(payload.share_contact,true);assert.equal(payload.photo_id,'owned-photo');assert.equal(payload.request_id,draft.requestId);assert.equal(payload.desired_type,null);assert.equal(payload.desired_product,'');assert.deepEqual(payload.location,{lat:21.4934,lng:86.9135});
 assert.equal(market.listingPayload(draft,'exchange','owned-photo').desired_type,'computer');assert.equal(Object.hasOwn(payload,'consent'),false);assert.equal(Object.hasOwn(payload,'step'),false);
});
test('drafts and files remain scoped to the signed-in account and marketplace mode',()=>{
 const draft=valid(),file={name:'private-photo.png'};market.keepListingDraft('seller-'+account,'second_hand',draft,file);
 const restored=market.readListingDraft('seller-'+account,'second_hand');assert.equal(restored.restored,true);assert.equal(restored.file,file);assert.equal(restored.draft.fields.name,draft.fields.name);
 assert.equal(market.readListingDraft('other-'+account,'second_hand').restored,false);assert.equal(market.readListingDraft('seller-'+account,'exchange').restored,false);
 market.clearListingDraft('seller-'+account,'second_hand');assert.equal(market.readListingDraft('seller-'+account,'second_hand').restored,false);
});
test('uncertain requests retain exact intent and request identity across session-storage restoration',()=>{
 const draft=valid();draft.photoId='confirmed-photo';draft.photoName='phone.png';draft.step=3;draft.pending=market.listingPayload(draft,'second_hand',draft.photoId);
 // Simulate storage surviving reload while the module memory starts empty.
 storage.set('repaido.market-draft.v1:reloaded-'+account+':second_hand',JSON.stringify(draft));
 const result=market.readListingDraft('reloaded-'+account,'second_hand');assert.equal(result.file,null);assert.equal(result.draft.photoId,'confirmed-photo');assert.deepEqual(result.draft.pending,draft.pending);assert.equal(result.draft.requestId,draft.requestId);assert.equal(result.draft.step,3);
});
test('a selected local photo requests reselection after reload and storage failure does not lose the open draft',()=>{
 const draft=valid();draft.photoName='local-only.png';storage.set('repaido.market-draft.v1:photo-reload-'+account+':second_hand',JSON.stringify(draft));
 const restored=market.readListingDraft('photo-reload-'+account,'second_hand');assert.equal(restored.file,null);assert.equal(restored.draft.photoName,'local-only.png');assert.ok(market.listingErrors(restored.draft,'second_hand',false,2026).photo);
 globalThis.sessionStorage.setItem=()=>{throw new Error('Storage blocked');};assert.equal(market.keepListingDraft('memory-'+account,'second_hand',draft,null),false);assert.equal(market.readListingDraft('memory-'+account,'second_hand').draft.fields.name,draft.fields.name);
});
test('a later access or validation failure never retires a prior uncertain request',()=>{
 for(const status of [undefined,400,401,403,409,422,429,500,503])assert.equal(market.canReviseListingAfterFailure(status,true),false);
 for(const status of [400,401,403,422,429])assert.equal(market.canReviseListingAfterFailure(status,false),true);
 for(const status of [undefined,409,500,503])assert.equal(market.canReviseListingAfterFailure(status,false),false);
});
test('explicit guest sign-in resumes fields and local photo without carrying consent or acknowledged requests',()=>{
 const guest=valid(),file={name:'guest-photo.png'};guest.photoId='never-transfer';guest.pending=market.listingPayload(guest,'second_hand',guest.photoId);market.keepListingDraft('guest','second_hand',guest,file);
 assert.equal(market.claimGuestListingDraft('signed-in-'+account,'second_hand',{draft:guest,file}),'resumed');
 const resumed=market.readListingDraft('signed-in-'+account,'second_hand');assert.equal(resumed.draft.fields.condition,guest.fields.condition);assert.equal(resumed.file,file);assert.equal(resumed.draft.consent,false);assert.equal(resumed.draft.photoId,'');assert.equal(resumed.draft.pending,null);assert.notEqual(resumed.draft.requestId,guest.requestId);assert.equal(market.readListingDraft('guest','second_hand').restored,false);
});
test('an explicit guest resume keeps the existing account draft and queues the new item until it is finished',()=>{
 const existing=valid();existing.fields.name='Existing account item';const guest=valid();guest.fields.name='New guest item';const uid='existing-seller-'+account;market.keepListingDraft(uid,'second_hand',existing,null);
 assert.equal(market.claimGuestListingDraft(uid,'second_hand',{draft:guest,file:null}),'queued');assert.equal(market.readListingDraft(uid,'second_hand').draft.fields.name,'Existing account item');assert.equal(market.hasIncomingGuestDraft(uid,'second_hand'),true);
 market.clearListingDraft(uid,'second_hand');assert.equal(market.readListingDraft(uid,'second_hand').draft.fields.name,'New guest item');assert.equal(market.hasIncomingGuestDraft(uid,'second_hand'),false);assert.equal(market.readListingDraft('different-seller-'+account,'second_hand').restored,false);
});
