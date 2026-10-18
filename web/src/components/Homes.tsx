import {AdminTable, AdminStatus} from './AdminTable';
import {CustomerActivityHub} from './CustomerActivityHub';
import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {Home,MapPin,RefreshCw,Apartment,RealEstateAgent,EventAvailable} from '../icons';
import {operation,money} from '../services/operations';
import {apiFetch,apiAssetUrl} from '../services/api';
import {auth} from '../firebase';
import {Modal} from './ui';
import './homes.css';
type HomeListing={id:string;version:number;title:string;city:string;locality:string;property_type:string;bedrooms:number;furnishing:string;rent_paise:number;deposit_paise:number;description:string;available_from:string;photo_id:string;image_url:string;status:string;review_reason?:string};
type Enquiry={id:string;title:string;version:number;state:string;is_owner:boolean;viewing_at:number;messages:{side:string;text:string;at:number;viewing_at?:number}[]};
const post=(path:string,body:object)=>operation(path,{method:'POST',body:JSON.stringify(body)});
type HomesProps={admin?:boolean;onSignIn?:()=>void;initialTab?:'browse'|'mine'|'enquiries';initialListingId?:string};
const account=()=>auth.currentUser?.uid||localStorage.getItem('repaido.token')||'';
export function Homes(props:HomesProps){
 const [identity,setIdentity]=useState(account);
 useEffect(()=>{const sync=()=>setIdentity(account());const stop=onIdTokenChanged(auth,sync);window.addEventListener('storage',sync);return()=>{stop();window.removeEventListener('storage',sync);};},[]);
 return <HomesSession key={identity} {...props}/>;
}
function HomesSession({admin=false,onSignIn,initialTab='browse',initialListingId}:HomesProps){
 const [tab,setTab]=useState(initialTab),[items,setItems]=useState<HomeListing[]>([]),[enquiries,setEnquiries]=useState<Enquiry[]>([]),[city,setCity]=useState(''),[rent,setRent]=useState(''),[beds,setBeds]=useState(''),[next,setNext]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState<HomeListing|'new'|null>(null),[selected,setSelected]=useState<HomeListing|null>(null),[review,setReview]=useState<HomeListing|null>(null);
 const seq=useRef(0),appliedFilters=useRef({city:'',rent:'',beds:''});
 const load=async(cursor='')=>{const n=++seq.current;setBusy(true);setError('');try{if(tab==='enquiries'&&!admin){const d=await operation<{items:Enquiry[]}>('/homes/enquiries',{}, {force:true});if(n===seq.current)setEnquiries(d.items);}else{let d:{items:HomeListing[];next_cursor?:string|null};if(admin||tab==='mine')d=await operation(admin?'/admin/homes':'/homes/mine',{}, {force:true});else{const filters=appliedFilters.current;const q=new URLSearchParams({city:filters.city,max_rent:String(Math.round(Number(filters.rent)*100)||0),bedrooms:filters.beds||'-1',cursor});const response=await apiFetch('/api/operations/homes/catalog?'+q,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Homes could not load. Please retry.');d=await response.json();}if(n===seq.current){setItems(old=>cursor?Array.from(new Map([...old,...d.items].map(item=>[item.id,item])).values()):d.items);setNext(d.next_cursor||null);}}}catch(e){if(n===seq.current)setError((e as Error).message);}finally{if(n===seq.current)setBusy(false);}};
 useEffect(()=>{if(!admin)setTab(initialTab);},[initialTab,admin]);
 useEffect(()=>{setItems([]);setEnquiries([]);setNext(null);void load();return()=>{seq.current++;};},[tab,admin]);
 useEffect(()=>{if(tab!=='enquiries')return;const timer=setInterval(()=>{if(!document.hidden)void load();},15000);return()=>clearInterval(timer);},[tab]);
 useEffect(()=>{
  if(admin||!initialListingId)return;
  const controller=new AbortController();setSelected(null);setError('');
  void(async()=>{try{const response=await apiFetch('/api/operations/homes/listings/'+encodeURIComponent(initialListingId),{signal:controller.signal});if(!response.ok)throw Error('This property is no longer available. Browse current homes below.');const item=await response.json();if(!controller.signal.aborted){setTab('browse');setSelected(item);}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}})();
  return()=>controller.abort();
 },[initialListingId,admin]);
 const state=async(item:HomeListing,value:string)=>{setBusy(true);try{await post(`/homes/listings/${item.id}/state`,{expected_version:item.version,state:value});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="homes-panel"><header className="homes-hero"><Apartment size={28} aria-hidden="true"/><div><small>REPAIDO HOMES · RENTALS</small><h2>{admin?'Property review':'Find your next address'}</h2><p>Monthly homes. Clear terms. Arrange a viewing.</p></div></header>{!admin&&<nav className="homes-tabs" aria-label="Home rental sections">{[['browse','Find a home'],['mine','My properties'],['enquiries','My enquiries']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id as typeof tab)}>{label}</button>)}</nav>}
 {tab==='browse'&&!admin&&<form className="homes-filters" onSubmit={e=>{e.preventDefault();appliedFilters.current={city,rent,beds};void load();}}><label>City<input value={city} onChange={e=>setCity(e.target.value)} placeholder="All cities" maxLength={80}/></label><label>Max rent / month (₹)<input type="number" min="0" value={rent} onChange={e=>setRent(e.target.value)} placeholder="Any budget"/></label><label>Bedrooms<select value={beds} onChange={e=>setBeds(e.target.value)}><option value="">Any</option>{[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n===0?'Studio':n}</option>)}</select></label><button disabled={busy}>Find homes</button><button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await post('/customer-hub/saved',{kind:'home_search',label:`Homes · ${city||'all cities'}`,city,max_rent:Math.round(Number(rent)*100)||0,bedrooms:Number(beds||-1)});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Save search</button></form>}
 <div className="homes-toolbar">{tab==='mine'&&!admin&&<button onClick={()=>setForm('new')}><RealEstateAgent size={18} aria-hidden="true"/>List a home</button>}<button disabled={busy} onClick={()=>void load()} aria-label="Refresh homes"><RefreshCw size={16}/></button></div>
 {busy&&<p role="status">Updating homes…</p>}{error&&<div role="alert"><p>{error}</p>{onSignIn&&<button onClick={onSignIn}>Sign in</button>}<button onClick={()=>void load()}>Retry</button></div>}
 {admin?<AdminTable label="Property listings" rows={items} rowKey={item=>item.id} rowLabel={item=>item.title} loading={busy} error={!!error} empty="No property listings awaiting review." columns={[
 {key:'title',label:'Property',value:item=>item.title},
 {key:'city',label:'Location',value:item=>item.city,render:item=><>{item.city}<small>{item.locality}</small></>},
 {key:'type',label:'Type / bedrooms',value:item=>item.property_type,render:item=><>{item.property_type}<small>{item.bedrooms?`${item.bedrooms} bedrooms`:'Studio'}</small></>},
 {key:'rent',label:'Monthly rent',value:item=>item.rent_paise,numeric:true,render:item=>money(item.rent_paise)},
 {key:'state',label:'Status',value:item=>item.status,render:item=><AdminStatus value={item.status}/>},
 ]} renderDetail={item=><><p>{item.description}</p><p>Deposit: {money(item.deposit_paise)} · Available: {item.available_from}</p>{item.review_reason&&<p>{item.review_reason}</p>}<button onClick={()=>setReview(item)}>Review property & private photo</button></>}/>:tab==='enquiries'&&!admin?<div>{enquiries.map(e=><ViewingThread key={e.id} item={e} refresh={()=>void load()}/>)}{!busy&&!error&&!enquiries.length&&<p>No enquiries yet. Open a home to propose a viewing.</p>}</div>:<><div className="homes-grid">{items.map(item=><article className="home-card" key={item.id}>{item.status==='published'?<HomeImage source={item.image_url} title={item.title}/>:<div className="home-photo-pending"><Home size={32}/><span>Photo appears after review</span></div>}<div><small>{item.property_type} · {item.bedrooms?`${item.bedrooms} bedroom`:'Studio'} · {item.furnishing}</small><h3>{item.title}</h3><p><MapPin size={14}/>{item.locality}, {item.city}</p><strong>{money(item.rent_paise)}<small> / month</small></strong><p>Deposit {money(item.deposit_paise)}</p>{tab==='mine'||admin?<><span className="home-status">{item.status.replaceAll('_',' ')}</span>{item.review_reason&&<p>{item.review_reason}</p>}{admin?<button onClick={()=>setReview(item)}>Review property</button>:<div className="homes-actions"><button onClick={()=>setForm(item)}>Edit</button>{item.status==='published'?<><button disabled={busy} onClick={()=>void state(item,'paused')}>Pause</button><button disabled={busy} onClick={()=>void state(item,'let')}>Mark let</button></>:item.status!=='pending_review'&&<button disabled={busy} onClick={()=>void state(item,'pending_review')}>Submit for review</button>}</div>}</>:<div className="homes-actions"><button onClick={()=>setSelected(item)}>Details & viewing <EventAvailable size={18} aria-hidden="true"/></button><button disabled={busy} onClick={async()=>{setBusy(true);try{await post('/customer-hub/saved',{kind:'home',reference:item.id,label:item.title});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Save home</button></div>}</div></article>)}</div>{!busy&&!error&&!items.length&&<p>No homes in this view yet. Try another city or budget.</p>}{next&&<button disabled={busy} onClick={()=>void load(next)}>Show more homes</button>}</>}
 {!admin&&<CustomerActivityHub/>}<p className="homes-note">Visit before agreeing to a tenancy. Listing review is not a title or ownership guarantee. Rent and deposits are not collected through this enquiry flow.</p>
 {form&&<HomeForm item={form==='new'?null:form} onClose={()=>setForm(null)} onSaved={()=>{setForm(null);void load();}}/>}{selected&&<HomeDetails item={selected} onClose={()=>setSelected(null)} onSent={()=>{setSelected(null);setTab('enquiries');}}/>}
 {review&&<HomeReview item={review} onClose={()=>setReview(null)} onSaved={()=>{setReview(null);void load();}}/>}
 </section>;
}
function HomeForm({item,onClose,onSaved}:{item:HomeListing|null;onClose:()=>void;onSaved:()=>void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const id=useRef(item?.id||crypto.randomUUID()),photo=useRef(item?.photo_id||''),identity=useRef(account());
 const upload=useRef<{requestId:string;photoId?:string}|null>(null),sending=useRef(false),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 return <Modal title={item?'Edit your property':'List a home for rent'} onClose={()=>{if(!sending.current)onClose();}}><form className="homes-form" onSubmit={async e=>{
  e.preventDefault();if(sending.current)return;sending.current=true;
  const data=new FormData(e.currentTarget);controller.current=new AbortController();const signal=controller.current.signal;setBusy(true);setError('');
  try{
   const file=data.get('photo') as File;
   if(file?.size){
    if(file.size>5*1024*1024||!['image/jpeg','image/png'].includes(file.type))throw Error('Choose a JPG or PNG photo up to 5 MB.');
    upload.current??={requestId:crypto.randomUUID()};
    if(!upload.current.photoId){
     const token=auth.currentUser?await auth.currentUser.getIdToken():localStorage.getItem('repaido.token');
     if(!token)throw Error('Sign in with your verified mobile first.');
     if(account()!==identity.current)throw Error('Your account changed. Reopen this form.');
     const response=await apiFetch('/api/operations/homes/photos',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':file.type,'X-Upload-ID':upload.current.requestId},body:file,signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
     const uploaded=await response.json();if(!response.ok)throw Error(uploaded.detail?.message||'Photo upload failed.');
     upload.current.photoId=uploaded.id;
    }
    photo.current=upload.current.photoId!;
   }
   if(!photo.current)throw Error('Add a property photo.');
   if(signal.aborted||account()!==identity.current)throw Error('Your account changed. Reopen this form.');
   await operation(`/homes/listings/${id.current}`,{method:'PUT',signal,body:JSON.stringify({expected_version:item?.version||0,title:data.get('title'),city:data.get('city'),locality:data.get('locality'),property_type:data.get('property_type'),bedrooms:Number(data.get('bedrooms')),furnishing:data.get('furnishing'),rent_paise:Math.round(Number(data.get('rent'))*100),deposit_paise:Math.round(Number(data.get('deposit'))*100),description:data.get('description'),available_from:data.get('available_from'),photo_id:photo.current,authority_confirmed:data.get('authority')==='on'})});
   if(!signal.aborted)onSaved();
  }catch(e){if(!signal.aborted)setError((e as Error).message);}finally{sending.current=false;if(!signal.aborted)setBusy(false);}
 }}>
 <p>Share the locality, not your exact address or personal contact details. New listings and edits are reviewed before publication.</p>
 <label>Listing title<input name="title" required minLength={5} maxLength={100} defaultValue={item?.title} placeholder="Bright 2-bedroom apartment"/></label><div className="homes-fields"><label>City<input name="city" required minLength={2} maxLength={80} defaultValue={item?.city}/></label><label>Locality<input name="locality" required minLength={2} maxLength={100} defaultValue={item?.locality}/></label><label>Property<select name="property_type" defaultValue={item?.property_type||'apartment'}>{['apartment','house','room'].map(x=><option key={x}>{x}</option>)}</select></label><label>Bedrooms<input name="bedrooms" type="number" min="0" max="20" required defaultValue={item?.bedrooms??1}/></label><label>Monthly rent (₹)<input name="rent" type="number" min="1" max="1000000" step="0.01" required defaultValue={item?item.rent_paise/100:undefined}/></label><label>Deposit (₹)<input name="deposit" type="number" min="0" max="10000000" step="0.01" required defaultValue={item?item.deposit_paise/100:0}/></label><label>Furnishing<select name="furnishing" defaultValue={item?.furnishing||'unfurnished'}>{['unfurnished','semi-furnished','furnished'].map(x=><option key={x}>{x}</option>)}</select></label><label>Available from<input name="available_from" type="date" required defaultValue={item?.available_from}/></label></div>
 <label>Amenities, costs & terms<textarea name="description" required minLength={20} maxLength={2000} defaultValue={item?.description} placeholder="Floor, bathrooms, parking, maintenance charges and viewing arrangements"/></label><label>Property photo · JPG/PNG, up to 5 MB<input name="photo" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={()=>{upload.current=null;}} required={!photo.current}/></label><label className="home-consent"><input type="checkbox" name="authority" required/>I own this property or have permission to list it. These details and photos are accurate.</label>{error&&<p role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy?'Submitting…':'Submit for review'}</button></form></Modal>;
}
function HomeDetails({item,onClose,onSent}:{item:HomeListing;onClose:()=>void;onSent:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const sending=useRef(false),intent=useRef<{payload:string;requestId:string}|null>(null),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 return <Modal title={item.title} onClose={()=>{if(!sending.current)onClose();}}><div className="homes-form"><HomeImage source={item.image_url} title={item.title} detail/><strong>{money(item.rent_paise)} / month · Deposit {money(item.deposit_paise)}</strong><p>{item.locality}, {item.city} · Available {item.available_from}</p><p style={{whiteSpace:'pre-wrap'}}>{item.description}</p><form className="homes-form" onSubmit={async e=>{
  e.preventDefault();if(sending.current)return;sending.current=true;
  const d=new FormData(e.currentTarget),payload=JSON.stringify({message:d.get('message'),viewing_at:new Date(String(d.get('viewing'))).getTime()/1000});
  if(intent.current?.payload!==payload)intent.current={payload,requestId:crypto.randomUUID()};
  controller.current=new AbortController();const signal=controller.current.signal;setBusy(true);setError('');
  try{await operation(`/homes/listings/${item.id}/enquiry`,{method:'POST',signal,body:JSON.stringify({...JSON.parse(payload),request_id:intent.current.requestId})});if(!signal.aborted)onSent();}catch(e){if(!signal.aborted)setError((e as Error).message);}finally{sending.current=false;if(!signal.aborted)setBusy(false);}
 }}><label>Propose a viewing (your local time)<input name="viewing" type="datetime-local" required/></label><label>Message to owner<textarea name="message" required minLength={5} maxLength={1000} defaultValue="I am interested in this home. Is this viewing time suitable?"/></label>{error&&<p role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy?'Sending…':'Request viewing'}</button><button type="button" disabled={busy} onClick={onSent}>View my enquiries</button></form></div></Modal>;
}
function ViewingThread({item,refresh}:{item:Enquiry;refresh:()=>void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[text,setText]=useState('');
 const intent=useRef<{action:string;message:string;payload:object}|null>(null),sending=useRef(false),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const send=async(action:string)=>{
  if(sending.current)return;sending.current=true;setBusy(true);setError('');
  const message=text.trim()||action.replaceAll('_',' ');
  if(intent.current?.action!==action||intent.current.message!==message)intent.current={action,message,payload:{expected_version:item.version,action,message,request_id:crypto.randomUUID()}};
  controller.current=new AbortController();const signal=controller.current.signal;
  try{await operation(`/homes/enquiries/${item.id}/reply`,{method:'POST',signal,body:JSON.stringify(intent.current.payload)});if(!signal.aborted){intent.current=null;setText('');refresh();}}catch(e){if(!signal.aborted)setError((e as Error).message);}finally{sending.current=false;if(!signal.aborted)setBusy(false);}
 };
 const closed=['declined','cancelled','completed'].includes(item.state);
 return <details className="home-thread"><summary>{item.title}<small>{item.state} · {new Date(item.viewing_at*1000).toLocaleString()}</small></summary><div className="home-messages">{item.messages.map((m,i)=><p key={i}><strong>{m.side==='owner'?'Owner':'Visitor'}</strong><span>{m.text}</span>{m.viewing_at&&<small>Proposed viewing: {new Date(m.viewing_at*1000).toLocaleString()}</small>}<small>{new Date(m.at*1000).toLocaleString()}</small></p>)}</div>{!closed&&<><label>Reply<textarea value={text} maxLength={1000} onChange={e=>setText(e.target.value)}/></label><div className="homes-actions"><button disabled={busy||!text.trim()} onClick={()=>void send('reply')}>Send</button>{item.is_owner?<><button disabled={busy||item.state==='confirmed'||item.viewing_at<=Date.now()/1000} onClick={()=>void send('confirm_viewing')}>Confirm viewing</button><button disabled={busy} onClick={()=>void send('decline')}>Decline</button>{item.state==='confirmed'&&item.viewing_at<Date.now()/1000&&<button disabled={busy} onClick={()=>void send('complete')}>Viewing completed</button>}</>:<button disabled={busy} onClick={()=>void send('cancel')}>Cancel enquiry</button>}</div></>}{error&&<p role="alert">{error}</p>}</details>;
}
function HomeReview({item,onClose,onSaved}:{item:HomeListing;onClose:()=>void;onSaved:()=>void}){
 const [photoReady,setPhotoReady]=useState(false),[decision,setDecision]=useState('published'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sending=useRef(false),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 return <Modal title="Review home listing" onClose={()=>{if(!sending.current)onClose();}}><div className="homes-form"><ReviewPhoto photoId={item.photo_id} onReady={setPhotoReady}/><h3>{item.title}</h3><p>{item.locality}, {item.city} · {item.property_type} · {item.bedrooms} bedrooms · {item.furnishing}</p><p>{money(item.rent_paise)} / month · Deposit {money(item.deposit_paise)} · Available {item.available_from}</p><p style={{whiteSpace:'pre-wrap'}}>{item.description}</p><form className="homes-form" onSubmit={async e=>{
  e.preventDefault();if(sending.current||(decision==='published'&&!photoReady))return;sending.current=true;
  const data=new FormData(e.currentTarget);controller.current=new AbortController();const signal=controller.current.signal;setBusy(true);setError('');
  try{await operation(`/admin/homes/${item.id}/review`,{method:'POST',signal,body:JSON.stringify({expected_version:item.version,decision,reason:data.get('reason')})});if(!signal.aborted)onSaved();}catch(e){if(!signal.aborted)setError((e as Error).message);}finally{sending.current=false;if(!signal.aborted)setBusy(false);}
 }}><label>Decision<select value={decision} onChange={e=>setDecision(e.target.value)}><option value="published">Publish</option><option value="rejected">Request changes / reject</option></select></label><label>Review findings<textarea name="reason" required minLength={10} maxLength={500}/></label>{!photoReady&&decision==='published'&&<p>Check the property photo before publishing.</p>}{error&&<p role="alert">{error}</p>}<button type="submit" disabled={busy||(decision==='published'&&!photoReady)}>Save review</button></form></div></Modal>;
}
function ReviewPhoto({photoId,onReady}:{photoId:string;onReady:(ready:boolean)=>void}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true,object='';const controller=new AbortController();onReady(false);setUrl('');setError('');
  void(async()=>{try{
   const scope=account(),token=auth.currentUser?await auth.currentUser.getIdToken():localStorage.getItem('repaido.token');
   if(!token||scope!==account())throw Error('Sign in again before reviewing photos.');
   const response=await apiFetch(`/api/operations/admin/homes/photos/${photoId}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
   if(!response.ok)throw Error('Property photo could not load. Retry before publishing.');
   object=URL.createObjectURL(await response.blob());if(active&&scope===account())setUrl(object);else URL.revokeObjectURL(object);
  }catch(e){if(active)setError((e as Error).message);}})();
  return()=>{active=false;controller.abort();if(object)URL.revokeObjectURL(object);};
 },[photoId,onReady,attempt]);
 return error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setAttempt(x=>x+1)}>Retry photo</button></div>:url?<img className="home-detail-image" src={url} alt="Property photo for moderation" onLoad={()=>onReady(true)} onError={()=>{onReady(false);setError('Property photo could not display. Retry before publishing.');}}/>:<p role="status">Loading private property photo…</p>;
}

function HomeImage({source,title,detail=false}:{source:string;title:string;detail?:boolean}){
 const [failed,setFailed]=useState('');
 return source&&source!==failed?<img className={detail?'home-detail-image':undefined} src={apiAssetUrl(source)} alt={title} loading="lazy" onError={()=>setFailed(source)}/>:<div className="home-photo-pending" role="img" aria-label="Property photo temporarily unavailable"><Home size={32} aria-hidden="true"/><span>Photo temporarily unavailable</span></div>;
}
