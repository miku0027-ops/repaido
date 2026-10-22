import test from 'node:test';
import assert from 'node:assert/strict';
import {bikeOfferText} from '../src/services/bikeOffer.mjs';
const now=1792640000,policy={enabled:true,bookings_available:true,routing_ready:true,promo_enabled:true,promo_ready:true,promo_ends_at:now+300,weekly_free_limit:3,free_distance_metres:2000};
test('home offer wording requires an active current offer in its operating city',()=>{
 assert.match(bikeOfferText(policy,'Balasore',now),/Up to 3 free bike rides\/week.*within 2 km.*eligibility applies/);
 for(const field of ['enabled','bookings_available','routing_ready','promo_enabled','promo_ready'])assert.equal(bikeOfferText({...policy,[field]:false},'Balasore',now),null,field);
 for(const expiry of [undefined,NaN,now-1,now])assert.equal(bikeOfferText({...policy,promo_ends_at:expiry},'Balasore',now),null);
 assert.equal(bikeOfferText(policy,'Cuttack',now),null);
 assert.equal(bikeOfferText({...policy,weekly_free_limit:0},'Balasore',now),null);
});
