import {useState} from 'react';
import type {Service} from '../types';
import {formatMoney} from '../data';
import ServiceFinder from './ServiceFinder';
import {Modal} from './ui';
import {ArrowRight} from 'lucide-react';
export default function HomeServiceFinder({services,onPreview}:{services:Service[];onPreview:(service:Service)=>void}){
 const [sort,setSort]=useState('recommended'),[budget,setBudget]=useState(''),[filters,setFilters]=useState(false);
 const visible=services.filter(s=>!budget||s.price<=Number(budget)).slice().sort((a,b)=>sort==='price-low'?a.price-b.price:sort==='duration'?a.duration-b.duration:0);
 return <div className="home-finder-slot"><ServiceFinder services={visible} sort={sort} onSort={setSort} onFilters={()=>setFilters(true)} onPreview={onPreview} filtered={!!budget||sort!=='recommended'} onReset={()=>{setBudget('');setSort('recommended');}}/>{(budget||sort!=='recommended')&&<div className="finder-shortlist">{visible.slice(0,3).map(s=><button key={s.id} onClick={()=>onPreview(s)}><span>{s.name}</span><strong>{formatMoney(s.price)}</strong><ArrowRight size={14}/></button>)}{!visible.length&&<p>No services within this budget. Try a higher amount.</p>}</div>}{filters&&<Modal title="Your service preferences" onClose={()=>setFilters(false)}><label className="finder-budget">Maximum service price · ₹<input type="number" min="0" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="Any budget"/></label><button className="navy-button" onClick={()=>setFilters(false)}>Show {visible.length} services</button></Modal>}</div>;
}
