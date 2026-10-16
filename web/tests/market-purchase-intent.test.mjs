import test from 'node:test';
import assert from 'node:assert/strict';
const storage=new Map();globalThis.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const {marketPurchaseIntent,acknowledgeMarketPurchase}=await import('../src/services/marketPurchaseIntent.mjs');
test('lost order/check replies and a dismissed checkout retain the same purchase, independently per account',()=>{
 const first=marketPurchaseIntent('buyer');assert.equal(marketPurchaseIntent('buyer'),first);assert.notEqual(marketPurchaseIntent('seller'),first);
 for(const status of [undefined,'created','creating','authorized','processing']){acknowledgeMarketPurchase('buyer',status);assert.equal(marketPurchaseIntent('buyer'),first);}
 acknowledgeMarketPurchase('buyer','captured');const next=marketPurchaseIntent('buyer');assert.notEqual(next,first);acknowledgeMarketPurchase('buyer','refunded');assert.notEqual(marketPurchaseIntent('buyer'),next);
});
test('a page reload restores an unacknowledged purchase from the account-scoped tab record',async()=>{
 const first=marketPurchaseIntent('reload-buyer');const fresh=await import('../src/services/marketPurchaseIntent.mjs?reload');assert.equal(fresh.marketPurchaseIntent('reload-buyer'),first);assert.throws(()=>fresh.marketPurchaseIntent(''));
});
