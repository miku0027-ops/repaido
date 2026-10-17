import test from 'node:test';import assert from 'node:assert/strict';import {tips,selectTip,loadingLabel} from '../src/services/loadingMessages.mjs';
test('at least forty unique service messages',()=>{assert.ok(tips.length>=40);assert.equal(new Set(tips.map(t=>t[1])).size,tips.length);});
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
test('optional discovery interests select relevant tips with contextual overrides',()=>{assert.ok(tips.filter(t=>t[0]==='cleaning').some(t=>t[1]===selectTip('/discovery',2,['cleaning'])));assert.ok(tips.filter(t=>t[0]==='market').some(t=>t[1]===selectTip('/market',2,['cleaning'])));assert.ok(tips.filter(t=>t[0]==='worker').some(t=>t[1]===selectTip('/market',2,['cleaning'],true)));});
