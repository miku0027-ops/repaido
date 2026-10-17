import {useEffect,useId,useRef,useState,type InputHTMLAttributes} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {ArrowLeft,ArrowRight,Check,CheckCircle2,ImageIcon,ImagePlus,MapPin,ReceiptLong,X} from '../icons';
import {auth} from '../firebase';
import {apiFetch} from '../services/api';
import type {MarketAccess} from '../services/marketAccess';
import {money,operation} from '../services/operations';
import {Modal} from './ui';
import {LocationPickerModal} from './LocationPickerModal';
import type {Item,Mode} from './Marketplace';
import {canReviseListingAfterFailure,claimGuestListingDraft,clearListingDraft,fieldsByStep,hasIncomingGuestDraft,keepListingDraft,listingErrors,listingPayload,listingSteps,listingTypeLabels,listingTypes,photoSelectionError,readListingDraft,strictListingPin,type ListingDraft,type ListingErrors,type ListingField,type ListingFields} from '../services/marketListingDraft';
import './market-listing-form.css';

type Props={mode:Mode;onClose:()=>void;onSaved:(item:Item)=>void;onSignIn?:()=>void;onCheckListings?:()=>void;onAccess?:()=>void;onGuestDraftClaimed?:(account:string)=>void};
let cancelGuestSignIn=()=>{};
function continueGuestDraftAfterSignIn(mode:Mode,captured:{draft:ListingDraft;file:File|null},onClaimed?:Props['onGuestDraftClaimed']){
 cancelGuestSignIn();let unsubscribe=()=>{};let expiry:number|undefined;
 const returnedToDraft=(event:FocusEvent)=>{if(!auth.currentUser&&(event.target as HTMLElement)?.closest('.listing-editor'))cancelGuestSignIn();};
 cancelGuestSignIn=()=>{unsubscribe();window.clearTimeout(expiry);document.removeEventListener('focusin',returnedToDraft);cancelGuestSignIn=()=>{};};
 unsubscribe=onAuthStateChanged(auth,user=>{if(user&&auth.currentUser?.uid===user.uid){claimGuestListingDraft(user.uid,mode,captured);cancelGuestSignIn();onClaimed?.(user.uid);}else if(user){cancelGuestSignIn();}});
 // Returning from a dismissed sign-in dialog cancels this one-time claim.
 document.addEventListener('focusin',returnedToDraft);expiry=window.setTimeout(()=>cancelGuestSignIn(),10*60*1000);
}
export function MarketListingForm(props:Props){
 const [account,setAccount]=useState(()=>auth.currentUser?.uid||'guest');
 useEffect(()=>onAuthStateChanged(auth,()=>setAccount(auth.currentUser?.uid||'guest')),[]);
 return <ListingEditor key={`${account}:${props.mode}`} {...props} account={account}/>;
}
function ListingEditor({mode,account,onClose,onSaved,onSignIn,onCheckListings,onGuestDraftClaimed,onAccess}:Props&{account:string}){
 const [initial]=useState(()=>readListingDraft(account,mode));
 const [draft,setDraft]=useState<ListingDraft>(initial.draft),[file,setFile]=useState<File|null>(initial.file),[preview,setPreview]=useState('');
 const [map,setMap]=useState(false),[busy,setBusy]=useState(false),[phase,setPhase]=useState<'idle'|'uploading'|'saving'>('idle');
 const [error,setError]=useState(''),[errors,setErrors]=useState<ListingErrors>({}),[free,setFree]=useState<boolean|null>(null),[eligibilityError,setEligibilityError]=useState('');
 const [plan,setPlan]=useState<MarketAccess|null>(null),[planRequired,setPlanRequired]=useState(false);
 const [storageAvailable,setStorageAvailable]=useState(true),[discard,setDiscard]=useState(false);
 const formRef=useRef<HTMLFormElement>(null),headingRef=useRef<HTMLHeadingElement>(null),scrollRef=useRef<HTMLDivElement>(null);
 const mounted=useRef(true),submitting=useRef(false),eligibilitySequence=useRef(0),draftRef=useRef(draft),fileRef=useRef(file),requestController=useRef<AbortController|null>(null);
 const prefix=useId(),step=draft.step,pending=!!draft.pending;
 const isCurrent=()=>mounted.current&&(auth.currentUser?.uid||'guest')===account;
 const remember=(next:ListingDraft,nextFile=fileRef.current)=>{draftRef.current=next;fileRef.current=nextFile;setDraft(next);setStorageAvailable(keepListingDraft(account,mode,next,nextFile));};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;eligibilitySequence.current++;requestController.current?.abort();};},[]);
 useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 useEffect(()=>{scrollRef.current?.scrollTo({top:0,behavior:'instant'});headingRef.current?.focus({preventScroll:true});},[step]);
 const checkEligibility=async()=>{const sequence=++eligibilitySequence.current;setFree(null);setEligibilityError('');try{const result=await operation<Record<Mode,boolean>&{access?:MarketAccess}>('/market/eligibility',{}, {background:true,force:true,feedback:false});if(typeof result[mode]!=='boolean')throw new Error('Free eligibility could not be confirmed.');if(isCurrent()&&sequence===eligibilitySequence.current){setFree(result[mode]===true);setPlan(result.access||null);}}catch(e){if(isCurrent()&&sequence===eligibilitySequence.current)setEligibilityError((e as Error).message);}};
 useEffect(()=>{void checkEligibility();const update=()=>void checkEligibility();window.addEventListener('repaido:market-access-updated',update);return()=>window.removeEventListener('repaido:market-access-updated',update);},[mode,account]);
 const update=(field:keyof ListingFields,value:string)=>{if(submitting.current||pending)return;remember({...draftRef.current,fields:{...draftRef.current.fields,[field]:value},consent:false,requestId:crypto.randomUUID()});setErrors(v=>({...v,[field]:undefined}));setError('');};
 const selectPhoto=(selected:File|null)=>{
  if(submitting.current||pending)return;
  const message=selected?photoSelectionError(selected):'';
  if(message){setErrors(v=>({...v,photo:message}));return;}
  setFile(selected);remember({...draftRef.current,photoId:'',photoName:selected?.name||'',consent:false,requestId:crypto.randomUUID()},selected);setErrors(v=>({...v,photo:undefined}));setError('');
 };
 const focusError=(field:ListingField)=>{requestAnimationFrame(()=>formRef.current?.querySelector<HTMLElement>(`[data-listing-field="${field}"]`)?.focus());};
 const validate=(all=false)=>{
  const issues=listingErrors(draftRef.current,mode,!!fileRef.current),keys=all?fieldsByStep.flat():fieldsByStep[step];
  const first=keys.find(key=>issues[key]);setErrors(issues);
  if(first){const targetStep=fieldsByStep.findIndex(fields=>fields.includes(first));if(targetStep!==step)remember({...draftRef.current,step:targetStep});focusError(first);return false;}
  return true;
 };
 const goBack=()=>{if(!busy&&!pending&&step>0){setError('');setErrors({});remember({...draftRef.current,step:step-1});}};
 const close=()=>{if(!submitting.current){if(account==='guest')cancelGuestSignIn();onClose();}};
 const signIn=()=>{if(account==='guest')continueGuestDraftAfterSignIn(mode,{draft:draftRef.current,file:fileRef.current},onGuestDraftClaimed);onSignIn?.();};
 const submit=async()=>{
  if(submitting.current)return;
  if(!draftRef.current.pending&&!validate(true))return;
  const wasRetry=!!draftRef.current.pending;
  const controller=new AbortController();requestController.current=controller;
  submitting.current=true;setBusy(true);setError('');let attempted=false;
  try{
   await auth.authStateReady();if(!isCurrent())return;
   if(!auth.currentUser)throw new Error('Sign in to submit your listing. Your draft stays in this tab.');
   let command=draftRef.current.pending;
   if(!command){
    let photoId=draftRef.current.photoId;
    if(!photoId){
     if(!fileRef.current)throw new Error('Choose your product photo again before submitting.');
     setPhase('uploading');const token=await auth.currentUser.getIdToken();if(!isCurrent())return;
     const response=await apiFetch('/api/operations/market/photos',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':fileRef.current.type},body:fileRef.current},{feedback:false});
     const body=await response.json().catch(()=>({}));if(!isCurrent())return;
     if(!response.ok)throw Object.assign(new Error(body.detail?.message||(typeof body.detail==='string'?body.detail:null)||'Your photo was not saved. Please retry.'),{status:response.status});
     if(typeof body.id!=='string'||!body.id)throw new Error('Your photo upload was not confirmed. Please retry.');
     photoId=body.id;remember({...draftRef.current,photoId});
    }
    command=listingPayload(draftRef.current,mode,photoId);
    // Save the exact intent before sending it. A lost reply must replay the same
    // bytes and key, even after closing this dialog or reloading the tab.
    remember({...draftRef.current,pending:command});
   }
   setPhase('saving');attempted=true;
   const saved=await operation<Item>('/market/listings',{method:'POST',signal:controller.signal,body:JSON.stringify(command)},{feedback:false});
   if(!isCurrent())return;
   if(!saved.id||!saved.status)throw new Error('The server did not confirm your listing. Retry confirmation to check this same request.');
   clearListingDraft(account,mode);onSaved(saved);
  }catch(e){
   if(!isCurrent())return;
   const failure=e as Error&{status?:number};setPlanRequired(failure.status===402);
   // A validation/access/limit rejection confirms that this attempt was not
   // created. Conflicts can mean a prior attempt exists, so keep its intent.
   if(attempted&&canReviseListingAfterFailure(failure.status,wasRetry))remember({...draftRef.current,pending:null,requestId:crypto.randomUUID()});
   setError(failure.message||'Unable to confirm the listing. Check your connection and retry.');
  }finally{if(mounted.current){setBusy(false);setPhase('idle');}submitting.current=false;}
 };
 const fieldProps=(name:keyof ListingFields)=>({id:`${prefix}-${name}`,name,'data-listing-field':name,value:draft.fields[name],onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>update(name,e.target.value),disabled:busy||pending,'aria-invalid':!!errors[name],'aria-describedby':errors[name]?`${prefix}-${name}-error`:undefined});
 const fieldError=(name:ListingField)=>errors[name]?<span id={`${prefix}-${name}-error`} className="listing-field-error">{errors[name]}</span>:null;
 const input=(name:keyof ListingFields,label:string,props:InputHTMLAttributes<HTMLInputElement>={})=><label className="listing-field" htmlFor={`${prefix}-${name}`}><span>{label}</span><input {...props} {...fieldProps(name)} aria-label={label}/>{fieldError(name)}</label>;
 const textarea=(name:'condition'|'warranty'|'reason',label:string,placeholder:string,maxLength:number)=><label className="listing-field" htmlFor={`${prefix}-${name}`}><span>{label}</span><textarea {...fieldProps(name)} aria-label={label} required placeholder={placeholder} maxLength={maxLength} rows={name==='condition'?3:2}/>{fieldError(name)}</label>;
 const category=(name:'type'|'desired_type',label:string)=><label className="listing-field" htmlFor={`${prefix}-${name}`}><span>{label}</span><select {...fieldProps(name)} aria-label={label}>{listingTypes.map(type=><option key={type} value={type}>{listingTypeLabels[type]}</option>)}</select>{fieldError(name)}</label>;
 const eligibility=plan?.status==='paid'?'Included in your active marketplace plan.':free===true?'One 90-day free period for swaps, used items and messaging.':free===false?'Active marketplace access is required to publish.':eligibilityError?'Repaido will confirm your access before submission.':'Checking marketplace access…';
 const hasPhoto=!!file||!!draft.photoId;
 return <Modal title={mode==='exchange'?'List for Exchange':'Sell Your Used Item on Repaido'} className="market-form-modal listing-editor" frameless onClose={close}>
  <form ref={formRef} className="market-form listing-form" noValidate aria-busy={busy} onSubmit={e=>{e.preventDefault();if(step===3&&account==='guest'&&onSignIn&&!pending){if(validate(true))signIn();}else if(pending||step===3)void submit();else if(validate()){setErrors({});remember({...draftRef.current,step:step+1});}}}>
   <header className="listing-header"><div><span className="listing-eyebrow">REPAIDO · LOCAL MARKET</span><h2>{mode==='exchange'?'List for Exchange':'Sell Your Used Item on Repaido'}</h2></div><button type="button" className="listing-icon-button" disabled={busy} onClick={close} aria-label="Close dialog"><X size={20} aria-hidden="true"/></button></header>
   <nav className="listing-progress" aria-label="Listing progress"><ol>{listingSteps.map((label,index)=><li key={label} aria-current={step===index?'step':undefined}><button type="button" disabled={busy||pending||index>step} onClick={()=>{setErrors({});remember({...draftRef.current,step:index});}} aria-label={`Step ${index+1}: ${label}`}><span className="listing-step-number">{index<step?<Check size={14} aria-hidden="true"/>:index+1}</span><span>{label}</span></button></li>)}</ol></nav>
   <div className="listing-scroll" ref={scrollRef}>
    <div className="listing-section-heading"><span>STEP {step+1} OF 4</span><h3 ref={headingRef} tabIndex={-1}>{['Start with your item','Tell buyers what to expect','Show it. Place it.','Ready for its next owner?'][step]}</h3><p>{['The essentials help nearby buyers find your listing.','Clear, honest details make a better handover.','Use your own photo and confirm where the item is.','Check your listing and consent before submitting.'][step]}</p></div>
    {initial.restored&&step===0&&<p className="listing-draft-note">Your unfinished draft is back. {storageAvailable?'Details stay in this browser tab.':'Keep this tab open to retain it.'}</p>}
    {hasIncomingGuestDraft(account,mode)&&<p className="listing-draft-note">Your earlier account draft is open. The item you started before signing in is also kept; finish or discard this draft to resume it next.</p>}
    {step===0&&<><div className="listing-eligibility"><ReceiptLong size={20} aria-hidden="true"/><p>{eligibility}<span>Then ₹99 / calendar month. No automatic debit.</span></p></div>
     {input('name','Product name',{required:true,minLength:3,maxLength:120,placeholder:'e.g. Samsung Galaxy M34'})}
     <div className="listing-grid">{input('brand','Brand / OEM',{required:true,minLength:2,maxLength:80,placeholder:'e.g. Samsung'})}{category('type','Product category')}</div>
     <div className="listing-grid">{input('value',mode==='exchange'?'Estimated value (₹)':'Selling price (₹)',{type:'number',inputMode:'numeric',min:100,max:1000000,step:1,required:true,placeholder:'e.g. 8,000'})}{input('purchase','Original purchase price (₹)',{type:'number',inputMode:'numeric',min:1,max:1000000,step:1,required:true,placeholder:'Price you paid'})}</div>
     {mode==='exchange'&&<div className="listing-exchange"><h4>What would you like in return?</h4>{category('desired_type','Wanted product type')}{input('desired_product','Wanted brand / requirements',{required:true,minLength:3,maxLength:200,placeholder:'e.g. A working 10-inch tablet'})}</div>}
    </>}
    {step===1&&<><div className="listing-grid">{input('age','Age (months)',{type:'number',inputMode:'numeric',min:0,max:600,step:1,required:true,placeholder:'e.g. 18'})}{input('year','Manufacture year',{type:'number',inputMode:'numeric',min:1970,max:new Date().getFullYear(),step:1,required:true,placeholder:'e.g. 2025'})}</div>
     {textarea('condition','Condition & included accessories','What works well? Mention defects, repairs and what is included.',1500)}
     {textarea('warranty','Warranty status','Remaining warranty and terms, or “No warranty”.',500)}
     {textarea('reason',mode==='exchange'?'Reason for exchanging':'Reason for selling','e.g. Upgrading to a newer model.',500)}
    </>}
    {step===2&&<><section className="listing-photo" aria-labelledby={`${prefix}-photo-label`}><div className="listing-label-row"><h4 id={`${prefix}-photo-label`}>Product photo</h4><span>JPG / PNG · up to 5 MB</span></div>
     <div className={`listing-photo-area ${hasPhoto?'has-photo':''}`}>
      {preview?<img src={preview} alt={`Selected product: ${draft.fields.name||'listing photo'}`}/>:<span className="listing-photo-icon">{draft.photoId?<CheckCircle2 size={32} aria-hidden="true"/>:<ImagePlus size={32} aria-hidden="true"/>}</span>}
      <div><strong>{file?'Photo selected':draft.photoId?'Photo uploaded':'Give buyers a clear view'}</strong><p>{file?`${file.name} · ${Math.max(1,Math.round(file.size/1024))} KB`:draft.photoId?'Your confirmed upload is ready to use.':'A clear, well-lit photo of your own item.'}</p>
       <label className="listing-upload-button" htmlFor={`${prefix}-photo`}>{hasPhoto?'Change photo':'Choose photo'}<input id={`${prefix}-photo`} data-listing-field="photo" aria-label="Product photo" type="file" accept="image/jpeg,image/png" disabled={busy||pending} aria-invalid={!!errors.photo} aria-describedby={errors.photo?`${prefix}-photo-error`:undefined} onChange={e=>{selectPhoto(e.target.files?.[0]||null);e.target.value='';}}/></label>
      </div>
      {hasPhoto&&<button className="listing-photo-remove listing-icon-button" type="button" aria-label="Remove product photo" disabled={busy||pending} onClick={()=>selectPhoto(null)}><X size={20} aria-hidden="true"/></button>}
     </div>{fieldError('photo')}
     {!file&&draft.photoName&&!draft.photoId&&<p className="listing-reselect" role="status">Photos cannot be restored after a page reload. Choose “{draft.photoName}” again.</p>}
     <p className="listing-help">Your photo uploads when you submit the listing.</p>
    </section>
     {input('city','City / location',{required:true,minLength:2,maxLength:80,autoComplete:'address-level2',placeholder:'City where your item is located'})}
     <div className="listing-location"><MapPin size={20} aria-hidden="true"/><div><strong>{draft.pin?'Item location confirmed':'Confirm your item’s location'}</strong><p>{draft.pin?`${draft.pin.lat.toFixed(4)}, ${draft.pin.lng.toFixed(4)}`:'Pin the place where buyers can find the item.'}</p></div><button type="button" data-listing-field="pin" disabled={busy||pending} aria-invalid={!!errors.pin} aria-describedby={errors.pin?`${prefix}-pin-error`:undefined} onClick={()=>setMap(true)}>{draft.pin?'Change pin':'Choose pin'}</button></div>{fieldError('pin')}
     {mode==='exchange'&&<label className="listing-field" htmlFor={`${prefix}-radius`}><span>Exchange radius</span><select {...fieldProps('radius')} aria-label="Exchange radius">{[1,3,5,10,20,50,100].map(radius=><option key={radius} value={radius}>{radius} km</option>)}</select><small>Both listings must be within each other’s radius to match.</small>{fieldError('radius')}</label>}
    </>}
    {step===3&&<><article className="listing-preview" aria-label="Listing preview"><div className="listing-preview-image">{preview?<img src={preview} alt={draft.fields.name}/>:<ImageIcon size={32} aria-hidden="true"/>}</div><div><span>{listingTypeLabels[draft.fields.type]}</span><h4>{draft.fields.name}</h4><p>{draft.fields.brand} · {draft.fields.age} months old</p><strong>{money(Number(draft.fields.value)*100)}</strong><p><MapPin size={14} aria-hidden="true"/>{draft.fields.city}</p></div></article>
     <dl className="listing-review"><div><dt>Condition</dt><dd>{draft.fields.condition}</dd></div><div><dt>Warranty</dt><dd>{draft.fields.warranty}</dd></div><div><dt>{mode==='exchange'?'Reason for exchanging':'Reason for selling'}</dt><dd>{draft.fields.reason}</dd></div><div><dt>Original price / year</dt><dd>{money(Number(draft.fields.purchase)*100)} · {draft.fields.year}</dd></div>{mode==='exchange'&&<div><dt>Wanted in exchange</dt><dd>{draft.fields.desired_product} · {draft.fields.radius} km radius</dd></div>}</dl>
     <div className="listing-fee-note"><ReceiptLong size={20} aria-hidden="true"/><div><strong>{plan?.status==='paid'?'Included in your plan':free===true?'Included in your free period':'Review marketplace access'}</strong><p>{plan?.status==='paid'?'Your shared plan includes this listing and marketplace messaging.':free===true?'Your one-time 90-day trial is shared across exchange, used items and messaging. Earlier marketplace activity keeps its original start date.':'After the trial, ₹99 gives one calendar month of shared marketplace access. Review the plan to publish.'} No automatic charge.</p>{onAccess&&<button type="button" disabled={busy} onClick={onAccess}>View marketplace plan</button>}{eligibilityError&&<button type="button" disabled={busy} onClick={()=>void checkEligibility()}>Recheck eligibility</button>}</div></div>
     <label className="listing-consent" htmlFor={`${prefix}-consent`}><span className="listing-checkbox-target"><input id={`${prefix}-consent`} data-listing-field="consent" type="checkbox" required disabled={busy||pending} checked={draft.consent} aria-invalid={!!errors.consent} aria-describedby={errors.consent?`${prefix}-consent-error`:undefined} onChange={e=>{remember({...draftRef.current,consent:e.target.checked});setErrors(v=>({...v,consent:undefined}));}}/></span><span>I confirm these details are accurate, agree to Marketplace guidelines, and consent to sharing my seller contact with eligible signed-in buyers.</span></label>{fieldError('consent')}
    </>}
    {pending&&!busy&&<div className="listing-pending" role="status"><strong>Check this listing’s confirmation</strong><p>Retry the same request to confirm the result. Your submitted details are kept unchanged to prevent a duplicate listing.</p>{onCheckListings&&<button type="button" onClick={onCheckListings}>Check My listings</button>}</div>}
    {error&&<div role="alert" className="listing-error"><p>{error}</p>{planRequired&&onAccess&&<button type="button" onClick={onAccess}>Review marketplace access</button>}{onSignIn&&/sign in|sign-in/i.test(error)&&<button type="button" disabled={busy} onClick={signIn}>Sign in</button>}</div>}
    {busy&&<p role="status" className="listing-progress-note">{phase==='uploading'?'Uploading your photo. Keep this window open.':'Waiting for Repaido to confirm your listing. Keep this window open.'}</p>}
    {!storageAvailable&&<p className="listing-draft-note">Browser storage is unavailable. Your draft stays available while this page is open.</p>}
    {!pending&&!busy&&<div className="listing-draft-actions">{discard?<><span>Discard this unfinished draft?</span><button type="button" onClick={()=>{clearListingDraft(account,mode);onClose();}}>Discard draft</button><button type="button" onClick={()=>setDiscard(false)}>Keep editing</button></>:<button type="button" onClick={()=>setDiscard(true)}>Discard draft</button>}</div>}
   </div>
   <footer className="listing-footer"><div className="listing-footer-note">{busy?'Please wait for confirmation.':pending?'Retrying checks the same listing.':step===3?'No automatic charge.':`Next: ${listingSteps[step+1]}`}</div><div className="listing-footer-actions">{step>0&&!pending&&<button type="button" disabled={busy} onClick={goBack} aria-label="Back to previous step"><ArrowLeft size={20} aria-hidden="true"/><span>Back</span></button>}<button className="listing-primary" type="submit" disabled={busy}>{busy?phase==='uploading'?'Uploading photo…':'Saving listing…':pending?'Retry confirmation':step<3?<>Continue<ArrowRight size={20} aria-hidden="true"/></>:account==='guest'&&onSignIn?'Sign in to submit':free===true||plan?.active?'Publish listing':'Submit listing'}</button></div></footer>
  </form>
  {map&&<LocationPickerModal isOpen areaOnly title="Choose item location" subtitle="Pin the location of the item so nearby buyers can find it." helpText="Move the pin or enter coordinates, then confirm that this is the item’s location." pinConfirmationLabel="I have checked that this pin marks my item’s location." locationLabel="item location" confirmLabel="Use this item location" initialLat={draft.pin?.lat} initialLng={draft.pin?.lng} onClose={()=>setMap(false)} onConfirmLocation={location=>{const pin=strictListingPin(location);if(pin){remember({...draftRef.current,pin,consent:false,requestId:crypto.randomUUID()});setErrors(v=>({...v,pin:undefined}));}setMap(false);}}/>}
 </Modal>;
}
