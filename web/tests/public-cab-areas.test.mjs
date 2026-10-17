import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicCabAreas,freshPublicCabAreas} from '../src/services/publicCabAreas.mjs';
const response=()=>({server_time:1000,available_cabs:[{id:'public-cell',position:{lat:21.49,lng:86.91},available_count:2,updated_at:990,expires_at:1065,approximation_metres:450}]});
test('public areas retain only coarse count and freshness fields',()=>{
 const value=response();Object.assign(value.available_cabs[0],{driver_id:'private',vehicle_id:'private',exact_position:{lat:21.49345,lng:86.91356}});
 assert.deepEqual(parsePublicCabAreas(value),response());
});
test('a public area disappears exactly at server expiry without another response',()=>{
 const data=parsePublicCabAreas(response());assert.equal(freshPublicCabAreas(data,5000,69999).length,1);assert.equal(freshPublicCabAreas(data,5000,70000).length,0);assert.equal(freshPublicCabAreas(data,5000,100000).length,0);
});
test('server-relative freshness works independently of wall clock and clamps negative elapsed time',()=>{
 const data=parsePublicCabAreas(response());assert.equal(freshPublicCabAreas(data,9000000,8999999).length,1);assert.equal(freshPublicCabAreas(data,9000000,9065000).length,0);assert.deepEqual(freshPublicCabAreas(null,0,0),[]);
});
test('request-time anchoring includes slow response transit in the expiry budget',()=>{
 const data=parsePublicCabAreas(response());
 const requestStarted=5000,responseReceived=14000;
 assert.equal(freshPublicCabAreas(data,requestStarted,responseReceived).length,1);
 assert.equal(freshPublicCabAreas(data,requestStarted,70000).length,0);
});
test('invalid public precision, stale/future timestamps, duplicates and malformed areas are rejected',()=>{
 for(const change of [{approximation_metres:10},{available_count:0},{position:{lat:91,lng:0}},{expires_at:1080},{updated_at:1002},{updated_at:900},{id:''}]){const value=response();Object.assign(value.available_cabs[0],change);assert.throws(()=>parsePublicCabAreas(value));}
 const duplicate=response();duplicate.available_cabs.push(duplicate.available_cabs[0]);assert.throws(()=>parsePublicCabAreas(duplicate));
});
