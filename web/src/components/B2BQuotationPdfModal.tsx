import {useEffect,useRef,useState} from 'react';
import {Building2,CheckCircle2,Download,FileText,Printer} from 'lucide-react';
import type {B2BQuotation} from '../types/b2b';
import {b2bMoney,b2bService} from '../services/b2bService';
import {BusinessPageHeader,InlineNotice} from './BusinessUI';
import {Modal} from './ui';
import './b2b-quotation.css';
interface Props {quotation:B2BQuotation;onClose:()=>void;onAccept?:(rfqId:string)=>void|Promise<void>;onDecline?:(rfqId:string)=>void|Promise<void>;isBuyer?:boolean;}
export function B2BQuotationPdfModal({quotation:q,onClose,onAccept,onDecline,isBuyer=true}:Props){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[agreed,setAgreed]=useState(false),[now,setNow]=useState(q.serverNow||Date.now());
 const alive=useRef(true),clock=useRef({server:q.serverNow||Date.now(),local:performance.now()});
 useEffect(()=>{alive.current=true;const timer=window.setInterval(()=>setNow(clock.current.server+performance.now()-clock.current.local),1000);return()=>{alive.current=false;clearInterval(timer);};},[]);
 useEffect(()=>{clock.current={server:q.serverNow||Date.now(),local:performance.now()};setNow(clock.current.server);setAgreed(false);setError('');},[q.quoteNumber]);
 const expired=!Number.isFinite(q.validUntilMs)||now>=q.validUntilMs;
 const canRespond=isBuyer&&q.status==='quoted'&&!expired;
 const run=async(action:string,fn:()=>Promise<unknown>|void,success?:string)=>{if(busy)return;setBusy(action);setError('');try{await fn();if(alive.current&&success)setNotice(success);}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy('');}};
 return <Modal title="Supplier quotation" className="b2b-quotation-modal" onClose={()=>{if(!busy)onClose();}}>
  <div className="b2b-quote-controls"><BusinessPageHeader eyebrow="Saved commercial record" title={q.quoteNumber} description={`Issued ${new Date(q.createdAt).toLocaleDateString('en-IN')} · ${q.status==='accepted'?'Acceptance recorded':q.status==='declined'?'Declined':expired?'Quotation expired':`Valid until ${q.validUntil}`}`} icon={<FileText size={15}/>}/><div className="b2b-quote-actions"><button className="b2b-button b2b-secondary" type="button" onClick={()=>window.print()}><Printer size={16}/>Print quotation</button><button className="b2b-button b2b-primary" type="button" disabled={!!busy} onClick={()=>void run('download',()=>b2bService.downloadQuotation(q.quoteNumber),'Saved PDF downloaded.')}><Download size={16}/>{busy==='download'?'Downloading…':'Download saved PDF'}</button></div></div>
  {error&&<InlineNotice tone="error">{error}</InlineNotice>}{notice&&<InlineNotice tone="success">{notice}</InlineNotice>}
  <article className="repaido-quotation-sheet" aria-label="Saved quotation details">
   <header className="repaido-quote-header"><div><span className="b2b-overline">Repaido wholesale</span><h2>Commercial quotation</h2><p>{q.quoteNumber}</p></div><div><p>Issued {new Date(q.createdAt).toLocaleDateString('en-IN')}</p><p>Valid until {q.validUntil}</p></div></header>
   <div className="repaido-quote-parties-grid"><section><h3><Building2 size={16}/>Supplier</h3><strong>{q.distributorName||q.shopName}</strong><p>{q.shopAddress||'Address not provided'}</p><p>GSTIN: {q.distributorGstin||'Not provided'}</p>{q.shopPhone&&<p>{q.shopPhone}</p>}{q.shopEmail&&<p>{q.shopEmail}</p>}</section><section><h3>Buyer & delivery</h3><strong>{q.buyerCompanyName||q.customerName}</strong>{q.buyerCompanyName&&<p>{q.customerName}</p>}<p>GSTIN: {q.buyerGstin||'Not provided'}</p><p>{q.deliveryAddress}<br/>{q.deliveryCity} – {q.deliveryPincode}</p></section></div>
   <section className="repaido-quote-product"><h3>{q.itemTitle}</h3><p>{q.quantity} {q.unit.toLowerCase()} · {b2bMoney(q.offeredRate)} per {q.unit.toLowerCase()}</p><p className="b2b-fine">Part number: {q.partNumber||'Not provided'} · HSN: {q.hsnCode||'Not provided'}</p></section>
   <dl className="repaido-quote-totals"><div><dt>Goods subtotal</dt><dd>{b2bMoney(q.taxableAmount)}</dd></div><div><dt>GST ({Number((q.gstRate*100).toFixed(2))}%)</dt><dd>{b2bMoney(q.gstAmount)}</dd></div><div><dt>Freight</dt><dd>{b2bMoney(q.freightCharges)}</dd></div><div><dt>Quoted total</dt><dd>{b2bMoney(q.grandTotal)}</dd></div></dl>
   <section className="repaido-quote-terms"><h3>Supplier’s commercial terms</h3>{[['Payment',q.paymentTerms],['Delivery',q.deliveryTimeline],['Warranty & returns',q.warrantyTerms],...(q.specialNotes?[['Additional notes',q.specialNotes]]:[])].map(([label,value])=><div key={label}><h4>{label}</h4><p>{value||'Not provided'}</p></div>)}</section>
   <footer className="repaido-quote-signature"><span>Issued by {q.authorizedSignatory||'Signatory not provided'}{q.signatoryDesignation&&` · ${q.signatoryDesignation}`}</span><p>This is a supplier quotation, not a tax invoice, payment receipt or Repaido product certification.</p></footer>
  </article>
  <div className="b2b-quote-decision"><InlineNotice>Acceptance records your agreement to this quotation. Repaido has not collected payment, reserved stock or confirmed dispatch. Online B2B checkout and escrow are unavailable.</InlineNotice>{canRespond&&onAccept&&<><label className="b2b-consent"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>I have reviewed this supplier’s total, delivery, payment and warranty terms.</label><div className="b2b-quote-actions"><button className="b2b-button b2b-primary" disabled={!!busy||!agreed} onClick={()=>void run('accept',()=>onAccept(q.rfqId),'Quotation acceptance saved. No payment was collected.')}><CheckCircle2 size={16}/>{busy==='accept'?'Saving acceptance…':'Accept quotation'}</button>{onDecline&&<button className="b2b-button b2b-secondary" disabled={!!busy} onClick={()=>void run('decline',()=>onDecline(q.rfqId),'Quotation declined. Your decision was saved.')}>{busy==='decline'?'Saving decision…':'Decline quotation'}</button>}</div></>}{isBuyer&&expired&&q.status==='quoted'&&<p className="b2b-fine">This quotation has expired. Contact the supplier for current terms before proceeding.</p>}</div>
 </Modal>;
}
export default B2BQuotationPdfModal;
