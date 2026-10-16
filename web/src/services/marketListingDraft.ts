/** Local form state only. A listing exists only after the API confirms it. */
export type ListingMode='exchange'|'second_hand';
export const listingTypes=['phone','computer','television','appliance','camera','audio','tools','other'] as const;
export const listingTypeLabels:Record<string,string>={phone:'Phones & tablets',computer:'Laptops & computers',television:'TVs & screens',appliance:'Appliances',camera:'Cameras',audio:'Audio & sound',tools:'Tools',other:'Other'};
export type ListingFields={name:string;brand:string;type:string;value:string;purchase:string;age:string;year:string;condition:string;warranty:string;reason:string;city:string;desired_type:string;desired_product:string;radius:string};
export type ListingPin={lat:number;lng:number};
export type ListingPayload={request_id:string;mode:ListingMode;name:string;brand:string;product_type:string;desired_type:string|null;desired_product:string;value_paise:number;purchase_paise:number;age_months:number;manufacture_year:number;condition:string;warranty:string;reason:string;city:string;location:ListingPin;radius_km:number;photo_id:string;share_contact:true};
export type ListingDraft={version:1;fields:ListingFields;pin:ListingPin|null;step:number;requestId:string;photoId:string;photoName:string;consent:boolean;pending:ListingPayload|null};
export type ListingField=keyof ListingFields|'photo'|'pin'|'consent';
export type ListingErrors=Partial<Record<ListingField,string>>;
export const listingSteps=['Item','Condition','Photo & location','Review'];
export const fieldsByStep:ListingField[][]=[['name','brand','type','value','purchase','desired_type','desired_product'],['age','year','condition','warranty','reason'],['photo','city','pin','radius'],['consent']];
const draftMemory=new Map<string,{draft:ListingDraft;file:File|null}>();
const incomingGuestDrafts=new Map<string,{draft:ListingDraft;file:File|null}>();
const keyFor=(account:string,mode:ListingMode)=>`repaido.market-draft.v1:${encodeURIComponent(account)}:${mode}`;
const id=()=>crypto.randomUUID();
export function freshListingDraft():ListingDraft{return {version:1,fields:{name:'',brand:'',type:'phone',value:'',purchase:'',age:'',year:'',condition:'',warranty:'',reason:'',city:'',desired_type:'phone',desired_product:'',radius:'10'},pin:null,step:0,requestId:id(),photoId:'',photoName:'',consent:false,pending:null};}
export function strictListingPin(pin:unknown):ListingPin|null {
 if(!pin||typeof pin!=='object')return null;
 const {lat,lng}=pin as ListingPin;
 return typeof lat==='number'&&Number.isFinite(lat)&&Math.abs(lat)<=90&&typeof lng==='number'&&Number.isFinite(lng)&&Math.abs(lng)<=180?{lat,lng}:null;
}
export function hasIncomingGuestDraft(account:string,mode:ListingMode):boolean {
 const key=keyFor(account,mode);if(incomingGuestDrafts.has(key))return true;
 try{return !!sessionStorage.getItem(key+':incoming');}catch{return false;}
}
function takeIncomingGuestDraft(account:string,mode:ListingMode):{draft:ListingDraft;file:File|null;restored:boolean}|null {
 const key=keyFor(account,mode);let incoming=incomingGuestDrafts.get(key);
 if(!incoming){try{const raw=sessionStorage.getItem(key+':incoming');if(raw)incoming={draft:JSON.parse(raw),file:null};}catch{/* The normal empty draft remains available. */}}
 if(!incoming||incoming.draft?.version!==1)return null;
 incomingGuestDrafts.delete(key);try{sessionStorage.removeItem(key+':incoming');}catch{/* Memory still retains the adopted draft. */}
 keepListingDraft(account,mode,incoming.draft,incoming.file);return {...incoming,restored:true};
}
/** Call only after the user explicitly chooses to sign in from a guest draft. */
export function claimGuestListingDraft(account:string,mode:ListingMode,captured:{draft:ListingDraft;file:File|null}):'resumed'|'queued' {
 const draft:ListingDraft={...captured.draft,fields:{...captured.draft.fields},consent:false,photoId:'',pending:null,requestId:id()};
 const existing=readListingDraft(account,mode);clearListingDraft('guest',mode);
 if(existing.restored){const key=keyFor(account,mode);incomingGuestDrafts.set(key,{draft,file:captured.file});try{sessionStorage.setItem(key+':incoming',JSON.stringify(draft));}catch{/* A selected photo remains in memory. */}return 'queued';}
 keepListingDraft(account,mode,draft,captured.file);return 'resumed';
}
export function readListingDraft(account:string,mode:ListingMode):{draft:ListingDraft;file:File|null;restored:boolean}{
 const key=keyFor(account,mode),memory=draftMemory.get(key);
 if(memory)return {...memory,restored:true};
 try{
  const raw=sessionStorage.getItem(key);if(!raw)return takeIncomingGuestDraft(account,mode)||{draft:freshListingDraft(),file:null,restored:false};
  const stored=JSON.parse(raw),empty=freshListingDraft();
  if(stored.version!==1||!stored.fields||typeof stored.requestId!=='string')throw new Error('Unsupported draft');
  for(const field of Object.keys(empty.fields) as (keyof ListingFields)[])if(typeof stored.fields[field]==='string')empty.fields[field]=stored.fields[field];
  empty.pin=strictListingPin(stored.pin);empty.step=Number.isInteger(stored.step)?Math.max(0,Math.min(3,stored.step)):0;
  empty.requestId=stored.requestId;empty.photoName=typeof stored.photoName==='string'?stored.photoName:'';
  // The browser cannot restore a File. An acknowledged upload can be reused by
  // its owner, especially when replaying an uncertain listing request.
  empty.photoId=typeof stored.photoId==='string'?stored.photoId:'';
  empty.consent=stored.consent===true;
  if(stored.pending&&stored.pending.request_id===empty.requestId&&stored.pending.mode===mode&&stored.pending.photo_id===empty.photoId&&strictListingPin(stored.pending.location))empty.pending=stored.pending;
  return {draft:empty,file:null,restored:true};
 }catch{return takeIncomingGuestDraft(account,mode)||{draft:freshListingDraft(),file:null,restored:false};}
}
export function keepListingDraft(account:string,mode:ListingMode,draft:ListingDraft,file:File|null):boolean {
 const key=keyFor(account,mode);draftMemory.set(key,{draft,file});
 try{sessionStorage.setItem(key,JSON.stringify(draft));return true;}catch{return false;}
}
export function clearListingDraft(account:string,mode:ListingMode){const key=keyFor(account,mode);draftMemory.delete(key);try{sessionStorage.removeItem(key);}catch{/* Memory is already cleared. */}}
export function photoSelectionError(file:Pick<File,'type'|'size'>):string{return !['image/jpeg','image/png'].includes(file.type)||file.size<=0||file.size>5*1024*1024?'Choose a JPG or PNG photo, up to 5 MB.':'';}
export function canReviseListingAfterFailure(status:number|undefined,wasRetry:boolean):boolean {
 // Once any prior outcome is uncertain, a later access rejection cannot prove
 // that the original request was not saved. Keep replaying its original key.
 return !wasRetry&&!!status&&[400,401,402,403,404,413,415,422,429].includes(status);
}
export function listingErrors(draft:ListingDraft,mode:ListingMode,hasFile:boolean,year=new Date().getFullYear()):ListingErrors {
 const f=draft.fields,e:ListingErrors={};
 const text=(field:keyof ListingFields,min:number,max:number,message:string)=>{if(f[field].trim().length<min||f[field].length>max)e[field]=message;};
 const integer=(field:keyof ListingFields,min:number,max:number,message:string)=>{if(!f[field].trim()||!Number.isInteger(Number(f[field]))||Number(f[field])<min||Number(f[field])>max)e[field]=message;};
 text('name',3,120,'Enter an item name with 3–120 characters.');text('brand',2,80,'Enter a brand with 2–80 characters.');
 if(!listingTypes.includes(f.type as typeof listingTypes[number]))e.type='Choose an item category.';
 integer('value',100,1000000,'Enter a whole rupee amount from ₹100 to ₹10,00,000.');integer('purchase',1,1000000,'Enter the original price from ₹1 to ₹10,00,000.');
 integer('age',0,600,'Enter the item’s age from 0 to 600 months.');integer('year',1970,year,`Enter a manufacture year from 1970 to ${year}.`);
 text('condition',10,1500,'Describe the condition in at least 10 characters.');text('warranty',3,500,'Add warranty details, or write “No warranty”.');text('reason',5,500,'Add a reason with at least 5 characters.');text('city',2,80,'Enter the city where your item is located.');
 integer('radius',1,100,'Choose a radius from 1 to 100 km.');
 if(mode==='exchange'){if(!listingTypes.includes(f.desired_type as typeof listingTypes[number]))e.desired_type='Choose the category you want.';text('desired_product',3,200,'Describe the item you want in at least 3 characters.');}
 if(!hasFile&&!draft.photoId)e.photo='Add a clear photo of your item.';
 if(!strictListingPin(draft.pin))e.pin='Choose and confirm the item’s location.';
 if(!draft.consent)e.consent='Confirm the details and seller contact consent to continue.';
 return e;
}
export function listingPayload(draft:ListingDraft,mode:ListingMode,photoId:string):ListingPayload {
 const f=draft.fields,pin=strictListingPin(draft.pin);if(!pin)throw new Error('Choose and confirm the item’s location.');
 return {request_id:draft.requestId,mode,name:f.name.trim(),brand:f.brand.trim(),product_type:f.type,desired_type:mode==='exchange'?f.desired_type:null,desired_product:mode==='exchange'?f.desired_product.trim():'',value_paise:Math.round(Number(f.value)*100),purchase_paise:Math.round(Number(f.purchase)*100),age_months:Number(f.age),manufacture_year:Number(f.year),condition:f.condition.trim(),warranty:f.warranty.trim(),reason:f.reason.trim(),city:f.city.trim(),location:pin,radius_km:Number(f.radius),photo_id:photoId,share_contact:true};
}
