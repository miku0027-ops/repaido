import {useEffect,useRef,useState} from 'react';
import './customer-experience.css';

export default function BrandTabTransition({tab,reduced}:{tab:string;reduced:boolean}){
  const previous=useRef(tab),deck=useRef<number[]>([]),last=useRef(-1),sequence=useRef(0);
  const [transition,setTransition]=useState<{effect:number;key:number}|null>(null);
  useEffect(()=>{
    if(previous.current===tab)return;
    previous.current=tab;
    if(reduced||matchMedia('(prefers-reduced-motion: reduce)').matches){setTransition(null);return;}
    if(!deck.current.length){
      deck.current=Array.from({length:20},(_,i)=>i);
      for(let i=19;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck.current[i],deck.current[j]]=[deck.current[j],deck.current[i]];}
      if(deck.current.at(-1)===last.current)[deck.current[0],deck.current[19]]=[deck.current[19],deck.current[0]];
    }
    const effect=deck.current.pop()!;last.current=effect;
    setTransition({effect,key:++sequence.current});
    const timer=setTimeout(()=>setTransition(null),700);
    return()=>clearTimeout(timer);
  },[tab,reduced]);
  useEffect(()=>{if(reduced)setTransition(null);},[reduced]);
  return transition?<div key={transition.key} className="brand-tab-transition" data-effect={transition.effect} aria-hidden="true"><img src="/brand/repaido-logo-transparent.png" alt=""/></div>:null;
}
