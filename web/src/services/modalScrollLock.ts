// Nested dialogs can unmount in either order (for example, during an account change).
const locks=new WeakMap<Document,{count:number;body:string;root:string}>();
export function acquireModalScrollLock(doc:Document=document):()=>void {
  let state=locks.get(doc);
  if(!state){state={count:0,body:doc.body.style.overflow,root:doc.documentElement.style.overflow};locks.set(doc,state);}
  state.count++;
  doc.body.style.overflow='hidden';doc.documentElement.style.overflow='hidden';
  let released=false;
  return()=>{
    if(released)return;released=true;
    if(--state.count>0)return;
    doc.body.style.overflow=state.body;doc.documentElement.style.overflow=state.root;locks.delete(doc);
  };
}
