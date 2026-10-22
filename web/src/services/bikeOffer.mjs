/** Public offer wording is conditional; personal eligibility is checked in Go. */
export function bikeOfferText(policy,city,now=Date.now()/1000){
 if(city?.trim().toLowerCase()!=='balasore'||!policy?.enabled||policy.bookings_available!==true||!policy.routing_ready||!policy.promo_enabled||!policy.promo_ready||!Number.isFinite(policy.promo_ends_at)||policy.promo_ends_at<=now)return null;
 if(!Number.isInteger(policy.weekly_free_limit)||policy.weekly_free_limit<1||!Number.isFinite(policy.free_distance_metres)||policy.free_distance_metres<=0)return null;
 return `Up to ${policy.weekly_free_limit} free bike rides/week · within ${policy.free_distance_metres/1000} km · eligibility applies`;
}
