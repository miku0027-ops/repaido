const KEY='repaido.hire-category-catalogue.v1';
const MAX_AGE=7*24*60*60*1000;
let memory;
export function categoryMetadata(categories=[],services=[]){
 const rows=new Map();
 for(const c of categories)if(c&&typeof c.id==='string'&&c.id!=='all'&&typeof c.name==='string')rows.set(c.id,{id:c.id,name:c.name});
 for(const s of services)if(s&&typeof s.category==='string'&&s.category&&!rows.has(s.category))rows.set(s.category,{id:s.category,name:s.category.replace(/[_-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())});
 return [...rows.values()];
}
export function readHireCategories(storage=globalThis.localStorage,now=Date.now()){
 try{const data=memory||JSON.parse(storage.getItem(KEY)||'null');if(!data||now-data.at>MAX_AGE||data.at>now||!Array.isArray(data.regular)||!Array.isArray(data.home))return null;return {...data,regular:categoryMetadata(data.regular),home:now-data.homeAt>MAX_AGE?[]:categoryMetadata(data.home)};}catch{return null;}
}
export function saveHireCategories(kind,rows,storage=globalThis.localStorage,now=Date.now()){
 const old=readHireCategories(storage,now)||{regular:[],home:[],homeAt:0};
 memory={...old,[kind]:categoryMetadata(rows),at:now,...(kind==='home'?{homeAt:now}:{})};
 try{storage.setItem(KEY,JSON.stringify(memory));}catch{/* Memory remains usable when storage is unavailable. */}
 return memory;
}
export function visibleHireCategories(rows,expanded,limit=11){return expanded?rows:rows.slice(0,limit);}
