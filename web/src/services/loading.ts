type Pending={id:number;path:string;started:number};
let sequence=0;const requests=new Map<number,Pending>();const listeners=new Set<()=>void>();
let snapshot:Pending[]=[];
function publish(){snapshot=[...requests.values()];listeners.forEach(fn=>fn());}
export const loadingState={subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},getSnapshot:()=>snapshot};
export function beginLoading(path:string){const id=++sequence;requests.set(id,{id,path,started:Date.now()});publish();let ended=false;return()=>{if(!ended){ended=true;requests.delete(id);publish();}};}
let interests:string[]=[];
export function setLoadingInterests(categories:string[]){interests=[...new Set(categories)].slice(0,6);}
export function getLoadingInterests(){return interests;}
