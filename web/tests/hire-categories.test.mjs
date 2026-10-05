import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryMetadata,visibleHireCategories} from '../src/services/hireCategories.mjs';
test('new backend service categories appear without a frontend whitelist',()=>{
 assert.deepEqual(categoryMetadata([{id:'ac',name:'AC & appliances'}],[{category:'ac'},{category:'solar-repair'}]),[{id:'ac',name:'AC & appliances'},{id:'solar-repair',name:'Solar Repair'}]);
});
test('catalogue cache strips profile counts and expires without blocking storage failures',async()=>{
 const {saveHireCategories,readHireCategories}=await import('../src/services/hireCategories.mjs?cache-test');
 const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 saveHireCategories('regular',[{id:'ac',name:'AC',count:22,leader:{name:'Private'}}],storage,1000);
 saveHireCategories('home',[{id:'home:maid',name:'Maid'}],storage,1000);
 const cache=readHireCategories(storage,1001);
 assert.deepEqual(cache.regular,[{id:'ac',name:'AC'}]);assert.equal(cache.home.length,1);
 assert.equal(readHireCategories(storage,1000+8*86400000),null);
 const blocked={getItem(){throw Error();},setItem(){throw Error();}};
 assert.doesNotThrow(()=>saveHireCategories('regular',[{id:'new',name:'New'}],blocked,1000+9*86400000));
});
test('show all grows automatically and the compact view stays bounded',()=>{
 const rows=Array.from({length:30},(_,i)=>({id:String(i),name:String(i)}));
 assert.equal(visibleHireCategories(rows,false).length,11);
 assert.equal(visibleHireCategories(rows,true).length,30);
});
