/** Saved wholesale listings, private inquiries and supplier quotations. Money is in INR in UI models. */
export type B2BUnit='Boxes'|'Pieces'|'Rolls'|'Meters'|'Bundles'|'Kg'|'Sets'|'Cartons'|'Packs';
export type B2BCategory='hvac'|'electrical'|'plumbing'|'tools'|'refrigerants'|'appliances'|'hardware';
export type RFQUrgency='immediate'|'within_7_days'|'within_15_days'|'flexible';
export type RFQStatus='pending'|'quoted'|'accepted'|'declined'|'cancelled';
export interface B2BPriceSlab {minQty:number;maxQty?:number;pricePerUnit:number;discountLabel:string;}
export interface B2BListing {
 id:string;shopId:string;shopName:string;distributorName:string;city:string;address:string;
 title:string;category:B2BCategory;partNumber:string;hsnCode:string;unit:B2BUnit;moq:number;
 basePrice:number;mrp?:number;bulkSlabs:B2BPriceSlab[];stock:number;leadTimeDays:number;
 supplyCapacity:string;description:string;specifications:Record<string,string>;image:string;
 status:'active'|'paused'|'archived';verifiedDistributor:boolean;
 prime?:{active:boolean;paid_placement:boolean;ends_at?:number|null};
 createdAt:number;updatedAt:number;version:number;
}
export interface B2BRfqRequest {
 id:string;listingId:string;itemTitle:string;category:B2BCategory;hsnCode:string;unit:B2BUnit;
 shopId:string;shopName:string;customerName:string;customerPhone:string;customerEmail:string;
 buyerCompanyName?:string;buyerGstin?:string;deliveryAddress:string;deliveryCity:string;deliveryPincode:string;
 quantityRequested:number;targetPricePerUnit?:number;urgency:RFQUrgency;notes:string;status:RFQStatus;
 createdAt:number;updatedAt:number;version:number;quotation?:B2BQuotation;
}
export interface B2BQuotation {
 quoteNumber:string;rfqId:string;shopId:string;shopName:string;distributorName:string;distributorGstin:string;
 shopAddress:string;shopPhone:string;shopEmail:string;customerName:string;buyerCompanyName?:string;buyerGstin?:string;
 deliveryAddress:string;deliveryCity:string;deliveryPincode:string;itemTitle:string;partNumber:string;hsnCode:string;
 unit:B2BUnit;quantity:number;offeredRate:number;taxableAmount:number;gstRate:number;gstAmount:number;
 freightCharges:number;grandTotal:number;paymentTerms:string;deliveryTimeline:string;warrantyTerms:string;
 validityDays:number;validUntil:string;validUntilMs:number;authorizedSignatory:string;signatoryDesignation:string;
 specialNotes?:string;createdAt:number;status?:RFQStatus;serverNow?:number;
}
export interface B2BPolicy {paymentsReady:boolean;escrowAvailable:boolean;acceptanceNote:string;priceNote:string;}
export interface B2BPage<T>{items:T[];nextCursor:string|null;serverNow?:number;}
export interface B2BListingDraft {
 title:string;category:B2BCategory;partNumber:string;hsnCode:string;unit:B2BUnit;moq:number;basePrice:number;
 mrp?:number;bulkSlabs:B2BPriceSlab[];stock:number;leadTimeDays:number;supplyCapacity:string;
 description:string;specifications:Record<string,string>;image?:string;shopId:string;
 requestId:string;expectedVersion?:number;
}
export interface B2BRfqDraft {
 listingId:string;customerName:string;customerPhone:string;customerEmail:string;buyerCompanyName?:string;
 buyerGstin?:string;deliveryAddress:string;deliveryCity:string;deliveryPincode:string;quantityRequested:number;
 targetPricePerUnit?:number;urgency:RFQUrgency;notes:string;requestId:string;
}
export interface B2BQuoteDraft {
 offeredRate:number;quantity:number;gstRate:number;freightCharges:number;paymentTerms:string;
 deliveryTimeline:string;warrantyTerms:string;validityDays:number;authorizedSignatory:string;
 signatoryDesignation:string;specialNotes?:string;requestId:string;expectedVersion:number;
}
