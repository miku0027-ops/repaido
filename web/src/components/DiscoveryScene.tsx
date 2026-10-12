import {useId} from 'react';

/** Original, lightweight illustrations; adjacent copy names the service. */
export function DiscoveryScene({kind}:{kind:'cab'|'shared'|'self_drive'|'rental'|'repair'}){
 const id=useId().replaceAll(':',''),repair=kind==='repair';
 const accent={cab:'#8eb7ff',shared:'#7ad6ba',self_drive:'#c4b7ff',rental:'#f5c788',repair:'#8eb7ff'}[kind];
 return <svg className={'discovery-scene discovery-scene-'+kind} viewBox="0 0 360 250" aria-hidden="true" focusable="false">
  <defs>
   <linearGradient id={id+'body'} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#b9cadc"/></linearGradient>
   <linearGradient id={id+'glass'} x1="0" y1="0" x2="1" y2="1"><stop stopColor={accent}/><stop offset="1" stopColor="#173451"/></linearGradient>
  </defs>
  <ellipse cx="194" cy="199" rx="139" ry="33" fill="#000" opacity=".13"/>
  <g className="discovery-scene-map" fill="none" stroke={accent} strokeWidth="1" opacity=".35"><path d="M34 174 137 229 331 119 229 64Z M83 146 186 201 M136 116 239 171 M189 87 290 141 M69 193 264 83 M104 212 299 102"/></g>
  <path className="discovery-scene-route" d="M33 187c48 25 46-46 91-24s63 2 89-22 57 17 105-25" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" strokeDasharray="5 9"/>
  {repair?<g className="discovery-scene-object">
   <path d="m71 127 119-47 100 35v79l-120 41-99-37Z" fill="#173451"/>
   <path d="m71 127 99 36 120-48-100-35Z" fill={accent}/><path d="m71 127 99 36v72l-99-37Z" fill="#d4e0f0"/>
   <path d="m170 163 120-48v79l-120 41Z" fill={'url(#'+id+'body)'}/>
   <path d="M119 138v-19c0-17 33-29 50-21l19 7v19" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round"/>
   <path d="m102 169 33 12v13l-33-12Z M202 174l26-9v13l-26 9Z" fill="#173451"/>
   <g transform="translate(186 13) rotate(14)"><rect width="104" height="72" rx="14" fill="#fff"/><path d="M15 43h74M22 52h60" stroke="#61768c" strokeWidth="3" strokeLinecap="round"/><circle cx="86" cy="18" r="4" fill={accent}/></g>
   <path d="M74 44c-12-13-30-13-41-1l17 5 6 13-9 12-17-5c-1 16 16 26 30 18l43 60c6 8 19-1 14-9L76 77c7-12 8-23-2-33Z" fill={accent} stroke="#fff" strokeWidth="3"/>
  </g>:<g className="discovery-scene-object">
   <path d="m65 142 38-29 111-10 71 40 25 9v33l-27 18-158 9-60-32Z" fill={'url(#'+id+'body)'}/>
   <path d="m105 113 35-53 89 7 53 74-71 15Z" fill="#e8f0f9"/>
   <path d="m115 113 33-40 59 4 19 59Z" fill={'url(#'+id+'glass)'}/><path d="m217 79 16 1 37 51-33 3Z" fill="#173451"/>
   <path d="m66 141 145 15 99-4-27 17-146 10Z" fill="#fff"/>
   <path d="m67 158 34 13v12l-34-13Z M265 171l29-10v12l-29 10Z" fill={accent}/><path d="m68 176 41 21 152-10" fill="none" stroke="#7e96ad" strokeWidth="3"/>
   <ellipse cx="123" cy="195" rx="18" ry="25" fill="#10263d" transform="rotate(-15 123 195)"/><ellipse cx="123" cy="195" rx="9" ry="14" fill="#9eafc3" transform="rotate(-15 123 195)"/>
   <ellipse cx="274" cy="180" rx="17" ry="25" fill="#10263d" transform="rotate(12 274 180)"/><ellipse cx="274" cy="180" rx="8" ry="14" fill="#9eafc3" transform="rotate(12 274 180)"/>
   {kind==='cab'&&<path d="m162 58 22-5 16 8v10l-38-4Z" fill={accent}/>}
  </g>}
  <g className="discovery-scene-float"><rect x="23" y="18" width="74" height="64" rx="18" fill="#fff"/>
   {kind==='shared'?<g fill="#103f35"><circle cx="48" cy="42" r="7"/><circle cx="72" cy="42" r="7"/><path d="M35 66c0-18 26-18 26 0M61 66c0-18 26-18 26 0"/></g>:kind==='self_drive'?<g fill="none" stroke="#302954" strokeWidth="5"><circle cx="48" cy="44" r="11"/><path d="m57 52 19 17m-7-23 9 10m-17-1 9 10"/></g>:kind==='rental'?<g fill="none" stroke="#472a13" strokeWidth="4"><rect x="39" y="36" width="42" height="31" rx="5"/><path d="M40 45h40M48 30v13m23-13v13m-22 14h12"/></g>:<g fill="none" stroke="#173451" strokeWidth="4"><path d="M60 66s14-16 14-26a14 14 0 0 0-28 0c0 10 14 26 14 26Z"/><circle cx="60" cy="40" r="4"/></g>}
  </g>
  <circle cx="310" cy="50" r="13" fill={accent} opacity=".3"/><circle cx="319" cy="75" r="5" fill={accent}/>
 </svg>;
}
