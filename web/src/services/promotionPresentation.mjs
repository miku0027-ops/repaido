// Only published catalogue prices may be crossed out. Loyalty offers have a
// separate policy and never pass through these campaign presentation helpers.
export function pricedPromotion(card,now=Date.now()/1000){
 return !!card?.service&&!card.home_service&&Number.isSafeInteger(card.price_paise)&&
  Number.isSafeInteger(card.discount_paise)&&card.discount_paise>0&&card.price_paise>0&&
  card.discount_paise*4<=card.price_paise&&card.offer_price_paise===card.price_paise-card.discount_paise&&
  card.service.price_paise===card.price_paise&&card.ends_at>now;
}
export function bestCategoryOffer(cards,category,now=Date.now()/1000){
 // Server ordering reflects eligibility and saved interests; savings break
 // ties within a category without changing the advertised service price.
 return cards.filter(c=>c.service?.category===category&&pricedPromotion(c,now))
  .sort((a,b)=>b.discount_paise/b.price_paise-a.discount_paise/a.price_paise||b.discount_paise-a.discount_paise)[0];
}
export function offerExpiry(at){
 return new Date(at*1000).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'});
}
