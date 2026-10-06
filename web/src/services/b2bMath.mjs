// Both quantity estimates and quote previews use integer paise. Saved server totals remain authoritative.
export function slabRatePaise(listing,quantity){
 const slabs=[...(listing.bulkSlabs||[])].sort((a,b)=>b.minQty-a.minQty);
 const slab=slabs.find(s=>quantity>=s.minQty&&(s.maxQty==null||quantity<=s.maxQty));
 return Math.round((slab?slab.pricePerUnit:listing.basePrice)*100);
}
export function quotationTotals(quantity,ratePaise,gstBps,freightPaise){
 const taxablePaise=quantity*ratePaise;
 const gstPaise=Math.floor((taxablePaise*gstBps+5000)/10000);
 return {taxablePaise,gstPaise,freightPaise,totalPaise:taxablePaise+gstPaise+freightPaise};
}
