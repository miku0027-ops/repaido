import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual App event handler; avoid a second copy of its routing map.
const source=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let initializer;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='open'&&node.initializer?.getText(tree).includes("'repaido:activity-open'")===false&&node.initializer?.getText(tree).includes("'retail_resolution_cases'"))initializer=node.initializer;ts.forEachChild(node,visit);}
visit(tree);assert(initializer,'App activity handler must exist');
const compiled=ts.transpileModule('const handler='+initializer.getText(tree)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function routing(){
 const calls=[],location={href:'https://repaido.test/'},history={state:{},replaceState(_state,_title,url){location.href=String(url);}};
 const scope={URL,history,location,Date,auth:{currentUser:{uid:'customer'}},window:{dispatchEvent:event=>calls.push(['event',event.type,event.detail])},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},AbortSignal,
  publicProfessionalDetails:async id=>({id}),navigatePortal:target=>calls.push(['portal',target])};
 for(const name of ['openStoreSection','setMarketQuick','setShowCartDrawer','setOrderFocusId','setFocusedHire','setTab','setError','setActivityRecord','updateRideBookings','updateHireBookings','updateHomePlans','updateContractBookings','setContributeBookings','setNotificationJob','setHomeHub','setSharedRideId'])scope[name]=(...args)=>calls.push([name,...args]);
 return {calls,location,open:new Function('scope','with(scope){'+compiled+'return handler;}')(scope)};
}

test('home-plan activity opens the existing plan calendar, without starting a new service request',async()=>{
 const r=routing();await r.open({detail:{kind:'home_plans',id:'owned-plan'}});
 assert(r.calls.some(x=>x[0]==='updateHomePlans'&&x[1]===true));assert(r.calls.some(x=>x[0]==='setTab'&&x[1]==='Bookings'));
 assert.equal(new URL(r.location.href).searchParams.get('home-plan'),'owned-plan');assert(!r.calls.some(x=>x[0]==='setHomeHub'));
});
test('hiring activity focuses its request and never sends a hire ID to operational jobs',async()=>{
 const r=routing();await r.open({detail:{kind:'hires',id:'hire-request'}});
 assert(r.calls.some(x=>x[0]==='updateHireBookings'&&x[1]===true));assert(r.calls.some(x=>x[0]==='setActivityRecord'&&x[1].id==='hire-request'));
 assert.deepEqual(r.calls.find(x=>x[0]==='setNotificationJob'),['setNotificationJob',undefined]);
});
test('rental activity opens rental management with the rental record, distinct from catalogue inventory',async()=>{
 const r=routing();await r.open({detail:{kind:'rentals',id:'rental-record'}});
 assert.deepEqual(r.calls.find(x=>x[0]==='setMarketQuick'),['setMarketQuick',{rentalRequestId:'rental-record'}]);
 assert.deepEqual(r.calls.find(x=>x[0]==='openStoreSection'),['openStoreSection','rentals']);
});
test('contribution activity selects the correct native sublist and exact owned record',async()=>{
 for(const [kind,tab,key] of [['scrap_collections','collections','scrap-collection'],['cleanup_reports','reports','cleanup-report'],['community_contributions','rewards',null]]){
  const r=routing();await r.open({detail:{kind,id:'contribution-record'}});const params=new URL(r.location.href).searchParams;
  assert.equal(params.get('contribution'),tab);if(key)assert.equal(params.get(key),'contribution-record');assert(r.calls.some(x=>x[0]==='setContributeBookings'&&x[1]===true));
 }
});
test('orders and retail resolution activity focus the owning order in the cart drawer',async()=>{
 for(const kind of ['retail_orders','retail_resolution_cases']){const r=routing();await r.open({detail:{kind,id:'owned-order'}});assert.deepEqual(r.calls.find(x=>x[0]==='setOrderFocusId'),['setOrderFocusId','owned-order']);assert.deepEqual(r.calls.find(x=>x[0]==='setShowCartDrawer'),['setShowCartDrawer',true]);}
});
test('ride activity selects rides and clears an unrelated shared-ride focus',async()=>{
 const r=routing();await r.open({detail:{kind:'mobility_rides',id:'private-ride'}});assert.deepEqual(r.calls.find(x=>x[0]==='updateRideBookings'),['updateRideBookings',true]);assert.deepEqual(r.calls.find(x=>x[0]==='setSharedRideId'),['setSharedRideId','']);
});
test('only booking records supply operational job IDs and malformed references do nothing',async()=>{
 const r=routing();await r.open({detail:{kind:'jobs',id:'actual-job'}});assert.deepEqual(r.calls.find(x=>x[0]==='setNotificationJob'),['setNotificationJob','actual-job']);
 for(const id of ['', '../private', 'a'.repeat(129)]){const rejected=routing();await rejected.open({detail:{kind:'jobs',id}});assert.deepEqual(rejected.calls,[]);}
});
