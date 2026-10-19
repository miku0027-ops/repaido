// One stable placement choice per browser session, with no account, location,
// search text or cross-session tracking. Rendering never changes this choice.
export function bikePromotionSlot(seed){
 return typeof seed==='string'&&/^[0-9a-f]{8}$/.test(seed)&&parseInt(seed,16)%3===0;
}
export function canAdvertiseBike(policy,now=Date.now()/1000){
 if(!policy?.enabled||policy.bookings_available!==true||!policy.routing_ready)return false;
 return !!policy.paid_ready||!!(policy.promo_ready&&policy.promo_enabled&&Number.isFinite(policy.promo_ends_at)&&policy.promo_ends_at>now);
}
