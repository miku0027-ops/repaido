import {useId} from 'react';

/** Original procurement illustrations; product placeholders never imply a seller photo. */
export function WholesaleArt({kind='sourcing'}:{kind?:'sourcing'|'requests'}){
 const id=useId().replaceAll(':','');
 return <svg viewBox="0 0 240 180" fill="none" aria-hidden="true" className="wholesale-art">
  <defs><linearGradient id={id} x1="48" y1="25" x2="182" y2="160" gradientUnits="userSpaceOnUse"><stop stopColor="#edf3ff"/><stop offset="1" stopColor="#d4e2fb"/></linearGradient></defs>
  <ellipse cx="121" cy="158" rx="92" ry="10" fill="#17285c" opacity=".07"/>
  <circle cx="120" cy="88" r="73" fill={`url(#${id})`}/>
  <path d="M26 128h188M37 139h165" stroke="#b7c9e7" strokeWidth="2" strokeLinecap="round"/>
  {kind==='sourcing'?<>
   <path d="m45 67 72-33 71 33v80H45V67Z" fill="#fff" stroke="#9db3d5" strokeWidth="2"/>
   <path d="m39 69 78-37 77 37" stroke="#17285c" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
   <path d="M61 82h113v8H61z" fill="#e4ebf6"/><path d="M64 103h47v44H64z" fill="#17285c"/>
   <path d="M71 111h33m-33 8h33m-33 8h33m-33 8h33" stroke="#526ca1" strokeWidth="2"/>
   <path d="m133 107 22-12 23 12-23 13-22-13Z" fill="#ffdf98" stroke="#9a712c" strokeWidth="1.5"/>
   <path d="M133 107v26l22 13v-26l-22-13Z" fill="#edc36b" stroke="#9a712c" strokeWidth="1.5"/><path d="M178 107v26l-23 13v-26l23-13Z" fill="#fff0c9" stroke="#9a712c" strokeWidth="1.5"/>
   <path d="m144 101 23 13" stroke="#9a712c" strokeWidth="2"/>
   <g className="wholesale-art-note"><rect x="157" y="38" width="49" height="59" rx="9" fill="#fff" stroke="#b6c7e2" strokeWidth="2"/><path d="M168 52h18m-18 9h26m-26 8h26" stroke="#8ca6cc" strokeWidth="3" strokeLinecap="round"/><path d="m170 81 5 5 13-14" stroke="#17285c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></g>
  </>:<>
   <g className="wholesale-art-note"><rect x="65" y="30" width="104" height="119" rx="14" fill="#fff" stroke="#a9bedf" strokeWidth="2"/><rect x="82" y="49" width="35" height="29" rx="6" fill="#e5edfa"/><path d="m90 58 10-5 10 5-10 5-10-5Zm0 0v11l10 6 10-6V58m-10 5v12" stroke="#526ca1" strokeWidth="2" strokeLinejoin="round"/><path d="M127 53h24m-24 9h19M83 95h67m-67 11h51m-51 11h59" stroke="#b6c7e2" strokeWidth="3" strokeLinecap="round"/><rect x="83" y="128" width="48" height="6" rx="3" fill="#17285c"/></g>
   <path d="M149 100h44a11 11 0 0 1 11 11v22a11 11 0 0 1-11 11h-22l-13 10v-10h-9a11 11 0 0 1-11-11v-22a11 11 0 0 1 11-11Z" fill="#ffdfa0" stroke="#b58c43" strokeWidth="2"/><path d="M151 115h39m-39 10h27" stroke="#8e6728" strokeWidth="3" strokeLinecap="round"/>
   <circle cx="52" cy="77" r="16" fill="#17285c"/><path d="M45 78h14m-7-7v14" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
  </>}
  <path d="m27 49 3-6 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" fill="#e8bd64"/><circle cx="204" cy="78" r="4" fill="#b5c8e8"/>
 </svg>;
}

export function WholesaleCategoryArt({category}:{category:string}){
 return <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="wholesale-category-art">
  <ellipse cx="40" cy="66" rx="25" ry="5" fill="#17285c" opacity=".09"/>
  <g stroke="#365586" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
  {category==='hvac'?<><path d="M18 27c0-10 44-10 44 0v27c0 10-44 10-44 0V27Z" fill="#dfc39d" stroke="#98744f"/><ellipse cx="40" cy="27" rx="22" ry="9" fill="#f7e7cc" stroke="#98744f"/><ellipse cx="40" cy="27" rx="12" ry="4" fill="#d2ad7c" stroke="#98744f"/><path d="M19 36c8 8 34 8 42 0m-42 9c8 8 34 8 42 0m-42 9c8 8 34 8 42 0" stroke="#98744f"/></>:category==='electrical'?<><path d="M23 54c-15-21 1-40 18-36 29 6 26 41 5 43-21 3-29-22-15-31 12-8 24 7 14 15" strokeWidth="7" stroke="#8faad0"/><path d="M46 45h13v10H46z" fill="#17285c"/><path d="M59 47h6m-6 6h6M23 54l-5 8" stroke="#17285c" strokeWidth="4"/></>:category==='plumbing'?<><path d="M15 29h27v14h20v17H35c-6 0-10-4-10-10v-5H15V29Z" fill="#d7e1ed"/><path d="M14 25h7v24h-7zm44 14h8v25h-8z" fill="#8fa9cc"/><path d="M26 30h12m-1 22h17" stroke="#fff"/></>:category==='tools'?<><path d="m26 54 23-25M44 20c8-6 17-3 19 4l-10 3-1 8 10 2c-2 9-10 13-18 8L31 61a9 9 0 0 1-13-12l16-14c-5-6-2-14 4-17l1 11 8 2 2-11" fill="#dbe6f5"/><circle cx="25" cy="55" r="3" fill="#e4b762"/></>:category==='refrigerants'?<><rect x="24" y="24" width="33" height="39" rx="10" fill="#e3ebf7"/><path d="M32 24v-8h17v8m-9-8v-5m-7 0h14"/><rect x="31" y="36" width="19" height="14" rx="3" fill="#fff"/><path d="m40 39-3 5h6l-3 4" stroke="#c2943e"/></>:category==='appliances'?<><rect x="21" y="15" width="39" height="49" rx="5" fill="#e4ebf6"/><path d="M22 28h37"/><circle cx="40" cy="45" r="12" fill="#8fa9cc"/><circle cx="40" cy="45" r="7" fill="#dce8f8"/><path d="M28 21h8m15 0h2"/></>:category==='hardware'?<><path d="m20 24 12-7 12 7v14l-12 7-12-7V24Z" fill="#d5e0f1"/><circle cx="32" cy="31" r="5" fill="#fff"/><path d="m48 34 12 1 6 11-6 11H48l-6-11 6-12Z" fill="#e8c887" stroke="#a68042"/><circle cx="54" cy="46" r="5" fill="#fff" stroke="#a68042"/><path d="m24 50-5 12h16l-5-12" fill="#b9cbe4"/></>:<><path d="m17 31 23-12 23 12-23 13-23-13Z" fill="#e4ebf6"/><path d="M17 31v24l23 13 23-13V31M40 44v24m-11-43 23 13v9" fill="#d2e0f4"/></>}
  </g>
 </svg>;
}
