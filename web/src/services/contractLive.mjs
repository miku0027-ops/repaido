// A shared watcher checks only a small server revision, fetching detail after a
// change. It pauses in hidden tabs and never overlaps or survives its account.
export function createContractWatcher({read,onChange,onState,active=()=>true,schedule=setTimeout,cancel=clearTimeout,interval=2500}) {
  let stopped=false,timer=null,controller=null,revision=null,failures=0,epoch=0;
  const later=delay=>{timer=schedule(tick,delay);};
  async function tick(){
    timer=null;
    if(stopped)return;
    if(!active()){onState('paused');return;}
    const abort=new AbortController();controller=abort;const current=++epoch;
    try{
      const result=await read(abort.signal);
      if(stopped||current!==epoch||abort.signal.aborted)return;
      const changed=revision!==result.revision;
      revision=result.revision;failures=0;onState('current');
      if(changed)onChange();
    }catch(error){
      if(stopped||current!==epoch||abort.signal.aborted)return;
      failures++;
      if([401,402,403,404].includes(error.status)||error.code==='ACCOUNT_CHANGED'){
        stopped=true;onState('unavailable');onChange();return;
      }
      onState('reconnecting');
    }finally{
      if(current===epoch)controller=null;
    }
    if(!stopped)later(Math.min(20000,interval*2**Math.min(failures,3)));
  }
  return {
    start(){if(timer===null&&!controller&&!stopped)later(0);},
    resume(){if(stopped)return;cancel(timer);timer=null;epoch++;controller?.abort();controller=null;if(active())later(0);else onState('paused');},
    stop(){stopped=true;epoch++;cancel(timer);timer=null;controller?.abort();controller=null;},
  };
}
