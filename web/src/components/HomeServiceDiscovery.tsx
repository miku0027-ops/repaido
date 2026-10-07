import {useCallback,useState} from 'react';
import type {CategoryId} from '../types';
import {HomeServicesGrid} from './HomeServicesGrid';
import {PromotionRail,type Promotion} from './Promotions';

export function HomeServiceDiscovery({city,activeCategory,onSelectCategory,onOpen,onSignIn}:{city:string;activeCategory:CategoryId;onSelectCategory:(id:CategoryId)=>void;onOpen:(card:Promotion)=>void;onSignIn:()=>void}){
  const [offers,setOffers]=useState<Promotion[]>([]);
  const receive=useCallback((cards:Promotion[])=>setOffers(cards),[]);
  return <><HomeServicesGrid city={city} offers={offers} onOffer={onOpen} activeCategory={activeCategory} onSelectCategory={onSelectCategory}/><div className="home-promotion-slot"><PromotionRail city={city} onOpen={onOpen} onSignIn={onSignIn} onCards={receive} onExplore={()=>onSelectCategory('all')}/></div></>;
}
