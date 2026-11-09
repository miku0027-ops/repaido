export function loadingLabel(path){
 if(/tracking|position|availability/.test(path))return 'Updating location…';
 if(/payment|checkout|refund|payout/.test(path))return 'Checking payment…';
 if(/hire|professionals|leaderboard/.test(path))return 'Finding professionals…';
 if(/home.plan/.test(path))return 'Loading your plans…';
 if(/inventory|market|rental/.test(path))return 'Loading products…';
 if(/jobs|booking/.test(path))return 'Loading bookings…';
 if(/catalog|discovery|campaign/.test(path))return 'Loading services…';
 return 'Loading…';
}
