import assert from 'node:assert/strict';
import {test} from 'node:test';
import {couponSavings,couponAppliesTo} from '../src/services/rewardPresentation.mjs';

test('a capped reward preview shows the actual rupee ceiling',()=>{
 assert.equal(couponSavings(100000,{bps:3000,cap_paise:10000}),10000);
 assert.equal(couponSavings(10000,{bps:3000,cap_paise:10000}),3000);
 assert.equal(couponSavings(1000000,{bps:2500,cap_paise:100000}),100000);
});
test('zero or invalid reward limits cannot advertise savings',()=>{
 for(const base of [-1,NaN,Infinity,0,10.5])assert.equal(couponSavings(base,{bps:3000}),0);
 assert.equal(couponSavings(10000,{bps:3000,cap_paise:0}),0);
 assert.equal(couponSavings(10000,{bps:10001}),0);
});
test('existing vendor coupons keep their uncapped percentage preview',()=>{
 assert.equal(couponSavings(49900,{bps:2000}),9980);
});
test('repair visit coupons appear for service bookings and never for hiring',()=>{
 assert(couponAppliesTo({scope:'visit'},'service'));
 assert(!couponAppliesTo({scope:'visit'},'hire'));
 assert(couponAppliesTo({scope:'hire'},'hire'));
 assert(couponAppliesTo({scope:'service'},'home'));
 assert(!couponAppliesTo({scope:'refurbished'},'rental'));
});
