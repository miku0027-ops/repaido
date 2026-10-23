/** Original blueprint artwork; decorative, finite motion follows the card state. */
export function WorkCardVisual(){
 return <span className="work-card-visual" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none">
  <ellipse cx="41" cy="68" rx="25" ry="5" fill="currentColor" opacity=".1"/>
  <g className="work-card-paper"><rect x="15" y="12" width="44" height="53" rx="7" fill="currentColor" opacity=".08"/><rect x="21" y="8" width="44" height="53" rx="7" fill="var(--work-art-paper)" stroke="currentColor" strokeOpacity=".4"/>
   <path d="M30 20h25v29H30zM30 32h14v17m0-29v12h11" className="work-card-blueprint" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
   <path d="M31 55h13" stroke="currentColor" strokeOpacity=".4" strokeWidth="2" strokeLinecap="round"/>
  </g>
  <g className="work-card-pencil"><path d="m53 52 10-17 6 4-10 17-7 4z" fill="var(--work-art-accent)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="m62 37 6 4M53 52l6 4" stroke="currentColor" strokeWidth="1.5"/><path d="m52 60 2-5 3 3z" fill="currentColor"/></g>
 </svg></span>;
}
