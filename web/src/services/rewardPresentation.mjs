/** Preview only. The server reserves and calculates the final reward. */
export function couponSavings(base,coupon){
 if(!Number.isSafeInteger(base)||base<=0||!coupon||!Number.isInteger(coupon.bps)||coupon.bps<=0||coupon.bps>10000)return 0;
 const percentage=Math.floor(base*coupon.bps/10000);
 return Math.min(base,percentage,coupon.cap_paise==null?base:Math.max(0,coupon.cap_paise));
}
export function couponAppliesTo(coupon,scope){
 return coupon.scope===scope||coupon.scope==='service'&&['hire','home'].includes(scope)||coupon.scope==='visit'&&scope==='service';
}
