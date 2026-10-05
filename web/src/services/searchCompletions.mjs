const aliases = {aircon:'ac',fridge:'refrigerator',plumber:'plumbing',electrician:'electrical',cleaner:'cleaning'};
const words = text => text.toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.map(w=>aliases[w]||w)||[];
function oneEdit(a,b){
 if(Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,errors=0;
 while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++errors>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
 return errors+(i<a.length||j<b.length?1:0)<=1;
}
/** Catalogue-only completions. No raw queries or keystrokes are retained.
 * @param {string} query
 * @param {{label:string,category:string,kind:string}[]} candidates
 * @param {Record<string,number>} interests
 */
export function searchCompletions(query,candidates,interests={}){
 const needle=words(query);if(query.trim().length<2||!needle.length)return [];
 const seen=new Set();return candidates.flatMap(c=>{
  const key=c.label.toLocaleLowerCase().trim();if(seen.has(key)||key===query.toLocaleLowerCase().trim())return [];seen.add(key);
  const tokens=words(c.label);let score=0;
  for(const n of needle){if(tokens.some(t=>t===n))score+=4;else if(tokens.some(t=>t.startsWith(n)))score+=3;else if(n.length>=4&&tokens.some(t=>oneEdit(n,t)))score+=1;else return [];}
  score+=Math.min(0.5,(interests[c.category]||0)/20);
  return [{...c,score}];
 }).sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label)).slice(0,6);
}
