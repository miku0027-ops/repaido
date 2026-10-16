import {useEffect,useRef,useState} from 'react';
import {auth} from '../firebase';
import {operation,money} from '../services/operations';
import {announceMarketChatChange,type MarketChat,type MarketMessage} from '../services/marketMessaging';
import './market-transaction.css';

type Review={rating:number;text:string;created_at:number};
type Transaction={version:number;state:'proposed'|'agreed'|'completion_pending'|'completed'|'cancelled';meeting:{place:string;starts_at:number;note:string};offer:NonNullable<MarketMessage['offer']>;offer_message_id:string;my_agreement:boolean;other_agreement:boolean;my_completion:boolean;other_completion:boolean;my_review:Review|null;other_review:Review|null;cancel_note?:string;confirmation_basis:string};
const labels={proposed:'Meeting proposed',agreed:'Meeting agreed',completion_pending:'Waiting for both confirmations',completed:'Handover completed',cancelled:'Meeting cancelled'};

export default function MarketTransactionPanel({chat,messages,uid}:{chat:MarketChat;messages:MarketMessage[];uid:string}){
 const [open,setOpen]=useState(false),[row,setRow]=useState<Transaction|null>(null),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editing,setEditing]=useState(false),[offerId,setOfferId]=useState(''),[place,setPlace]=useState(''),[date,setDate]=useState(''),[note,setNote]=useState(''),[cancelReason,setCancelReason]=useState(''),[rating,setRating]=useState('5'),[review,setReview]=useState(''),[confirmed,setConfirmed]=useState(false);
 const generation=useRef(0),alive=useRef(true),pending=useRef<{path:string;body:Record<string,unknown>}|null>(null);
 const base=`/market/chats/${encodeURIComponent(chat.id)}/transaction`;
 const current=()=>alive.current&&auth.currentUser?.uid===uid;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 const load=async(signal?:AbortSignal,clearError=true)=>{const epoch=++generation.current;setLoading(true);try{const data=await operation<{transaction:Transaction|null}>(base,{signal},{background:true,feedback:false});if(current()&&!signal?.aborted&&epoch===generation.current){setRow(data.transaction);setLoaded(true);if(clearError)setError('');}}catch(problem){if(current()&&!signal?.aborted&&epoch===generation.current)setError((problem as Error).message);}finally{if(current()&&!signal?.aborted&&epoch===generation.current)setLoading(false);}};
 useEffect(()=>{if(!open)return;const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[open,chat.latest_seq]);
 const run=async(path:string,body:Record<string,unknown>)=>{if(busy)return;setBusy(true);setError('');setNotice('');generation.current++;const payload=pending.current||{path,body:{...body,request_id:crypto.randomUUID()}};pending.current=payload;try{const value=await operation<{transaction:Transaction}>(base+payload.path,{method:'POST',body:JSON.stringify(payload.body)},{background:true,feedback:false});if(current()){setRow(value.transaction);setLoaded(true);pending.current=null;setEditing(false);setConfirmed(false);setNotice('Handover details saved.');announceMarketChatChange(chat.id);}}catch(problem){if(current()){const failure=problem as Error&{status?:number};setError(failure.message);if(failure.status&&failure.status<500){pending.current=null;if(failure.status===409)void load(undefined,false);}}}finally{if(current())setBusy(false);}};
 const offers=messages.filter(message=>message.offer?.status==='accepted').map(message=>({id:message.id,offer:message.offer!}));
 if(row&&!offers.some(offer=>offer.id===row.offer_message_id))offers.push({id:row.offer_message_id,offer:row.offer});
 const selected=offerId||offers.at(-1)?.id||'';
 const action=(value:'agree'|'confirm_completion'|'cancel')=>row&&void run('/actions',{expected_version:row.version,action:value,note:value==='cancel'?cancelReason:''});
 const blocked=chat.blocked_by_me||chat.blocked_by_other;
 return <details className="market-transaction" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Handover details{row&&<span>{labels[row.state]}</span>}</summary>
  {open&&<div className="market-transaction-body">
   {loading&&!loaded&&<p role="status">Loading handover details…</p>}
   {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>pending.current?void run(pending.current.path,pending.current.body):void load()}>Retry</button></p>}
   {notice&&<p role="status">{notice}</p>}
   {row&&<><p><strong>{row.offer.exchange_listing?'Swap for '+row.offer.exchange_listing.name:money(row.offer.amount_paise||0)}</strong></p><p>{row.meeting.place} · <time dateTime={new Date(row.meeting.starts_at*1000).toISOString()}>{new Date(row.meeting.starts_at*1000).toLocaleString()}</time></p>{row.meeting.note&&<p>{row.meeting.note}</p>}<p>{row.state==='cancelled'?row.cancel_note:row.confirmation_basis}</p></>}
   {loaded&&!row&&!offers.length&&<p>Agree to a price or swap proposal in chat, then arrange a public meeting here.</p>}
   {loaded&&(!row||editing||row.state==='cancelled')&&offers.length>0&&chat.can_send&&<form onSubmit={event=>{event.preventDefault();const startsAt=new Date(date).getTime()/1000;if(!Number.isFinite(startsAt)){setError('Choose a meeting date and time.');return;}void run('/meeting',{expected_version:row?.version||0,offer_message_id:selected,place,starts_at:startsAt,note});}}>
    <label>Accepted proposal<select value={selected} disabled={busy||!!pending.current} onChange={event=>setOfferId(event.target.value)}>{offers.map(item=><option value={item.id} key={item.id}>{item.offer.exchange_listing?'Swap: '+item.offer.exchange_listing.name:money(item.offer.amount_paise||0)}</option>)}</select></label>
    <label>Public meeting place<input required minLength={5} maxLength={300} value={place} disabled={busy||!!pending.current} onChange={event=>setPlace(event.target.value)} placeholder="A well-lit public place"/></label>
    <label>Meeting date and time<input required type="datetime-local" value={date} disabled={busy||!!pending.current} onChange={event=>setDate(event.target.value)}/></label>
    <label>Inspection and handover notes<textarea maxLength={800} value={note} disabled={busy||!!pending.current} onChange={event=>setNote(event.target.value)} placeholder="Accessories, condition checks and agreed details"/></label>
    <button type="submit" disabled={busy||!!pending.current}>{busy?'Saving…':'Propose meeting'}</button>{editing&&<button type="button" onClick={()=>setEditing(false)}>Keep current meeting</button>}
   </form>}
   {row&&!editing&&row.state==='proposed'&&<><p>{row.my_agreement?'Waiting for the other participant to agree.':'Review the meeting details before agreeing.'}</p>{!row.my_agreement&&!blocked&&<button type="button" disabled={busy||!!pending.current} onClick={()=>action('agree')}>Agree to this meeting</button>}</>}
   {row&&!editing&&['proposed','agreed'].includes(row.state)&&<><div>{chat.can_send&&<button type="button" disabled={busy||!!pending.current} onClick={()=>{setEditing(true);setPlace(row.meeting.place);setNote(row.meeting.note);}}>Change meeting</button>}</div><details><summary>Cancel meeting</summary><label>Reason<input minLength={5} maxLength={800} value={cancelReason} onChange={event=>setCancelReason(event.target.value)}/></label><button type="button" disabled={busy||!!pending.current||cancelReason.trim().length<5} onClick={()=>action('cancel')}>Cancel meeting</button></details></>}
   {row&&['agreed','completion_pending'].includes(row.state)&&<>{row.my_completion?<p>You confirmed handover. Waiting for the other participant.</p>:<><label className="market-transaction-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I inspected and exchanged the item and confirmed any agreed payment with the other participant.</label><button type="button" disabled={busy||!!pending.current||!confirmed} onClick={()=>action('confirm_completion')}>Confirm actual handover</button></>}<p>Both confirmations close the listing. Use Report conversation if a handover is disputed.</p></>}
   {row?.state==='completed'&&<><p>Both participants confirmed this transaction. Reviews are visible to the two participants.</p>{row.my_review?<p><strong>Your review · {row.my_review.rating}/5</strong><br/>{row.my_review.text}</p>:<form onSubmit={event=>{event.preventDefault();void run('/review',{rating:Number(rating),text:review});}}><label>Your rating<select value={rating} disabled={busy||!!pending.current} onChange={event=>setRating(event.target.value)}>{[5,4,3,2,1].map(value=><option key={value} value={value}>{value} out of 5</option>)}</select></label><label>Transaction review<textarea required minLength={5} maxLength={1000} value={review} disabled={busy||!!pending.current} onChange={event=>setReview(event.target.value)}/></label><button type="submit" disabled={busy||!!pending.current}>Save review</button></form>}{row.other_review&&<p><strong>Other participant · {row.other_review.rating}/5</strong><br/>{row.other_review.text}</p>}</>}
  </div>}
 </details>;
}
