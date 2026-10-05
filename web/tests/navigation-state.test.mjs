import test from 'node:test';import assert from 'node:assert/strict';import {restoreTab} from '../src/services/navigationState.mjs';
const allowed=['Explore','Bookings','Hire'];
test('refresh retains tab, valid notification deep link takes precedence',()=>{const store={getItem:()=> 'Hire'};assert.equal(restoreTab(store,'customer',allowed,'Explore'),'Hire');assert.equal(restoreTab(store,'customer',allowed,'Explore','Bookings'),'Bookings');});
test('blocked storage and obsolete tabs safely fall back',()=>{assert.equal(restoreTab({getItem(){throw Error();}},'customer',allowed,'Explore'),'Explore');assert.equal(restoreTab({getItem:()=> 'bad'},'customer',allowed,'Explore'),'Explore');});
test('customer and agent navigation use separate keys',()=>{const store={getItem:key=>key==='customer'?'Hire':'Earnings'};assert.equal(restoreTab(store,'customer',allowed,'Explore'),'Hire');assert.equal(restoreTab(store,'agent',['Home','Earnings'],'Home'),'Earnings');});
