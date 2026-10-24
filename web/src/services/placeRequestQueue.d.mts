export function createPlaceRequestQueue(options?:{concurrency?:number;searchConcurrency?:number;maxQueued?:number;queueTtl?:number;responseTimeout?:number}):{
 run<T>(run:()=>Promise<T>,options?:{signal?:AbortSignal;kind?:'search'|'selection'}):Promise<T>;
 stats:()=>{active:number;searches:number;queued:number};
};
