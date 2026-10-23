import type {ReactNode} from 'react';
import {Building2,CalendarDays,ChevronDown,FileText,MapPin,ShieldCheck,Users} from '../icons';
import './tender-information.css';

type TenderInformationData={
 budget_paise?:number;manpower_needed?:number;owner_name?:string;city?:string;sector?:string;
 site?:string;scope?:string;terms?:string;opens_at?:number;deadline?:number;starts_at?:number;ends_at?:number;
};
const day=(at:number)=>new Date(at*1000).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
const validDate=(at:number|undefined):at is number=>typeof at==='number'&&Number.isFinite(at)&&Number.isFinite(new Date(at*1000).getTime());

function TenderDisclosure({icon,title,hint,children}:{icon:ReactNode;title:string;hint:string;children:ReactNode}){
 return <details className="tender-information-section">
  <summary><span className="tender-information-icon" aria-hidden="true">{icon}</span><span className="tender-information-label"><strong>{title}</strong><small>{hint}</small></span><ChevronDown className="tender-information-chevron" size={20} aria-hidden="true"/></summary>
  <div className="tender-information-content">{children}</div>
 </details>;
}

export function TenderInformation({tender,privateDetails=false}:{tender:TenderInformationData;privateDetails?:boolean}){
 const budget=typeof tender.budget_paise==='number'&&Number.isFinite(tender.budget_paise)?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2,minimumFractionDigits:0}).format(tender.budget_paise/100):'Not provided';
 const workDates=validDate(tender.starts_at)&&validDate(tender.ends_at)?`${day(tender.starts_at)} – ${day(tender.ends_at)}`:'View bidding and work dates';
 const site=privateDetails&&tender.site?tender.site:tender.city;
 const dates:[string,number|undefined][]=[['Bidding opens',tender.opens_at],['Bidding closes',tender.deadline],['Work starts',tender.starts_at],['Work ends',tender.ends_at]];
 return <section className="tender-information" aria-label="Tender information">
  <div className="tender-information-overview">
   <dl className="tender-information-metrics">
    <div><dt>Published budget</dt><dd>{budget}<small>Owner’s estimate</small></dd></div>
    <div><dt><Users size={15} aria-hidden="true"/>Required team</dt><dd>{tender.manpower_needed??'—'} <span>{tender.manpower_needed===1?'agent':'agents'}</span></dd></div>
   </dl>
   {(tender.owner_name||site||tender.sector)&&<dl className="tender-information-facts">
    {tender.owner_name&&<div><dt><Building2 size={16} aria-hidden="true"/>Owner</dt><dd>{tender.owner_name}</dd></div>}
    {site&&<div><dt><MapPin size={16} aria-hidden="true"/>{privateDetails&&tender.site?'Site':'Location'}</dt><dd>{site}</dd></div>}
    {tender.sector&&<div><dt>Sector</dt><dd>{tender.sector}</dd></div>}
   </dl>}
  </div>
  <div className="tender-information-sections">
   {privateDetails&&<>
    <TenderDisclosure icon={<FileText size={19}/>} title="Scope of work" hint="Project requirements & deliverables"><p>{tender.scope||'No scope has been provided.'}</p></TenderDisclosure>
    <TenderDisclosure icon={<ShieldCheck size={19}/>} title="Eligibility & terms" hint="Owner’s bidding conditions"><p>{tender.terms||'No additional terms have been provided.'}</p></TenderDisclosure>
   </>}
   <TenderDisclosure icon={<CalendarDays size={19}/>} title="Dates & timeline" hint={workDates}>
    <dl className="tender-information-dates">{dates.map(([label,at])=><div key={label}><dt>{label}</dt><dd>{validDate(at)?<time dateTime={new Date(at*1000).toISOString()}><strong>{day(at)}</strong><span>{new Date(at*1000).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata',timeZoneName:'short'})}</span></time>:'Not provided'}</dd></div>)}</dl>
   </TenderDisclosure>
  </div>
 </section>;
}
