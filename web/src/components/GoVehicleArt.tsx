export type GoVehicleKind='bike'|'cab'|'self_drive'|'rental';

/** Original Repaido vehicle characters. Shared by cards, search and map pins. */
export function GoVehicleArt({kind='cab',size=56}:{kind?:GoVehicleKind;size?:number}){
 return <svg width={size} height={size*.68} viewBox="0 0 96 64" fill="none" aria-hidden="true" className="go-vehicle-art">
  <ellipse cx="49" cy="54" rx="38" ry="4" fill="currentColor" opacity=".12"/>
  {kind==='bike'?<>
   <circle cx="24" cy="43" r="12" fill="#202124"/><circle cx="24" cy="43" r="6" fill="#e8eaed"/><circle cx="74" cy="43" r="12" fill="#202124"/><circle cx="74" cy="43" r="6" fill="#e8eaed"/>
   <path d="m24 43 15-22 20 22H24Zm35 0 8-25 7 25" stroke="#5f6368" strokeWidth="4" strokeLinejoin="round"/>
   <path d="M36 22h21l7 9H37l-5-5 4-4Z" fill="#fbbc04"/><path d="M36 18h19" stroke="#202124" strokeWidth="5" strokeLinecap="round"/>
   <path d="m66 18 4-7h8" stroke="#202124" strokeWidth="4" strokeLinecap="round"/><path d="m72 23 6 3" stroke="#fff3c4" strokeWidth="4" strokeLinecap="round"/>
   <circle cx="48" cy="10" r="7" fill="#202124"/><path d="M42 8a7 7 0 0 1 13 0H42Z" fill="#fbbc04"/><path d="m46 20 9 7 11-5" stroke="#202124" strokeWidth="6" strokeLinecap="round"/>
  </>:<>
   <path d="m15 31 13-17a8 8 0 0 1 6-3h31a9 9 0 0 1 7 4l10 16 6 5v12H9V36l6-5Z" fill={kind==='self_drive'?'#e8eaed':'#fbbc04'} stroke="#202124" strokeWidth="2" strokeLinejoin="round"/>
   <path d="M29 17h17v14H19l10-14Zm22 0h13l10 14H51V17Z" fill="#303134"/>
   <path d="M33 19h8l-9 10h-9l10-10Z" fill="#80868b"/><path d="M65 20h-9v9h15l-6-9Z" fill="#5f6368"/>
   <path d="M11 38h8m58 0h8" stroke="#fff" strokeWidth="4" strokeLinecap="round"/><path d="M49 34v12m6-9h5" stroke="#202124" strokeWidth="2"/>
   <circle cx="27" cy="47" r="10" fill="#202124"/><circle cx="27" cy="47" r="5" fill="#dadce0"/><circle cx="72" cy="47" r="10" fill="#202124"/><circle cx="72" cy="47" r="5" fill="#dadce0"/>
   {kind==='cab'&&<path d="M39 7h19v5H39z" fill="#202124"/>}
   {kind==='rental'&&<path d="M34 7h30v5H34z" fill="#202124"/>}
  </>}
 </svg>;
}

export function goVehicleMapSvg(kind:GoVehicleKind='cab'){
 const vehicle=kind==='bike'?'<circle cx="24" cy="10" r="4" fill="#202124"/><path d="M24 15v19m-8-17 8 7 8-7" stroke="#202124" stroke-width="5" stroke-linecap="round"/><rect x="20" y="22" width="8" height="13" rx="3" fill="#fbbc04"/><path d="M24 5v3m0 28v6" stroke="#202124" stroke-width="4" stroke-linecap="round"/>':'<rect x="12" y="5" width="24" height="38" rx="9" fill="#202124"/><rect x="14" y="7" width="20" height="34" rx="7" fill="#fbbc04"/><path d="m18 14-2 8h16l-2-8H18Zm-2 19 2 4h12l2-4H16Z" fill="#303134"/><rect x="18" y="24" width="12" height="7" rx="2" fill="#fff3c4"/>';
 return '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><ellipse cx="24" cy="25" rx="19" ry="21" fill="#202124" opacity=".15"/><g>'+vehicle+'</g></svg>';
}
