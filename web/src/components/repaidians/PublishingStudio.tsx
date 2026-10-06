import {useEffect,useRef,useState} from 'react';
import {BriefcaseBusiness,Building2,Camera,Clapperboard,ImagePlus,Layers,Link2,Package,Plus,Upload,X} from 'lucide-react';
import {Modal} from '../ui';
import type {CommunityMedia,CommunityOpportunity,OpportunityFilters,OpportunityReference,OpportunitySource,PublicationDraft,StudioKind,Trade,Visibility} from '../../types/repaidians';
import {opportunities,opportunityDetails,publish,storeMedia,trades} from '../../services/repaidiansService';
import {apiAssetUrl} from '../../services/api';
import {OpportunityCard} from './OpportunityCard';

export interface PublishingStudioProps {
  account:string;initialKind:StudioKind;defaultTrade:Trade;city:string;onClose:()=>void;onPublished:(kind:StudioKind)=>void;
  initialReference?:OpportunityReference;onDestination?:(card:CommunityOpportunity)=>void;onManage?:(source:OpportunitySource)=>void;
}
const listingKinds=[{id:'all',name:'All listings'},{id:'tenders',name:'Tenders'},{id:'jobs',name:'Jobs'},{id:'products',name:'Products'}] as const;

export function PublishingStudio({account,initialKind,defaultTrade,city,onClose,onPublished,initialReference,onDestination,onManage}:PublishingStudioProps){
  const [kind,setKind]=useState<StudioKind>(initialKind),[trade,setTrade]=useState(defaultTrade),[visibility,setVisibility]=useState<Visibility>('public'),[caption,setCaption]=useState(''),[files,setFiles]=useState<File[]>([]),[previews,setPreviews]=useState<string[]>([]);
  const [title,setTitle]=useState(''),[location,setLocation]=useState(city),[budget,setBudget]=useState(''),[slots,setSlots]=useState('1'),[deadline,setDeadline]=useState(''),[contact,setContact]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [reference,setReference]=useState<OpportunityReference|null>(initialKind==='post'?initialReference||null:null),[selected,setSelected]=useState<CommunityOpportunity|null>(null),[referenceBusy,setReferenceBusy]=useState(false),[referenceError,setReferenceError]=useState('');
  const [pickerOpen,setPickerOpen]=useState(!!initialReference),[listingKind,setListingKind]=useState<OpportunityFilters['kind']>('all'),[listings,setListings]=useState<CommunityOpportunity[]>([]),[listingCursor,setListingCursor]=useState<string|null>(null),[listingBusy,setListingBusy]=useState(false),[listingMoreBusy,setListingMoreBusy]=useState(false),[listingError,setListingError]=useState(''),[retry,setRetry]=useState(0);
  const uploaded=useRef<CommunityMedia[]|null>(null),listingGeneration=useRef(0);
  useEffect(()=>{const urls=files.map(file=>URL.createObjectURL(file));setPreviews(urls);return()=>urls.forEach(URL.revokeObjectURL);},[files]);
  useEffect(()=>{
    if(!reference){setSelected(null);setReferenceError('');setReferenceBusy(false);return;}
    let active=true;setReferenceBusy(true);setReferenceError('');
    void opportunityDetails(reference).then(card=>{if(!active)return;if(!card.shareable)throw new Error('This listing cannot be shared from this account.');setSelected(card);}).catch(error=>{if(active){setSelected(null);setReferenceError((error as Error).message);}}).finally(()=>{if(active)setReferenceBusy(false);});
    return()=>{active=false;};
  },[reference?.source,reference?.id]);
  useEffect(()=>{
    if(kind!=='post'||!pickerOpen)return;
    const controller=new AbortController();listingGeneration.current++;setListingBusy(true);setListingError('');setListings([]);setListingCursor(null);
    void opportunities({mode:'shareable',kind:listingKind,limit:12},controller.signal).then(data=>{if(controller.signal.aborted)return;setListings(data.items);setListingCursor(data.nextCursor);}).catch(error=>{if(!controller.signal.aborted)setListingError((error as Error).message);}).finally(()=>{if(!controller.signal.aborted)setListingBusy(false);});
    return()=>controller.abort();
  },[kind,pickerOpen,listingKind,retry]);
  const moreListings=async()=>{
    if(!listingCursor||listingMoreBusy)return;const current=listingGeneration.current;setListingMoreBusy(true);setListingError('');
    try{const data=await opportunities({mode:'shareable',kind:listingKind,cursor:listingCursor,limit:12});if(current!==listingGeneration.current)return;setListings(old=>[...new Map([...old,...data.items].map(card=>[card.source+':'+card.id,card])).values()]);setListingCursor(data.nextCursor);}catch(error){if(current===listingGeneration.current)setListingError((error as Error).message);}finally{setListingMoreBusy(false);}
  };
  const changeKind=(value:StudioKind)=>{setKind(value);setFiles([]);uploaded.current=null;setError('');if(value!=='post'){setReference(null);setPickerOpen(false);}};
  const choose=(card:CommunityOpportunity)=>{
    setReference({source:card.source,id:card.id});setSelected(card);setReferenceError('');setPickerOpen(false);
    if(trades.some(trade=>trade.id===card.trade))setTrade(card.trade as Trade);
  };
  return <Modal title="Publishing studio" className="rp-dialog rp-studio" onClose={onClose}>
    <p className="rp-fine">Share your craft, a real opportunity or a purchase update. Choose who can see it before publishing.</p>
    <div className="rp-studio-kinds" role="group" aria-label="Publication type">{([{id:'post',name:'Post',icon:Layers},{id:'reel',name:'Reel',icon:Clapperboard},{id:'story',name:'Story',icon:Camera},{id:'tender',name:'Tender',icon:BriefcaseBusiness}] as const).map(item=><button key={item.id} disabled={busy} aria-pressed={kind===item.id} onClick={()=>changeKind(item.id)}><item.icon size={19}/>{item.name}</button>)}</div>
    {kind==='post'&&<section className="rp-studio-attachment" aria-label="Opportunity attachment">
      <button className="rp-studio-attachment-toggle" disabled={busy} aria-label="Attach an opportunity" aria-expanded={pickerOpen} onClick={()=>setPickerOpen(value=>!value)}><Link2 size={18}/>Attach an opportunity<span>{pickerOpen?'Hide listings':'Choose a listing'}</span></button>
      {referenceBusy&&<p role="status">Checking your listing…</p>}{referenceError&&<p className="rp-error" role="alert">{referenceError}</p>}
      {selected&&reference&&<div className="rp-studio-selected-reference"><div><strong>Attached to your post</strong><button type="button" aria-label="Remove opportunity" disabled={busy} onClick={()=>setReference(null)}><X size={18}/></button></div><OpportunityCard card={selected} compact allowSave={false} onDestination={onDestination}/></div>}
      {pickerOpen&&<div className="rp-studio-reference-picker"><p className="rp-fine">Choose one of your published listings or an eligible purchased product. Current details stay linked to its Repaido record.</p><div className="rp-studio-reference-kinds" role="group" aria-label="Attachment category">{listingKinds.map(item=><button key={item.id} aria-pressed={listingKind===item.id} onClick={()=>setListingKind(item.id)}>{item.name}</button>)}</div>
        {listingBusy&&<p role="status">Finding your shareable listings…</p>}{listingError&&<div className="rp-error" role="alert"><p>{listingError}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Retry listings</button></div>}
        <div className="rp-studio-reference-list">{listings.filter(card=>card.shareable).map(card=><button type="button" className="rp-studio-reference-option" key={card.source+':'+card.id} aria-pressed={reference?.source===card.source&&reference.id===card.id} disabled={busy} onClick={()=>choose(card)}>{card.imageUrl?<img src={apiAssetUrl(card.imageUrl)} alt="" loading="lazy"/>:card.kind==='tender'?<Building2 size={23}/>:card.kind==='job'?<BriefcaseBusiness size={23}/>:<Package size={23}/>}<span><strong>{card.title}</strong><small>{card.kind==='tender'?'Tender':card.kind==='job'?'Job':card.condition==='refurbished'?'Refurbished product':card.source==='second_hand'?'Second-hand product':'Product'}{card.city?' · '+card.city:''}</small></span><Plus size={18}/></button>)}</div>
        {listingCursor&&!listingBusy&&<button type="button" className="rp-load-more" disabled={listingMoreBusy} onClick={()=>void moreListings()}>{listingMoreBusy?'Finding more…':'More shareable listings'}</button>}
        {!listingBusy&&!listingError&&!listings.length&&<p className="rp-muted">No shareable listings yet. Publish a tender, job or product in its Repaido workspace, or share an eligible purchase after payment.</p>}
        {onManage&&<div className="rp-studio-native-actions"><button type="button" onClick={()=>onManage('contract')}><Building2 size={16}/>New tender</button><button type="button" onClick={()=>onManage('career')}><BriefcaseBusiness size={16}/>Post a job</button><button type="button" onClick={()=>onManage('inventory')}><Package size={16}/>Shop inventory</button><button type="button" onClick={()=>onManage('second_hand')}><Package size={16}/>Sell second hand</button></div>}
      </div>}
    </section>}
    <form onSubmit={async event=>{event.preventDefault();if(busy||referenceBusy||referenceError)return;setBusy(true);setError('');try{
      if(kind!=='tender'&&files.length&&!uploaded.current)uploaded.current=await storeMedia(files);
      if(kind!=='tender'&&!files.length&&!reference)throw new Error('Add a photo or video, or attach a published opportunity to your post.');
      const draft:PublicationDraft={kind,trade,visibility,caption,media:(uploaded.current||[]).map(media=>({...media,alt:caption.trim().slice(0,300)}))};
      if(kind==='post'&&reference)draft.reference={source:reference.source,id:reference.id};
      if(kind==='tender')Object.assign(draft,{title,location,budgetRupees:Number(budget),slots:Number(slots),deadline:new Date(deadline).getTime(),contact});
      await publish(account,draft);onPublished(kind);
    }catch(error){setError((error as Error).message);}finally{setBusy(false);}}}>
      {kind!=='tender'&&<><label className="rp-upload"><ImagePlus size={24}/><strong>{kind==='post'?(reference?'Add photos (optional)':'Add up to four photos'):kind==='reel'?'Add a work video':'Add a photo or video'}</strong><span>JPG, PNG, WebP, MP4 or WebM · max 8 MB each</span><input key={kind} aria-label="Upload publication media" type="file" disabled={busy} accept={kind==='post'?'image/jpeg,image/png,image/webp':kind==='reel'?'video/mp4,video/webm':'image/jpeg,image/png,image/webp,video/mp4,video/webm'} multiple={kind==='post'} onChange={event=>{setFiles(Array.from(event.target.files||[]));uploaded.current=null;setError('');}}/></label><div className="rp-upload-previews">{previews.map((url,index)=>files[index]?.type.startsWith('video')?<video key={url} src={url} controls playsInline aria-label="Video preview"/>:<img key={url} src={url} alt="Selected photo preview"/>)}</div></>}
      {kind==='tender'&&<><label>Tender title<input required maxLength={150} value={title} onChange={event=>setTitle(event.target.value)}/></label><label>Site location<input required maxLength={150} value={location} onChange={event=>setLocation(event.target.value)}/></label><div className="rp-form-grid"><label>Budget (₹)<input required type="number" min={1} max={100000000} value={budget} onChange={event=>setBudget(event.target.value)}/></label><label>Crew size<input required type="number" min={1} max={1000} value={slots} onChange={event=>setSlots(event.target.value)}/></label></div><label>Bid deadline<input required type="datetime-local" value={deadline} onChange={event=>setDeadline(event.target.value)}/></label><label>Contact details<input required maxLength={120} value={contact} onChange={event=>setContact(event.target.value)}/><small>Only eligible community members can reveal these details.</small></label></>}
      <label>{kind==='tender'?'Scope & requirements':'Caption & visual description'}<textarea rows={3} required maxLength={2000} value={caption} onChange={event=>setCaption(event.target.value)} placeholder="Describe the work, its scope and what you are sharing."/></label>
      <div className="rp-form-grid"><label>Trade<select value={trade} onChange={event=>setTrade(event.target.value as Trade)}>{trades.map(trade=><option value={trade.id} key={trade.id}>{trade.name}</option>)}</select></label><label>Visibility<select value={visibility} onChange={event=>setVisibility(event.target.value as Visibility)}><option value="public">Public</option><option value="trade">Trade category only</option></select></label></div>
      {kind==='story'&&<p className="rp-fine">Your story expires 24 hours after publication.</p>}
      {reference&&<p className="rp-fine">Your post links to the original listing. Customers can review its latest details before applying, bidding or purchasing.</p>}
      {error&&<p className="rp-error" role="alert">{error}</p>}
      <button className="rp-primary" disabled={busy||referenceBusy||!!referenceError} aria-busy={busy}><Upload size={17}/>{busy?'Publishing…':'Share with Repaidians'}</button>
    </form>
  </Modal>;
}
