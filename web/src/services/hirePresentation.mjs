/** Stable browsing order; published rank values are never changed. */
export function orderHireProfiles(rows,interests={},personalised=false){
 if(!personalised)return rows;
 const score=p=>p.categories.reduce((n,c)=>n+(interests[c]||0),0)+(p.home_services||[]).reduce((n,c)=>n+(interests['home:'+c]||interests[c]||0),0);
 return rows.map((p,index)=>({p,index})).sort((a,b)=>score(b.p)-score(a.p)||a.index-b.index).map(x=>x.p);
}
export function completePublicProfile(p){return !!(p.portrait_url&&p.bio?.trim()&&p.skills?.length&&p.categories?.length&&p.languages?.length);}
export function spotlightProfiles(rows,seed,interests={},personalised=false){
 const eligible=rows.filter(completePublicProfile);if(personalised&&Object.values(interests).some(v=>v>0))return orderHireProfiles(eligible,interests,true);
 const hash=id=>{let h=seed|0;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
 return [...eligible].sort((a,b)=>hash(a.id)-hash(b.id)||a.id.localeCompare(b.id));
}
