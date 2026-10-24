/** Browser-side backpressure for Google SDK calls. In-flight SDK requests cannot
 * be aborted: keep their capacity occupied until they really finish. Only queued
 * work is removed on cancellation; callers never receive stale results. */
export function createPlaceRequestQueue({concurrency=4,searchConcurrency=2,maxQueued=16,queueTtl=5000,responseTimeout=15000}={}) {
 let active=0,searches=0;
 const queue=[];
 const aborted=()=>new DOMException('Search replaced or closed.','AbortError');
 const pump=()=>{
  while(active<concurrency){
   let index=queue.findIndex(job=>job.kind!=='search');
   if(index<0&&searches<searchConcurrency)index=queue.findIndex(job=>job.kind==='search');
   if(index<0)return;
   const job=queue.splice(index,1)[0];clearTimeout(job.queueTimer);
   if(job.signal?.aborted){job.fail(aborted());continue;}
   active++;if(job.kind==='search')searches++;
   job.started=true;
   const timer=setTimeout(()=>job.fail(Error('Place lookup timed out. Please try again.')),responseTimeout);
   Promise.resolve().then(()=>{if(job.signal?.aborted)throw aborted();return job.run();}).then(value=>{if(job.signal?.aborted)job.fail(aborted());else job.succeed(value);},job.fail).finally(()=>{
    clearTimeout(timer);active--;if(job.kind==='search')searches--;pump();
   });
  }
 };
 return {
  run(run,{signal,kind='search'}={}){
   if(signal?.aborted)return Promise.reject(aborted());
   if(queue.length>=maxQueued)return Promise.reject(Error('Place search is busy. Please try again.'));
   return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(callback,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);callback(value);};
    const job={run,signal,kind,started:false,queueTimer:null,succeed:value=>finish(resolve,value),fail:error=>finish(reject,error)};
    const remove=()=>{const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);clearTimeout(job.queueTimer);};
    const cancel=()=>{remove();job.fail(aborted());pump();};
    signal?.addEventListener('abort',cancel,{once:true});
    job.queueTimer=setTimeout(()=>{remove();job.fail(Error('Search expired. Please try again.'));pump();},queueTtl);
    queue.push(job);pump();
   });
  },
  stats:()=>({active,searches,queued:queue.length})
 };
}
