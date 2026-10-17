import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {AlertTriangle,ClipboardList,Download,FileSpreadsheet,PackageCheck,RefreshCw,Upload} from '../icons';
import {auth} from '../firebase';
import {operation,money} from '../services/operations';
import './shop-tools.css';

type PreviewRow={line:number;product_id:string;name:string;action?:string;old_on_hand?:number;on_hand?:number;available?:number;reserved?:number;old_price_paise?:number|null;price_paise?:number;errors:{code:string;field?:string;message:string}[]};
type Preview={shop_id:string;shop_version:number;rows:PreviewRow[];error_rows:number;can_commit:boolean;preview_digest:string|null;max_rows:number};
type StockAlert={id:string;name:string;sku:string;stock:number;reserved:number;low_stock:number;stock_confirmed_at:number;reasons:string[]};
type StockPage={items:StockAlert[];scanned:number;next_cursor:string|null;as_of:number;note:string};
type Entry={id:string;source_kind:string;source_id:string|null;amount_paise:number;status:string;transfer_status:string;provider_id:string|null;payment_reference:string|null;invoice_id:string|null;invoice_status:string|null;weekly_due_at:number|null;flags:string[]};
type Statement={shop_id:string;shop_name:string;entries:Entry[];next_cursor:string|null;as_of:number;bank:{status:string;last4:string|null};page_totals:{recorded_paise:number;confirmed_paid_paise:number;review_count:number};csv_text:string;note:string};
type Report={sample_size:number;accepted_count:number;measured_acceptances:number;median_accept_seconds:number|null;pending_count:number;expired_pending_count:number;cancelled_count:number;next_cursor:string|null;note:string};
type Document={title:string;shop_name:string;entry:Entry;items:{name:string;quantity:number;unit_price_paise?:number;total_paise?:number;gst_bps?:number|null}[];currency:string;note:string};
type Dashboard={uid:string;stock:StockPage;statement:Statement;report:Report};
const options={background:true,feedback:false,force:true};
const label=(value:string)=>value.replaceAll('_',' ');
const date=(value:number|null|undefined)=>value?new Date(value*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
function download(name:string,text:string,type='text/csv;charset=utf-8'){
 const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function ShopTools(){
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[loaded,setLoaded]=useState<Dashboard|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [csv,setCsv]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[document,setDocument]=useState<Document|null>(null),[exportCursor,setExportCursor]=useState<string|null>(null);
 const alive=useRef(true),epoch=useRef(0),lock=useRef(false),requestId=useRef('');
 const data=loaded?.uid===uid?loaded:null;
 const current=(actor:string,version:number)=>alive.current&&auth.currentUser?.uid===actor&&epoch.current===version;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;};},[]);
 useEffect(()=>onIdTokenChanged(auth,user=>setUid(user?.uid||'')),[]);
 const refresh=async(actor:string,version:number)=>{
  const [stock,statement,report]=await Promise.all([operation<StockPage>('/shop/tools/stock-alerts',{},options),operation<Statement>('/shop/tools/statement',{},options),operation<Report>('/shop/tools/response-report',{},options)]);
  if(current(actor,version))setLoaded({uid:actor,stock,statement,report});
 };
 useEffect(()=>{
  const actor=uid,version=++epoch.current;lock.current=false;requestId.current='';setLoaded(null);setDocument(null);setCsv('');setPreview(null);setExportCursor(null);setError('');setNotice('');setBusy(false);setLoading(true);
  if(!actor){setLoading(false);return;}
  void refresh(actor,version).catch(e=>{if(current(actor,version))setError((e as Error).message);}).finally(()=>{if(current(actor,version))setLoading(false);});
 },[uid]);
 const run=async(action:(actor:string,version:number)=>Promise<void>)=>{
  const actor=auth.currentUser?.uid,version=epoch.current;if(lock.current||!actor)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{await action(actor,version);}catch(e){if(current(actor,version))setError((e as Error).message);}finally{if(current(actor,version)){lock.current=false;setBusy(false);}}
 };
 const changeCsv=(text:string)=>{setCsv(text);setPreview(null);requestId.current='';setNotice('');};
 const upload=(file:File|undefined)=>void run(async(actor,version)=>{
  if(!file)return;if(file.size>120000)throw Error('Choose a UTF-8 CSV smaller than 120 KB.');
  const text=await file.text();if(current(actor,version))changeCsv(text);
 });
 const prepare=()=>void run(async(actor,version)=>{
  const result=await operation<Preview>('/shop/tools/inventory/preview',{method:'POST',body:JSON.stringify({csv_text:csv})},options);
  if(current(actor,version)){setPreview(result);requestId.current='';setNotice(result.can_commit?'Review every change below, then save the import.':'Fix the listed rows and preview the file again.');}
 });
 const commit=()=>void run(async(actor,version)=>{
  if(!preview?.can_commit||!preview.preview_digest)return;
  const key=requestId.current||(requestId.current=crypto.randomUUID());
  const result=await operation<{count:number;import_id:string}>('/shop/tools/inventory/commit',{method:'POST',body:JSON.stringify({csv_text:csv,expected_shop_version:preview.shop_version,preview_digest:preview.preview_digest,request_id:key})},options);
  if(!current(actor,version))return;
  setPreview(null);setCsv('');requestId.current='';setNotice(`${result.count} products saved. Import reference: ${result.import_id.slice(0,12)}.`);await refresh(actor,version);
 });
 const exportInventory=(after='')=>void run(async(actor,version)=>{
  const result=await operation<{csv_text:string;next_cursor:string|null;count:number}>('/shop/tools/inventory/export'+(after?'?after='+encodeURIComponent(after):''),{},options);
  if(!current(actor,version))return;
  download(`repaido-inventory-${after?'next':'first'}-25.csv`,result.csv_text);setExportCursor(result.next_cursor);setNotice(`${result.count} products exported with current versions.${result.next_cursor?' More products are available in the next file.':''}`);
 });
 const readDocument=(id:string)=>void run(async(actor,version)=>{
  const result=await operation<Document>('/shop/tools/documents/'+encodeURIComponent(id),{},options);
  if(current(actor,version))setDocument(result);
 });
 return <section className="shop-tools" aria-label="Shop business tools">
  <header className="shop-tools-heading"><div><span className="shop-tools-eyebrow">YOUR BUSINESS RECORDS</span><h2>Stock & statements</h2><p>Review stock, payment records and order response times.</p></div><button type="button" disabled={busy||loading} aria-label="Refresh shop business tools" onClick={()=>void run(refresh)}><RefreshCw size={18} aria-hidden="true"/></button></header>
  {error&&<p className="shop-tools-error" role="alert">{error}</p>}{notice&&<p className="shop-tools-notice" role="status">{notice}</p>}
  {loading&&!data&&<p role="status">Loading your shop records…</p>}{!uid&&!loading&&<p>Sign in with your shop mobile number to open your business tools.</p>}
  {data&&<>
   <section className="shop-tools-card"><h3><AlertTriangle size={20} aria-hidden="true"/>Stock reminders <span>{data.stock.items.length}</span></h3><p>{data.stock.note}</p>
    {!data.stock.items.length&&<p className="shop-tools-empty">No low stock or stale confirmations among these {data.stock.scanned} products.</p>}
    <div className="shop-tools-stock-list">{data.stock.items.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.sku||item.id}</small><div className="shop-tools-flags">{item.reasons.map(reason=><span key={reason}>{label(reason)}</span>)}</div></div><div className="shop-tools-stock-numbers"><strong>{item.stock} available</strong><small>{item.reserved||0} reserved · alert at {item.low_stock??3}</small><small>Confirmed {date(item.stock_confirmed_at)}</small></div></article>)}</div>
    <p className="shop-tools-note">Checked {data.stock.scanned} products in this page. Last checked {date(data.stock.as_of)} IST.</p>
    {data.stock.next_cursor&&<button type="button" disabled={busy} onClick={()=>void run(async(actor,version)=>{const next=await operation<StockPage>('/shop/tools/stock-alerts?after='+encodeURIComponent(data.stock.next_cursor!),{},options);if(current(actor,version))setLoaded(value=>value?{...value,stock:next}:value);})}>Check next 100 products</button>}
   </section>
   <details className="shop-tools-card" open><summary><FileSpreadsheet size={20} aria-hidden="true"/><span>Import or export inventory</span></summary><p>Work with up to 25 products per file. Export stock first to retain each product’s version. Prices use integer paise: ₹50 = 5000 paise.</p>
    <div className="shop-tools-actions"><button type="button" disabled={busy} onClick={()=>void run(async(actor,version)=>{const result=await operation<{csv_text:string}>('/shop/tools/inventory/template',{},options);if(current(actor,version))download('repaido-inventory-template.csv',result.csv_text);})}><Download size={16} aria-hidden="true"/>Blank template</button><button type="button" disabled={busy} onClick={()=>exportInventory()}><Download size={16} aria-hidden="true"/>Export first 25 products</button>{exportCursor&&<button type="button" disabled={busy} onClick={()=>exportInventory(exportCursor)}>Export next file</button>}</div>
    <label className="shop-tools-upload"><Upload size={18} aria-hidden="true"/><span>Choose an inventory CSV</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={event=>upload(event.target.files?.[0])}/></label>
    <label className="shop-tools-csv">CSV contents<textarea rows={5} value={csv} maxLength={120000} disabled={busy} spellCheck={false} onChange={event=>changeCsv(event.target.value)} placeholder="product_id,expected_version,name,sku,category,compatibility,price_paise,on_hand"/></label>
    <p className="shop-tools-note">New products use version 0. Refurbished products require the full inspection details in the refurbishment JSON column. Reserved units stay reserved.</p>
    <button type="button" className="shop-tools-primary" disabled={busy||!csv.trim()} onClick={prepare}><ClipboardList size={18} aria-hidden="true"/>{busy?'Working…':'Preview changes'}</button>
    {preview&&<div className="shop-tools-preview"><h4>{preview.rows.length} rows reviewed · {preview.error_rows} with errors</h4>{preview.rows.map((row,index)=><article key={`${row.line}-${index}`} className={row.errors.length?'has-errors':''}><strong>Line {row.line}: {row.name||row.product_id||'Unnamed product'}</strong>{row.errors.length?<ul>{row.errors.map((err,idx)=><li key={idx}>{err.field?`${err.field}: `:''}{err.message}</li>)}</ul>:<><p>{row.action==='create'?'Create':'Update'} · {row.product_id}</p><p>Physical stock {row.old_on_hand} → <strong>{row.on_hand}</strong> · {row.reserved} reserved · {row.available} available</p><p>Base price {row.old_price_paise==null?'New':money(row.old_price_paise)} → <strong>{money(row.price_paise!)}</strong></p></>}</article>)}<button type="button" className="shop-tools-primary" disabled={busy||!preview.can_commit} onClick={commit}><PackageCheck size={18} aria-hidden="true"/>Save {preview.rows.length} reviewed products</button><p className="shop-tools-note">Every row is checked again before saving. A stock change or invalid row blocks the entire file. If a request is interrupted, retry this save.</p></div>}
   </details>
   <section className="shop-tools-card"><h3>Payment statement</h3><p>{data.statement.shop_name} · Bank {label(data.statement.bank.status)}{data.statement.bank.last4?` · ending ${data.statement.bank.last4}`:''}</p>
    <div className="shop-tools-metrics"><div><span>Recorded on this page</span><strong>{money(data.statement.page_totals.recorded_paise)}</strong></div><div><span>Confirmed paid on this page</span><strong>{money(data.statement.page_totals.confirmed_paid_paise)}</strong></div><div><span>Records to review</span><strong>{data.statement.page_totals.review_count}</strong></div></div>
    <p>{data.statement.note}</p>{!data.statement.entries.length&&<p className="shop-tools-empty">Your shop has no recorded allocations in this page.</p>}
    <div className="shop-tools-entries">{data.statement.entries.map(entry=><article key={entry.id}><header><strong>{money(entry.amount_paise)}</strong><span>{label(entry.source_kind)} · {label(entry.status)}</span></header><p>Transfer: {label(entry.transfer_status)}{entry.provider_id?` · ${entry.provider_id}`:''}</p>{entry.invoice_id&&<p>Job invoice {entry.invoice_id} · {label(entry.invoice_status||'unknown')}</p>}<small>Reference: {entry.id}</small>{entry.flags.length>0&&<div className="shop-tools-flags">{entry.flags.map(flag=><span key={flag}>{label(flag)}</span>)}</div>}<button type="button" disabled={busy} onClick={()=>readDocument(entry.id)}>View saved document</button></article>)}</div>
    <div className="shop-tools-actions"><button type="button" disabled={!data.statement.entries.length} onClick={()=>download('repaido-statement-page.csv',data.statement.csv_text)}><Download size={16} aria-hidden="true"/>Export this statement page</button>{data.statement.next_cursor&&<button type="button" disabled={busy} onClick={()=>void run(async(actor,version)=>{const next=await operation<Statement>('/shop/tools/statement?after='+encodeURIComponent(data.statement.next_cursor!),{},options);if(current(actor,version)){setLoaded(value=>value?{...value,statement:next}:value);setDocument(null);}})}>Next statement page</button>}</div>
    {document&&<section className="shop-tools-document" aria-label="Saved payment document"><header><h4>{document.title}</h4><button type="button" onClick={()=>setDocument(null)}>Close document</button></header><p>{document.shop_name} · {money(document.entry.amount_paise)}</p><p>Reference: {document.entry.id}</p>{document.entry.payment_reference&&<p>Payment: {document.entry.payment_reference}</p>}{document.entry.invoice_id&&<p>Linked job invoice: {document.entry.invoice_id}</p>}{document.items.map((item,index)=><p key={index}>{item.quantity} × {item.name}{item.total_paise!=null?` · ${money(item.total_paise)}`:item.unit_price_paise!=null?` · ${money(item.unit_price_paise)} each`:''}</p>)}<p>{document.note}</p><button type="button" onClick={()=>download('repaido-payment-record.json',JSON.stringify(document,null,2),'application/json')}>Download saved record</button></section>}
   </section>
   <section className="shop-tools-card"><h3>Order response report</h3><div className="shop-tools-metrics"><div><span>Orders in this page</span><strong>{data.report.sample_size}</strong></div><div><span>Median time to accept</span><strong>{data.report.median_accept_seconds==null?'Not recorded':`${Math.round(data.report.median_accept_seconds/60*10)/10} min`}</strong></div><div><span>Awaiting response</span><strong>{data.report.pending_count}</strong></div></div><p>{data.report.measured_acceptances} measured acceptances · {data.report.expired_pending_count} expired requests · {data.report.cancelled_count} cancellations.</p><p>{data.report.note}</p>{data.report.next_cursor&&<button type="button" disabled={busy} onClick={()=>void run(async(actor,version)=>{const next=await operation<Report>('/shop/tools/response-report?after='+encodeURIComponent(data.report.next_cursor!),{},options);if(current(actor,version))setLoaded(value=>value?{...value,report:next}:value);})}>Next 100 orders</button>}</section>
  </>}
 </section>;
}
