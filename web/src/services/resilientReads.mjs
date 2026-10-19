/** Bounded retry for safe reads only; writes retain their explicit receipt flow. */
export async function abortablePause(milliseconds, signal) {
  if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
  await new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},milliseconds);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
export async function resilientRead(url,init={}, {fetcher=fetch,random=Math.random,pause=abortablePause}={}) {
  const safe=['GET','HEAD'].includes((init.method||'GET').toUpperCase());
  for(let attempt=0;;attempt++){
    const response=await fetcher(url,init);
    if(!safe||attempt>=2||![429,502,503,504].includes(response.status)||init.signal?.aborted)return response;
    const retry=response.headers.get('Retry-After');
    const base=/^\d+(?:\.\d+)?$/.test(retry||'')?Math.min(2000,Number(retry)*1000):250*2**attempt;
    // Release the discarded response connection, and spread clients across time.
    await response.body?.cancel().catch(()=>{});
    await pause(Math.min(2500,base+Math.floor(random()*250)),init.signal);
  }
}
export function pollDelay(base,failures,random=Math.random){
  return Math.round(Math.min(60000,base*2**Math.min(4,Math.max(0,failures)))*(0.9+random()*0.2));
}
