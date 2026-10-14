import {useId} from 'react';
import './market-art.css';

/** Decorative local vectors; a service illustration never implies live activity. */
export function MarketArt({kind}:{kind:'market'|'wholesale'|'contracts'|'scrap'}){
 const id=useId(),green=kind==='scrap',ink=green?'#0b4634':'#17285c',accent=green?'#8bd9b2':kind==='wholesale'?'#a9c5ff':kind==='contracts'?'#eacb88':'#a7ccf3';
 return <svg className="market-art" data-kind={kind} viewBox="0 0 128 96" aria-hidden="true" focusable="false">
  <defs><linearGradient id={id+'-surface'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor={accent}/></linearGradient></defs>
  <ellipse cx="65" cy="81" rx="43" ry="8" fill={ink} opacity=".1"/>
  <path className="market-art-orbit" d="M16 64c-8-26 14-46 44-47s57 19 49 43" fill="none" stroke={accent} strokeWidth="2" strokeDasharray="3 5"/>
  <g className="market-art-object" stroke={ink} strokeWidth="2" strokeLinejoin="round">
   {kind==='market'?<>
    <path d="m32 44 34-13 31 12v35L62 89 32 76Z" fill={'url(#'+id+'-surface)'}/><path d="m32 44 30 13 35-14M62 57v32" fill="none"/>
    <path d="M45 40V29c0-17 35-18 35-2v9" fill="none" strokeWidth="4" strokeLinecap="round"/><path d="m46 64 8 3m17 1 13-5" fill="none" strokeLinecap="round"/>
   </>:kind==='wholesale'?<>
    <path d="m23 55 25-10 23 10v27L46 91 23 80Z" fill={accent}/><path d="m23 55 23 10 25-10M46 65v26" fill="none"/>
    <path d="m70 48 22-9 22 9v27l-22 9-22-9Z" fill={'url(#'+id+'-surface)'}/><path d="m70 48 22 10 22-10M92 58v26" fill="none"/>
    <path d="m44 23 27-11 25 11v27L69 61 44 50Z" fill={'url(#'+id+'-surface)'}/><path d="m44 23 25 11 27-11M69 34v27m-12-37 25 11" fill="none"/>
   </>:kind==='contracts'?<>
    <path d="m40 13 47 4 15 15-6 54-63-7Z" fill={'url(#'+id+'-surface)'}/><path d="m87 17-1 16 16-1" fill={accent}/><path d="m49 36 25 2m-26 12 34 3m-35 10 25 3" fill="none" strokeLinecap="round"/>
    <path d="m83 61 11 3 5 15-15 14-14-16 3-13Z" fill={ink}/><path d="m77 75 5 6 10-12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
   </>:<>
    <path d="M40 31h52l-5 54H45Z" fill={'url(#'+id+'-surface)'}/><path d="M36 31h60m-43-1 3-11h20l4 11" fill="none" strokeLinecap="round"/>
    <path d="m62 42 8 1 7 12m-7-12 1 8m6 4 2 6-14 9m14-9-8 1m-6 8-8-3-1-15m1 15 6-5" fill="none" strokeWidth="3" strokeLinecap="round"/>
   </>}
  </g>
  <g className="market-art-accent" fill={accent}><circle cx="19" cy="24" r="5"/><path d="m104 15 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/></g>
 </svg>;
}
