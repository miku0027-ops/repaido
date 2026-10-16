import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {operation,money} from '../services/operations';
type Report={campaign:{title:string;budget_paise:number;reserved_paise:number;impressions:number;opens:number};totals:Record<string,number>;items:{id:string;state:string;payment_status:string;confirmed_refund_paise:number;complaints:number;discount_paise:number}[];next_cursor:string|null;related_records_truncated:boolean;scope:string;financial_note:string};
export function CampaignOutcomes({campaignId}:{campaignId:string}){
 const [data,setData]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(0),locked=useRef(false),account=useRef(auth.currentUser?.uid||'');
 useEffect(()=>{const stop=onIdTokenChanged(auth,user=>{const next=user?.uid||'';if(next!==account.current){account.current=next;request.current++;locked.current=false;setData(null);setError('');setBusy(false);}});return()=>{request.current++;stop();};},[]);
 useEffect(()=>{request.current++;locked.current=false;setData(null);setError('');setBusy(false);},[campaignId]);
 const load=async(cursor='')=>{
  if(locked.current)return;locked.current=true;const id=++request.current,actor=account.current;setBusy(true);setError('');
  const current=()=>id===request.current&&actor===(auth.currentUser?.uid||'');
  try{const report=await operation<Report>(`/admin/campaigns/${encodeURIComponent(campaignId)}/outcomes?cursor=${encodeURIComponent(cursor)}`);if(current())setData(report);}
  catch(e){if(current())setError((e as Error).message);}finally{if(current()){locked.current=false;setBusy(false);}}
 };
 return <section className="ops-card"><div className="ops-heading"><h3>Confirmed campaign outcomes</h3><button disabled={busy} onClick={()=>void load()}>{busy?'Checking…':'Load outcomes'}</button></div>{error&&<p role="alert">{error}</p>}{data&&<><p>{data.scope}</p><dl className="shop-tools-metrics">{[['bookings','Bookings'],['completed','Completed'],['verified_payments','Verified final payments'],['confirmed_refunds','Processed service refunds'],['complaint_cases','Complaint cases'],['open_complaints','Open complaints'],['repeat_customers_in_page','Repeat customers in this page']].map(([k,label])=><div key={k}><dt>{label}</dt><dd>{data.totals[k]}</dd></div>)}</dl><p>Campaign budget {money(data.campaign.budget_paise)} · reserved {money(data.campaign.reserved_paise)}</p><p>Page final-balance captured {money(data.totals.captured_paise)} · service refunds {money(data.totals.processed_refund_paise)} · settled company allocation {money(data.totals.settled_company_allocation_paise)}</p><p>{data.financial_note}</p>{data.related_records_truncated&&<p role="status">Some bookings exceed this report’s refund/support sample. Open their financial records for a complete reconciliation.</p>}<details><summary>Booking references</summary>{data.items.map(x=><p key={x.id}>{x.id} · {x.state} · payment {x.payment_status} · {x.complaints} complaints</p>)}</details>{data.next_cursor&&<button disabled={busy} onClick={()=>void load(data.next_cursor!)}>Next 25 reservations</button>}</>}</section>;
}
