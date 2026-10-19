import assert from 'node:assert/strict';
import test from 'node:test';
import {bikePromotionSlot,canAdvertiseBike} from '../src/services/bikePromotionPlacement.mjs';
test('promotion placement is stable and appears in one of three session buckets',()=>{
 assert.equal(bikePromotionSlot('00000000'),true);
 assert.equal(bikePromotionSlot('00000001'),false);
 assert.equal(bikePromotionSlot('00000002'),false);
 assert.equal(bikePromotionSlot('00000003'),true);
 for(const malformed of ['',null,{},'hello','123','fffffffff'])assert.equal(bikePromotionSlot(malformed),false);
});
test('home marketing requires current genuine service and offer readiness',()=>{
 const policy={enabled:true,bookings_available:true,routing_ready:true,paid_ready:false,promo_ready:true,promo_enabled:true,promo_ends_at:200};
 assert.equal(canAdvertiseBike(policy,100),true);
 assert.equal(canAdvertiseBike(policy,201),false);
 for(const key of ['enabled','bookings_available','routing_ready','promo_ready','promo_enabled'])assert.equal(canAdvertiseBike({...policy,[key]:false},100),false,key);
 assert.equal(canAdvertiseBike({...policy,paid_ready:true,promo_ready:false},201),true);
 assert.equal(canAdvertiseBike({...policy,bookings_available:undefined},100),false);
});
