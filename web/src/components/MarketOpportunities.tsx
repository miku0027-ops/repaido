import {useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {Modal} from './ui';
import RepaidoBrand from './RepaidoBrand';
import OpportunityCarousel,{type Opportunity} from './OpportunityCarousel';
type Destination='spares'|'rentals'|'exchange'|'preowned'|'sell'|'contracts'|'refurbished';
export default function MarketOpportunities({onChoose}:{onChoose:(id:Destination)=>void}){const [detail,setDetail]=useState<Opportunity|null>(null);return <><OpportunityCarousel onOpen={setDetail}/>{detail&&<Modal title={detail.title} onClose={()=>setDetail(null)}><RepaidoBrand size="sm"/><img src={`/images/banners/${detail.image}.jpg`} alt={detail.alt} style={{width:'100%',aspectRatio:'3/2',objectFit:'cover',borderRadius:14}}/><p>{detail.body}</p><details open><summary>How it works & terms</summary><p>{detail.terms}</p></details><button className="ops-primary" onClick={()=>{onChoose(detail.id as Destination);setDetail(null);}}>{detail.cta}<ArrowRight size={16}/></button></Modal>}</>;}
