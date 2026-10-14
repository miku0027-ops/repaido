import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pricedPromotion,bestCategoryOffer} from '../src/services/promotionPresentation.mjs';
const card={id:'a',service:{id:'ac',category:'ac',price_paise:59900},price_paise:59900,discount_paise:14975,offer_price_paise:44925,ends_at:200};
test('only actual, unexpired catalogue savings at or below 25% are displayed',()=>{
 assert(pricedPromotion(card,100));
 for(const change of [{discount_paise:14976,offer_price_paise:44924},{offer_price_paise:44900},{ends_at:100},{price_paise:0},{service:{...card.service,price_paise:60000}}])assert(!pricedPromotion({...card,...change},100));
});
test('best funded eligible category price stays on the exact matching service',()=>{
 const lesser={...card,id:'b',discount_paise:5000,offer_price_paise:54900};
 const expired={...card,id:'c',ends_at:1};
 assert.equal(bestCategoryOffer([lesser,expired,card],'ac',100).id,'a');
 assert.equal(bestCategoryOffer([card],'plumber',100),undefined);
});
import {actionMessages,changesAccountData} from '../src/services/actionMessages.mjs';
test('campaign impressions and repeat receipts neither announce saves nor invalidate account reads',()=>{
 for(const kind of ['impression','open','dismiss']){
  const init={method:'POST',body:JSON.stringify({kind,event_id:'test-event'})};
  assert.equal(actionMessages('/campaigns/test-offer/events',init),null);
  assert.equal(changesAccountData('/campaigns/test-offer/events',init),false);
 }
});
