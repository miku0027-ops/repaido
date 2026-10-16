import {useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {useOperationResource} from '../hooks/useOperationResource';
import {business,businessAmount} from '../services/localBusiness';
import {money} from '../services/operations';
import {ContractError,useCustomContractAction} from './customContractUI';

type Policy={version:number;monthly_budget_paise:number;funding_reference:string;reserved_paise:number;remaining_paise:number;budget_month:string;standing_appliance_offer:boolean;offers:Record<string,{enabled:boolean;gold_cap_paise:number;max_cap_paise:number}>;rules:Record<string,{title:string;bps:number;scope:string;checkout_ready?:boolean}>};
const rupees=(value:number)=>(value/100).toFixed(2);
const draftOf=(data:Policy)=>({expected_version:data.version,budget:rupees(data.monthly_budget_paise),funding:data.funding_reference,offers:Object.fromEntries(Object.entries(data.offers).map(([code,item])=>[code,{enabled:item.enabled,gold:rupees(item.gold_cap_paise),maximum:rupees(item.max_cap_paise)}]))});
export function CaptainRewardSettings(){
 const [open,setOpen]=useState(false);
 return <details className="captain-policy" onToggle={event=>setOpen(event.currentTarget.open)}><summary><ShieldCheck size={17} aria-hidden="true"/>Captain levels, coupon limits & funding</summary>{open&&<PolicyEditor/>}</details>;
}
function PolicyEditor(){
 const resource=useOperationResource<Policy>('/local-business/captain/admin/policy',300000);
 return <><ContractError error={resource.error} onRetry={()=>void resource.refresh()}/>{resource.data?<PolicyForm initial={resource.data} onRefresh={()=>resource.refresh()}/>:!resource.error&&<p role="status">Loading reward settings…</p>}</>;
}
function PolicyForm({initial,onRefresh}:{initial:Policy;onRefresh:()=>Promise<unknown>}){
 const [draft,setDraft]=useState(()=>draftOf(initial)),[approved,setApproved]=useState(false),[notice,setNotice]=useState(''),action=useCustomContractAction();
 const edited=()=>{setApproved(false);setNotice('');};
 const update=(code:string,field:'gold'|'maximum'|'enabled',value:string|boolean)=>{edited();setDraft(previous=>({...previous,offers:{...previous.offers,[code]:{...previous.offers[code],[field]:value}}}));};
 const preview=(gold:string,maximum:string,multiplier:number)=>{try{return money(Math.min(Math.floor(businessAmount(gold)*multiplier/10000),businessAmount(maximum)));}catch{return '—';}};
 return <form className="captain-policy-form compact-wizard" onSubmit={event=>{event.preventDefault();void action.run(async()=>{
  if(!approved)throw Error('Confirm approval of the budget and offer limits.');
  const body={expected_version:draft.expected_version,monthly_budget_paise:businessAmount(draft.budget),funding_reference:draft.funding.trim(),offers:Object.fromEntries(Object.entries(draft.offers).map(([code,item])=>[code,{enabled:item.enabled,gold_cap_paise:businessAmount(item.gold),max_cap_paise:businessAmount(item.maximum)}]))};
  const saved=await business<Policy>('/captain/admin/policy',body,'POST',{feedback:false});setDraft(draftOf(saved));setApproved(false);setNotice('Reward policy saved. Only enabled offers can be redeemed, within the approved budget.');await onRefresh();
 });}}>
  <p>Points set the level. This policy sets the maximum Repaido-funded saving. Percentages stay fixed; Platinum and Diamond can increase the Gold rupee cap within the approved offer maximum.</p>
  {initial.standing_appliance_offer&&<p className="captain-note">These proposed limits are not active. The existing appliance offer continues until an approved policy replaces it.</p>}
  <dl className="captain-budget-summary"><div><dt>Budget month · India time</dt><dd>{initial.budget_month}</dd></div><div><dt>Already reserved</dt><dd>{money(initial.reserved_paise)}</dd></div><div><dt>Available funding</dt><dd>{money(initial.remaining_paise)}</dd></div></dl>
  <label>Approved monthly reward budget · ₹<input type="number" min="0" max="10000000" step="0.01" required value={draft.budget} onChange={event=>{edited();setDraft({...draft,budget:event.target.value});}}/></label>
  <label>Repaido funding approval reference<input maxLength={200} value={draft.funding} onChange={event=>{edited();setDraft({...draft,funding:event.target.value});}}/></label>
  <div className="captain-policy-offers">{Object.entries(initial.rules).map(([code,rule])=>{const item=draft.offers[code];return <fieldset key={code}><legend>{rule.title} · {rule.bps/100}%</legend><label className="business-consent"><input type="checkbox" disabled={rule.checkout_ready===false} checked={item.enabled} onChange={event=>update(code,'enabled',event.target.checked)}/>{rule.checkout_ready===false?'Checkout not active yet':'Enable this funded offer'}</label><div className="business-two-fields"><label>Gold maximum · ₹<input type="number" min="0" max={rule.scope==='refurbished'?1000:10000} step="0.01" required value={item.gold} onChange={event=>update(code,'gold',event.target.value)}/></label><label>Approved offer maximum · ₹<input type="number" min="0" max={rule.scope==='refurbished'?1000:10000} step="0.01" required value={item.maximum} onChange={event=>update(code,'maximum',event.target.value)}/></label></div><dl className="captain-cap-preview"><div><dt>Gold · 100 points</dt><dd>{preview(item.gold,item.maximum,10000)}</dd></div><div><dt>Platinum · 200 points</dt><dd>{preview(item.gold,item.maximum,12500)}</dd></div><div><dt>Diamond · 400 points</dt><dd>{preview(item.gold,item.maximum,15000)}</dd></div></dl></fieldset>;})}</div>
  <label className="business-consent"><input type="checkbox" required checked={approved} onChange={event=>setApproved(event.target.checked)}/>I approve this Repaido budget and the listed offer limits.</label>
  <p className="captain-note">One reservation per offer per account every 30 days. Reservations count against the monthly budget. Tax, travel, parts, deposits and extras are excluded. Refurbished appliance savings never exceed ₹1,000.</p>
  <ContractError error={action.error}/>{notice&&<p role="status">{notice}</p>}<button className="cleanup-primary" disabled={action.busy}>{action.busy?'Saving reward policy…':'Save approved reward policy'}</button><button type="button" disabled={action.busy} onClick={()=>void action.run(async()=>{const saved=await business<Policy>('/captain/admin/policy',undefined,'GET',{feedback:false,force:true});setDraft(draftOf(saved));setApproved(false);setNotice('Saved reward settings loaded.');await onRefresh();})}>Reload saved reward settings</button>
 </form>;
}
