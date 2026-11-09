import {useEffect,useState} from 'react';
import {ArrowUpRight} from '../icons';
import type {CategoryId} from '../types';
import type {Promotion} from './Promotions';
import {money} from '../services/operations';
import {bestCategoryOffer,offerExpiry} from '../services/promotionPresentation.mjs';

export const homeServicesData: {id:string;categoryId:CategoryId;name:string;image:string;detail:string}[] = [
  {id:'cleaning',categoryId:'cleaning',name:'Home cleaning',image:'/images/icon-cleaning.png',detail:'Rooms and kitchens'},
  {id:'plumber',categoryId:'plumber',name:'Plumbing',image:'/images/icon-plumbing.png',detail:'Leaks and taps'},
  {id:'electrician',categoryId:'electrician',name:'Electrical repairs',image:'/images/icon-electrician.png',detail:'Wiring and switches'},
  {id:'ac',categoryId:'ac',name:'Appliance repairs',image:'/images/icon-appliance.png',detail:'AC and home appliances'},
  {id:'car',categoryId:'car',name:'Vehicle help',image:'/images/icon-vehicle.png',detail:'Repairs and towing'},
  {id:'gardening',categoryId:'cleaning',name:'Gardening',image:'/images/icon-gardening.png',detail:'Lawns and plants'}
];

export function HomeServicesGrid({city,offers=[],onOffer,activeCategory,onSelectCategory}:{city?:string;offers?:Promotion[];onOffer?:(card:Promotion)=>void;activeCategory:CategoryId;onSelectCategory:(category:CategoryId)=>void}) {
  const [now,setNow]=useState(()=>Date.now()/1000);
  // Refresh expiry labels without rotating or rearranging the user's choices.
  useEffect(()=>{
    const expiry=Math.min(...offers.map(offer=>offer.ends_at).filter(at=>at>Date.now()/1000));
    if(!Number.isFinite(expiry))return;
    const timer=setTimeout(()=>setNow(Date.now()/1000),Math.min(2147483647,Math.max(1,expiry*1000-Date.now())));
    return()=>clearTimeout(timer);
  },[offers,now]);
  return <section className="service-categories" aria-label="Service categories">
    <h2>{city?`Services in ${city}`:'Services near you'}</h2>
    <div className="service-category-grid">{homeServicesData.map(service=>{
      const matching=offers.filter(card=>service.id==='gardening'?/\b(garden|gardening|lawn|pruning)\b/i.test(card.service?.name||''):service.id!=='cleaning'||!/\b(garden|gardening|lawn|pruning)\b/i.test(card.service?.name||''));
      const offer=bestCategoryOffer(matching,service.categoryId,Math.max(now,Date.now()/1000)) as Promotion|undefined;
      return <button type="button" className="service-category-card" key={service.id} aria-pressed={activeCategory===service.categoryId} onClick={()=>{
        if(offer&&onOffer&&offer.ends_at>Date.now()/1000)onOffer(offer);else onSelectCategory(service.categoryId);
      }}>
        <img src={service.image} width={40} height={40} alt=""/>
        <strong>{service.name}</strong><span>{service.detail}</span>
        {offer&&onOffer&&<span className="service-category-offer">{offer.service?.name}: <s>{money(offer.price_paise)}</s> <b>{money(offer.offer_price_paise)}</b><small>Until {offerExpiry(offer.ends_at)}</small></span>}
        <ArrowUpRight size={16} aria-hidden="true"/>
      </button>;
    })}</div>
  </section>;
}
export default HomeServicesGrid;
