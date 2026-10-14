import {useEffect,useRef,useState,type ReactNode} from 'react';
import {homeDiscoveryPlan} from '../services/homeDiscoveryPlan.mjs';
import {RETURN_VISIT_MS} from '../services/customerVisits.mjs';
import {HomeDiscoveryHub,type DiscoveryFocus} from './HomeDiscoveryHub';
import {HomeServiceDiscovery} from './HomeServiceDiscovery';
import type {MarketplaceMode} from './MarketplaceDiscovery';
import './home-elastic-discovery.css';

type Plan={focus:DiscoveryFocus;marketMode:MarketplaceMode;servicesFirst:boolean;slot:string;basis:string};
export function HomeDiscoveryLayout({discovery,services,marketPersonalised=false,repairVisits=0,children,now}:{
 discovery:Parameters<typeof HomeDiscoveryHub>[0];services:Parameters<typeof HomeServiceDiscovery>[0];
 marketPersonalised?:boolean;repairVisits?:number;children?:ReactNode;now?:Date;
}){
 const {accountKey,location,personalised,preferredFocus,marketMode,transportInterest,repairInterest}=discovery;
 const compute=()=>homeDiscoveryPlan({now,city:location.city,personalised,marketPersonalised,preferredFocus,preferredMarketMode:marketMode,transportInterest,repairInterest,repairVisits}) as Plan;
 const [plan,setPlan]=useState(compute),held=useRef(false),hiddenAt=useRef(0);
 const latest=useRef(compute);latest.current=compute;
 // Preferences may arrive after the public view. Once touched, keep the DOM order and drafts stable.
 useEffect(()=>{if(!held.current)setPlan(latest.current());},[accountKey,location.city,personalised,marketPersonalised,preferredFocus,marketMode,transportInterest,repairInterest,repairVisits,now]);
 useEffect(()=>{
  const refreshTime=()=>{
   if(held.current||document.hidden||document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]'))return;
   const next=latest.current();setPlan(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  };
  const visibility=()=>{if(document.hidden)hiddenAt.current=Date.now();else if(hiddenAt.current){const elapsed=Date.now()-hiddenAt.current;hiddenAt.current=0;if(elapsed>=RETURN_VISIT_MS)refreshTime();}};
  // A cheap local clock check changes the plan only at a slot or peak boundary.
  const timer=setInterval(refreshTime,60000);
  document.addEventListener('visibilitychange',visibility);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 const hub=<HomeDiscoveryHub key="discovery" {...discovery} suggestedFocus={plan.focus} marketMode={plan.marketMode}/>;
 const grid=<div key="services" className="home-elastic-services"><HomeServiceDiscovery {...services} showPromotion={false}/></div>;
 const middle=<div key="between" className="home-elastic-between">{children}</div>;
 return <div className="home-elastic-discovery" data-leading={plan.servicesFirst?'services':'discovery'} data-basis={plan.basis} data-slot={plan.slot} onPointerDownCapture={()=>{held.current=true;}} onFocusCapture={()=>{held.current=true;}}>
  {plan.servicesFirst?[grid,middle,hub]:[hub,middle,grid]}
 </div>;
}
