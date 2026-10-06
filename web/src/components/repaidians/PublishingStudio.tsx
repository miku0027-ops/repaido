import {useEffect,useRef,useState} from 'react';
import {Camera,Clapperboard,ImagePlus,Layers,Upload,BriefcaseBusiness} from 'lucide-react';
import {Modal} from '../ui';
import type {CommunityMedia,PublicationDraft,StudioKind,Trade,Visibility} from '../../types/repaidians';
import {publish,storeMedia,trades} from '../../services/repaidiansService';
export function PublishingStudio({account,initialKind,defaultTrade,city,onClose,onPublished}:{account:string;initialKind:StudioKind;defaultTrade:Trade;city:string;onClose:()=>void;onPublished:(kind:StudioKind)=>void}) {
  const [kind,setKind]=useState<StudioKind>(initialKind),[trade,setTrade]=useState(defaultTrade),[visibility,setVisibility]=useState<Visibility>('public'),[caption,setCaption]=useState(''),[files,setFiles]=useState<File[]>([]),[previews,setPreviews]=useState<string[]>([]);
  const [title,setTitle]=useState(''),[location,setLocation]=useState(city),[budget,setBudget]=useState(''),[slots,setSlots]=useState('1'),[deadline,setDeadline]=useState(''),[contact,setContact]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const uploaded=useRef<CommunityMedia[]|null>(null);
  useEffect(()=>{const urls=files.map(f=>URL.createObjectURL(f));setPreviews(urls);return()=>urls.forEach(URL.revokeObjectURL);},[files]);
  const changeKind=(value:StudioKind)=>{setKind(value);setFiles([]);uploaded.current=null;setError('');};
  return <Modal title="Publishing studio" className="rp-dialog rp-studio" onClose={onClose}>
    <p className="rp-fine">Share your craft with the community. Choose who can see it before publishing.</p>
    <div className="rp-studio-kinds" role="group" aria-label="Publication type">{([{id:'post',name:'Post',icon:Layers},{id:'reel',name:'Reel',icon:Clapperboard},{id:'story',name:'Story',icon:Camera},{id:'tender',name:'Tender',icon:BriefcaseBusiness}] as const).map(t=><button key={t.id} aria-pressed={kind===t.id} onClick={()=>changeKind(t.id)}><t.icon size={19}/>{t.name}</button>)}</div>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{
      if(kind!=='tender'&&!uploaded.current)uploaded.current=await storeMedia(files);
      const draft:PublicationDraft={kind,trade,visibility,caption,media:(uploaded.current||[]).map(media=>({...media,alt:caption.trim().slice(0,300)}))};
      if(kind==='tender')Object.assign(draft,{title,location,budgetRupees:Number(budget),slots:Number(slots),deadline:new Date(deadline).getTime(),contact});
      await publish(account,draft);onPublished(kind);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      {kind!=='tender'&&<><label className="rp-upload"><ImagePlus size={24}/><strong>{kind==='post'?'Add up to four photos':kind==='reel'?'Add a work video':'Add a photo or video'}</strong><span>JPG, PNG, WebP, MP4 or WebM · max 8 MB each</span><input key={kind} aria-label="Upload publication media" type="file" accept={kind==='post'?'image/jpeg,image/png,image/webp':kind==='reel'?'video/mp4,video/webm':'image/jpeg,image/png,image/webp,video/mp4,video/webm'} multiple={kind==='post'} onChange={e=>{setFiles(Array.from(e.target.files||[]));uploaded.current=null;setError('');}}/></label><div className="rp-upload-previews">{previews.map((url,i)=>files[i]?.type.startsWith('video')?<video key={url} src={url} controls playsInline aria-label="Video preview"/>:<img key={url} src={url} alt="Selected photo preview"/>)}</div></>}
      {kind==='tender'&&<><label>Tender title<input required maxLength={150} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Site location<input required maxLength={150} value={location} onChange={e=>setLocation(e.target.value)}/></label><div className="rp-form-grid"><label>Budget (₹)<input required type="number" min={1} max={100000000} value={budget} onChange={e=>setBudget(e.target.value)}/></label><label>Crew size<input required type="number" min={1} max={1000} value={slots} onChange={e=>setSlots(e.target.value)}/></label></div><label>Bid deadline<input required type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label><label>Contact details<input required maxLength={120} value={contact} onChange={e=>setContact(e.target.value)}/><small>Only eligible Pro members can reveal these details.</small></label></>}
      <label>{kind==='tender'?'Scope & requirements':'Caption & visual description'}<textarea rows={3} required maxLength={2000} value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Describe the work, its scope and what the media shows."/></label>
      <div className="rp-form-grid"><label>Trade<select value={trade} onChange={e=>setTrade(e.target.value as Trade)}>{trades.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></label><label>Visibility<select value={visibility} onChange={e=>setVisibility(e.target.value as Visibility)}><option value="public">Public</option><option value="trade">Trade category only</option></select></label></div>
      {kind==='story'&&<p className="rp-fine">Your story expires 24 hours after publication.</p>}
      {error&&<p className="rp-error" role="alert">{error}</p>}
      <button className="rp-primary" disabled={busy} aria-busy={busy}><Upload size={17}/>{busy?'Publishing…':'Share with Repaidians'}</button>
    </form>
  </Modal>;
}
