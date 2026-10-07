// Bounded memory only: private responses never enter persistent/shared storage.
export function createReadCache({maxEntries=80,now=()=>Date.now()}={}) {
  const entries=new Map(),pending=new Map();let generation=0;
  return {
    peek(key,maxAge=60000){const entry=entries.get(key);if(!entry||now()-entry.at>=maxAge)return null;entries.delete(key);entries.set(key,entry);return entry.value;},
    freshUntil(key,maxAge=60000){const entry=entries.get(key);return entry&&now()-entry.at<maxAge?entry.at+maxAge:0;},
    async read(key,load,{freshMs=10000,force=false}={}) {
      const entry=entries.get(key);
      if(!force&&entry&&now()-entry.at<freshMs){entries.delete(key);entries.set(key,entry);return entry.value;}
      if(pending.has(key))return pending.get(key);
      const epoch=generation;
      const request=Promise.resolve().then(load).then(value=>{
        if(epoch===generation){entries.delete(key);entries.set(key,{at:now(),value});while(entries.size>maxEntries)entries.delete(entries.keys().next().value);}
        return value;
      });
      pending.set(key,request);
      try{return await request;}finally{if(pending.get(key)===request)pending.delete(key);}
    },
    invalidate(){generation++;entries.clear();pending.clear();},
  };
}
