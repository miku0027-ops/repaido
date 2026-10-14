import {useCallback,useState} from 'react';
import type {CategoryId} from '../types';
import {HomeServicesGrid} from './HomeServicesGrid';
import {PromotionRail,type Promotion,type CampaignFeed} from './Promotions';

export function HomeServiceDiscovery({city,activeCategory,onSelectCategory,onOpen,onSignIn,campaignFeed,showPromotion=true}:{showPromotion?:boolean;campaignFeed?:CampaignFeed;city:string;activeCategory:CategoryId;onSelectCategory:(id:CategoryId)=>void;onOpen:(card:Promotion)=>void;onSignIn:()=>void}){
  const [offers,setOffers]=useState<Promotion[]>([]);
  const receive=useCallback((cards:Promotion[])=>setOffers(cards),[]);
  return <><HomeServicesGrid city={city} offers={campaignFeed?.cards||offers} onOffer={onOpen} activeCategory={activeCategory} onSelectCategory={onSelectCategory}/>{showPromotion&&<div className="home-promotion-slot"><PromotionRail campaignFeed={campaignFeed} city={city} onOpen={onOpen} onSignIn={onSignIn} onCards={receive} onExplore={()=>onSelectCategory('all')}/></div>}</>;
}
