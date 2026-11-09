import test from 'node:test';import assert from 'node:assert/strict';import {loadingLabel} from '../src/services/loadingMessages.mjs';
test('financial and product loading describe the operation without claiming professional matching',()=>{
 for(const path of ['/payments','/checkout/booking/order','/refunds','/shop/payouts']){
  assert.match(loadingLabel(path),/payment/i);
  assert.doesNotMatch(loadingLabel(path),/professional|matching/i);
 }
 for(const path of ['/jobs/123/market','/inventory','/rentals']){
  assert.match(loadingLabel(path),/products/i);
  assert.doesNotMatch(loadingLabel(path),/professional|matching/i);
 }
 assert.match(loadingLabel('/professionals/search'),/professionals/i);
});
